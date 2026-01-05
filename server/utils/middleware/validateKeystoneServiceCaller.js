const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { EventLogs } = require("../../models/eventLogs");
const { syncKeystoneServiceActor } = require("../auth/syncExternalUser");
const { User } = require("../../models/user");
const { SystemSettings } = require("../../models/systemSettings");

/**
 * Service Identity Verification Middleware
 *
 * Validates that requests to internal/admin routes come from Keystone Core API
 * running under an approved GCP service account.
 *
 * Supports three modes:
 * - GCP MODE: Verify Google OIDC ID tokens via google-auth-library
 * - LOCAL JWT MODE: Verify RS256 JWTs signed with shared key pair
 * - DELEGATED JWT MODE: Verify delegated JWTs with requester context in act claim
 *
 * CRITICAL RULE: If response.locals.systemActor === true, authorization decisions
 * must not consult end-user role, scope, or session state.
 */

const SERVICE_AUTH_MODE = process.env.ANYTHINGLLM_SERVICE_AUTH_MODE || "gcp";
const SERVICE_AUDIENCE = process.env.ANYTHINGLLM_SERVICE_AUDIENCE;
const ALLOWED_CALLER_SA_EMAIL = process.env.ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL;
const KEYSTONE_SERVICE_PUBLIC_KEY = process.env.KEYSTONE_SERVICE_PUBLIC_KEY;

// Delegated JWT configuration
const DELEGATED_JWT_ALG = process.env.KEYSTONE_DELEGATED_JWT_ALG || "HS256";
const DELEGATED_JWT_SECRET = process.env.KEYSTONE_DELEGATED_JWT_SECRET;
const DELEGATED_JWT_PUBLIC_KEY = process.env.KEYSTONE_DELEGATED_JWT_PUBLIC_KEY;
const DELEGATED_JWT_ISSUER = process.env.KEYSTONE_DELEGATED_JWT_ISSUER;
const DELEGATED_JWT_AUDIENCE = process.env.KEYSTONE_DELEGATED_JWT_AUDIENCE || "anythingllm";
const CORRELATION_ID_HEADER = process.env.CORRELATION_ID_HEADER_NAME || "x-correlation-id";

/**
 * Map of permitted service-to-service operations
 * Maps route patterns to human-readable operation types
 * 
 * NOTE: Dynamic segments like :id, :workspaceId, :workspaceSlug are normalized
 * during pattern matching to match actual request paths.
 */
const PERMITTED_OPERATIONS = {
  // System status
  "GET /v1/admin/is-multi-user-mode": "system_status_check",

  // User management
  "GET /v1/admin/users": "user_list",
  "GET /v1/admin/users/external/:externalId": "user_lookup_by_external_id",
  "POST /v1/admin/users/new": "user_create",
  "POST /v1/admin/users/:id": "user_update",
  "DELETE /v1/admin/users/:id": "user_delete",

  // Invite management
  "GET /v1/admin/invites": "invite_list",
  "POST /v1/admin/invite/new": "invite_create",
  "DELETE /v1/admin/invite/:id": "invite_delete",

  // Workspace user management
  "GET /v1/admin/workspaces/:workspaceId/users": "workspace_user_list",
  "POST /v1/admin/workspaces/:workspaceId/update-users": "workspace_user_update",
  "POST /v1/admin/workspaces/:workspaceSlug/manage-users": "workspace_user_manage",

  // Workspace chat management
  "POST /v1/admin/workspace-chats": "workspace_chat_manage",

  // System preferences
  "POST /v1/admin/preferences": "system_preferences_update",

  // Workspace provisioning
  "POST /v1/workspace/new": "workspace_create",
};

/**
 * Extract request ID from headers or generate one for correlation
 */
function getRequestId(request) {
  return request.header("X-Request-Id") || uuidv4();
}

/**
 * Extract correlation ID from headers or generate one
 * Priority: configured header name -> x-request-id -> UUID
 */
function getCorrelationId(request) {
  return request.header(CORRELATION_ID_HEADER) ||
    request.header("x-request-id") ||
    uuidv4();
}

/**
 * Determine operation type from request method and path
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Request path
 * @returns {string} - Operation type identifier
 */
function getOperationType(method, path) {
  // Normalize path by replacing numeric IDs and slugs with placeholders
  // First replace numeric IDs, then handle slug patterns
  let normalizedPath = path.replace(/\/\d+/g, "/:id");
  // For workspaceSlug patterns, replace non-numeric segments that match slug format
  normalizedPath = normalizedPath.replace(/\/[a-z0-9-]+(?=\/manage-users)/, "/:workspaceSlug");

  const routeKey = `${method} ${normalizedPath}`;

  // Try exact match first
  if (PERMITTED_OPERATIONS[routeKey]) {
    return PERMITTED_OPERATIONS[routeKey];
  }

  // Try pattern matching for dynamic routes
  for (const [pattern, operationType] of Object.entries(PERMITTED_OPERATIONS)) {
    const patternMethod = pattern.split(" ")[0];
    const patternPath = pattern.split(" ")[1];

    if (patternMethod === method) {
      // Convert pattern to regex (e.g., /v1/admin/users/:id -> /v1/admin/users/[^/]+)
      // This matches both numeric IDs and string slugs
      const regexPattern = patternPath.replace(/:[^/]+/g, "[^/]+");
      const regex = new RegExp(`^${regexPattern}$`);

      if (regex.test(normalizedPath)) {
        return operationType;
      }

      // Also try matching against original path for slug-based routes
      if (regex.test(path)) {
        return operationType;
      }
    }
  }

  // Fallback to generic operation type
  return `${method.toLowerCase()}_${path.split("/").pop() || "unknown"}`;
}

/**
 * Get list of all permitted operations for service-to-service calls
 * @returns {string[]} - Array of permitted operation types
 */
function getPermittedOperations() {
  return Object.values(PERMITTED_OPERATIONS);
}

/**
 * Audit logging for service identity auth events (NO PHI)
 */
async function logAuthEvent(eventType, metadata = {}) {
  try {
    await EventLogs.logEvent(
      eventType,
      {
        ...metadata,
        timestamp: new Date().toISOString(),
        authProvider: "keystone-service",
      },
      metadata.userId || null
    );
  } catch (error) {
    console.error(`\x1b[31m[Service Auth Logging Failed]\x1b[0m - ${eventType}`, error.message);
  }
}

/**
 * Log service-to-service operation attempt using AnythingLLM standard format
 * @param {string} requestId - Request correlation ID
 * @param {string} operationType - Type of operation being attempted
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {boolean} permitted - Whether the operation is permitted
 */
function logOperationAttempt(requestId, operationType, method, path, permitted = true) {
  const statusColor = permitted ? "\x1b[32m" : "\x1b[33m";
  const statusText = permitted ? "PERMITTED" : "NOT PERMITTED";

  console.log(
    `\x1b[36m[Service-to-Service Operation]\x1b[0m ${statusColor}[${statusText}]\x1b[0m - ` +
    `Operation: ${operationType} | Method: ${method} | Path: ${path} | RequestId: ${requestId}`
  );
}

/**
 * Log permitted operations for service-to-service calls
 * @param {string} requestId - Request correlation ID
 */
function logPermittedOperations(requestId) {
  const permittedOps = getPermittedOperations();
  console.log(
    `\x1b[36m[Service-to-Service Permissions]\x1b[0m - ` +
    `Permitted operations (${permittedOps.length}): ${permittedOps.join(", ")} | RequestId: ${requestId}`
  );
}

/**
 * Verify Google OIDC ID token (GCP MODE)
 * Uses google-auth-library to verify token cryptographically
 */
async function verifyGCPIdToken(token) {
  // Lazy-load google-auth-library only in GCP mode
  // This prevents local dev failures when ADC/metadata server is unavailable
  const { OAuth2Client } = require("google-auth-library");

  if (!SERVICE_AUDIENCE) {
    throw new Error(
      "ANYTHINGLLM_SERVICE_AUDIENCE must be set for GCP service identity verification"
    );
  }

  if (!ALLOWED_CALLER_SA_EMAIL) {
    throw new Error(
      "ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL must be set for GCP service identity verification"
    );
  }

  const client = new OAuth2Client();

  try {
    // Verify the ID token cryptographically
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: SERVICE_AUDIENCE,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      throw new Error("ID token payload is missing");
    }

    // Enforce audience match
    if (payload.aud !== SERVICE_AUDIENCE) {
      throw new Error(`Audience mismatch: expected ${SERVICE_AUDIENCE}, got ${payload.aud}`);
    }

    // Enforce caller identity via email claim
    // GCP service account ID tokens include email claim with service account email
    if (!payload.email) {
      throw new Error("ID token missing email claim (required for service account verification)");
    }

    if (payload.email !== ALLOWED_CALLER_SA_EMAIL) {
      throw new Error(
        `Caller email mismatch: expected ${ALLOWED_CALLER_SA_EMAIL}, got ${payload.email}`
      );
    }

    // Rely on google-auth-library for issuer validation
    // Library automatically verifies iss is a valid Google issuer

    return {
      email: payload.email,
      sub: payload.sub,
      exp: payload.exp,
      iat: payload.iat,
      scope: payload.scope || "",
    };
  } catch (error) {
    throw new Error(`GCP ID token verification failed: ${error.message}`);
  }
}

/**
 * Verify local RS256 JWT (LOCAL JWT MODE)
 * Verifies signature and enforces strict claims
 */
function verifyLocalJWT(token) {
  if (!KEYSTONE_SERVICE_PUBLIC_KEY) {
    throw new Error(
      "KEYSTONE_SERVICE_PUBLIC_KEY must be set for local JWT service identity verification"
    );
  }

  if (!SERVICE_AUDIENCE) {
    throw new Error(
      "ANYTHINGLLM_SERVICE_AUDIENCE must be set for local JWT service identity verification"
    );
  }

  try {
    // Verify RS256 signature and decode
    const decoded = jwt.verify(token, KEYSTONE_SERVICE_PUBLIC_KEY, {
      algorithms: ["RS256"],
    });

    // Enforce strict claims
    if (decoded.iss !== "keystone-service") {
      throw new Error(`Issuer mismatch: expected keystone-service, got ${decoded.iss}`);
    }

    if (decoded.sub !== "keystone-service") {
      throw new Error(`Subject mismatch: expected keystone-service, got ${decoded.sub}`);
    }

    if (decoded.aud !== SERVICE_AUDIENCE) {
      throw new Error(`Audience mismatch: expected ${SERVICE_AUDIENCE}, got ${decoded.aud}`);
    }

    if (decoded.role !== "admin") {
      throw new Error(`Role mismatch: expected admin, got ${decoded.role}`);
    }

    // jwt.verify already checks exp, but we trust exp claim explicitly (not assumed TTL)
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expired (exp claim)");
    }

    return {
      email: null, // Local JWT doesn't have email
      sub: decoded.sub,
      exp: decoded.exp,
      iat: decoded.iat,
      scope: decoded.scope || "",
    };
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      throw new Error(`Local JWT verification failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Verify delegated JWT (DELEGATED JWT MODE)
 * Verifies signature (HS256 or RS256) and enforces strict claims including act claim
 * @param {string} token - JWT token to verify
 * @returns {Object} Verified payload with sub, act, scope, exp, iat
 */
function verifyDelegatedJWT(token) {
  // Determine verification key based on algorithm
  const verifyKey = DELEGATED_JWT_ALG === "HS256"
    ? DELEGATED_JWT_SECRET
    : DELEGATED_JWT_PUBLIC_KEY;

  if (!verifyKey) {
    throw new Error(
      `Missing ${DELEGATED_JWT_ALG === "HS256" ? "secret" : "public key"} for delegated JWT verification. ` +
      `Set KEYSTONE_DELEGATED_JWT_${DELEGATED_JWT_ALG === "HS256" ? "SECRET" : "PUBLIC_KEY"}`
    );
  }

  if (!DELEGATED_JWT_ISSUER) {
    throw new Error(
      "KEYSTONE_DELEGATED_JWT_ISSUER must be set for delegated JWT verification"
    );
  }

  try {
    // Verify signature and decode
    const decoded = jwt.verify(token, verifyKey, {
      algorithms: [DELEGATED_JWT_ALG],
    });

    // Validate issuer
    if (decoded.iss !== DELEGATED_JWT_ISSUER) {
      throw new Error(`Issuer mismatch: expected ${DELEGATED_JWT_ISSUER}, got ${decoded.iss}`);
    }

    // Validate audience
    if (decoded.aud !== DELEGATED_JWT_AUDIENCE) {
      throw new Error(`Audience mismatch: expected ${DELEGATED_JWT_AUDIENCE}, got ${decoded.aud}`);
    }

    // Validate expiration (jwt.verify already checks, but explicit for clarity)
    if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
      throw new Error("Token expired");
    }

    // Validate nbf if present
    if (decoded.nbf && decoded.nbf > Math.floor(Date.now() / 1000)) {
      throw new Error("Token not yet valid (nbf)");
    }

    // Require act claim
    if (!decoded.act || typeof decoded.act !== "object") {
      throw new Error("Missing or invalid 'act' claim (required for delegated mode)");
    }

    // Require act.sub
    if (!decoded.act.sub || typeof decoded.act.sub !== "string") {
      throw new Error("Missing or invalid 'act.sub' claim");
    }

    // Require act.roles (array)
    if (!Array.isArray(decoded.act.roles)) {
      throw new Error("Missing or invalid 'act.roles' claim (must be array)");
    }

    // Parse scope (string or array)
    let scopeArray = [];
    if (decoded.scope) {
      if (Array.isArray(decoded.scope)) {
        scopeArray = decoded.scope;
      } else if (typeof decoded.scope === "string") {
        scopeArray = decoded.scope.split(" ").filter(Boolean);
      }
    }

    return {
      sub: decoded.sub, // Service subject (e.g., "svc-keystone")
      act: {
        sub: decoded.act.sub, // Requester ID
        roles: decoded.act.roles, // Requester roles (for audit only)
        sessionId: decoded.act.sessionId || null,
        provider: decoded.act.provider || null,
      },
      scope: scopeArray,
      exp: decoded.exp,
      iat: decoded.iat,
    };
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      throw new Error(`Delegated JWT verification failed: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Main middleware function
 */
async function validateKeystoneServiceCaller(request, response, next) {
  const requestId = getRequestId(request);
  const correlationId = getCorrelationId(request);
  const operationType = getOperationType(request.method, request.path);

  // Log operation attempt and permitted operations
  logOperationAttempt(requestId, operationType, request.method, request.path, true);
  logPermittedOperations(requestId);

  // Extract Bearer token from Authorization header
  const auth = request.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    console.log(
      `\x1b[31m[Service-to-Service Auth Failed]\x1b[0m - ` +
      `Missing token | Operation: ${operationType} | RequestId: ${requestId} | CorrelationId: ${correlationId}`
    );
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      correlationId,
      externalId: "keystone-service",
      reason: "missing_token",
      operationType,
      method: request.method,
      path: request.path,
    });
    return response.status(401).json({ error: "Missing service identity token" });
  }

  let verifiedPayload;
  let callerIdentity;
  let delegatedActor = null;
  let authMode = SERVICE_AUTH_MODE;

  try {
    // Select verification mode based on environment
    if (SERVICE_AUTH_MODE === "local_jwt") {
      verifiedPayload = verifyLocalJWT(token);
      callerIdentity = verifiedPayload.sub;
      console.log(
        `\x1b[36m[Service Auth]\x1b[0m - ` +
        `Local JWT verification | Operation: ${operationType} | RequestId: ${requestId} | CorrelationId: ${correlationId}`
      );
    } else if (SERVICE_AUTH_MODE === "keystone_delegated_jwt") {
      // Delegated JWT mode
      verifiedPayload = verifyDelegatedJWT(token);
      callerIdentity = verifiedPayload.sub; // Service subject
      delegatedActor = verifiedPayload.act; // Requester context
      authMode = "keystone_delegated_jwt";
      console.log(
        `\x1b[36m[Service Auth]\x1b[0m - ` +
        `Delegated JWT verification | Operation: ${operationType} | RequestId: ${requestId} | CorrelationId: ${correlationId} | ` +
        `Service: ${callerIdentity} | Requester: ${delegatedActor.sub}`
      );
    } else {
      // Default to GCP mode
      verifiedPayload = await verifyGCPIdToken(token);
      callerIdentity = verifiedPayload.email;
      console.log(
        `\x1b[36m[Service Auth]\x1b[0m - ` +
        `GCP ID token verification | Operation: ${operationType} | RequestId: ${requestId} | CorrelationId: ${correlationId}`
      );
    }
  } catch (error) {
    console.log(
      `\x1b[31m[Service Auth Failed]\x1b[0m - ` +
      `Token verification failed | Operation: ${operationType} | Error: ${error.message} | RequestId: ${requestId} | CorrelationId: ${correlationId}`
    );
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      correlationId,
      externalId: "keystone-service",
      reason: "verification_failed",
      error: error.message,
      operationType,
      method: request.method,
      path: request.path,
    });
    return response.status(401).json({ error: "Invalid service identity token" });
  }

  // Map verified identity to system actor user
  try {
    // Set multiUserMode in response.locals (required for endpoint checks)
    // This must be set before any endpoint logic runs
    const multiUserMode = await SystemSettings.isMultiUserMode();
    response.locals.multiUserMode = multiUserMode;

    const systemActorUser = await syncKeystoneServiceActor();

    // Check if user is suspended
    if (systemActorUser.suspended) {
      console.log(
        `\x1b[31m[Service Auth Failed]\x1b[0m - ` +
        `Service actor suspended | Operation: ${operationType} | UserId: ${systemActorUser.id} | RequestId: ${requestId}`
      );
      await logAuthEvent("keystone_service_auth_failed", {
        requestId,
        correlationId,
        externalId: "keystone-service",
        reason: "service_actor_suspended",
        operationType,
        method: request.method,
        path: request.path,
        userId: systemActorUser.id,
      });
      return response.status(403).json({ error: "Service actor account is suspended" });
    }

    // Set response locals
    response.locals.user = systemActorUser;
    response.locals.systemActor = true; // CRITICAL: Authorization must not consult end-user role/scope
    response.locals.scope = Array.isArray(verifiedPayload.scope)
      ? verifiedPayload.scope
      : (verifiedPayload.scope
        ? verifiedPayload.scope.split(" ").filter(Boolean)
        : []);
    response.locals.correlationId = correlationId;
    response.locals.authMode = authMode;
    if (delegatedActor) {
      response.locals.delegatedActor = delegatedActor;
    }

    // Log successful authentication and operation authorization
    const logMessage = `\x1b[32m[Service Auth Success]\x1b[0m - ` +
      `Operation authorized | Operation: ${operationType} | Method: ${request.method} | Path: ${request.path} | ` +
      `Caller: ${callerIdentity} | UserId: ${systemActorUser.id} | RequestId: ${requestId} | CorrelationId: ${correlationId}`;

    if (delegatedActor) {
      console.log(
        logMessage + ` | Requester: ${delegatedActor.sub} | RequesterRoles: [${delegatedActor.roles.join(", ")}]`
      );
    } else {
      console.log(logMessage);
    }

    // Audit log success
    await logAuthEvent("keystone_service_auth_success", {
      requestId,
      correlationId,
      externalId: "keystone-service",
      callerIdentity,
      delegatedActorSub: delegatedActor?.sub || null,
      delegatedActorRoles: delegatedActor?.roles || null,
      operationType,
      method: request.method,
      path: request.path,
      userId: systemActorUser.id,
      authMode,
    });

    return next();
  } catch (error) {
    console.log(
      `\x1b[31m[Service Auth Error]\x1b[0m - ` +
      `User sync failed | Operation: ${operationType} | Error: ${error.message} | RequestId: ${requestId}`
    );
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      correlationId,
      externalId: "keystone-service",
      reason: "user_sync_failed",
      error: error.message,
      operationType,
      method: request.method,
      path: request.path,
    });
    return response.status(500).json({ error: "Service identity verification failed" });
  }
}

module.exports = { validateKeystoneServiceCaller };


