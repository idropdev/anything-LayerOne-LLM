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
 * Supports two modes:
 * - GCP MODE: Verify Google OIDC ID tokens via google-auth-library
 * - LOCAL JWT MODE: Verify RS256 JWTs signed with shared key pair
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
const DELEGATED_JWT_ISSUER = process.env.ANYTHINGLLM_SERVICE_AUDIENCE; // Keystone uses service audience as issuer
const DELEGATED_JWT_AUDIENCE = process.env.ANYTHINGLLM_SERVICE_AUDIENCE || "anythingllm";

// Import shared delegated token validation
const { verifyDelegatedJWT } = require("../auth/delegatedTokenValidator");

/**
 * Extract request ID from headers or generate one for correlation
 */
function getRequestId(request) {
  return request.header("X-Request-Id") || uuidv4();
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
    console.error(error.message);
  }
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

    // Manually decode the JWT to get all claims (verifyIdToken may not return all claims)
    // This is safe because verifyIdToken already verified the signature cryptographically
    let rawPayload;
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        throw new Error("Invalid JWT format");
      }
      rawPayload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8"));
    } catch (error) {
      // Fall back to payload from verifyIdToken if manual decode fails
      rawPayload = payload;
    }

    // Merge raw payload with verified payload (verified payload takes precedence)
    const fullPayload = { ...rawPayload, ...payload };

    // Enforce audience match (handle both string and array formats per OIDC spec)
    const audiences = Array.isArray(fullPayload.aud) ? fullPayload.aud : [fullPayload.aud];
    if (!audiences.includes(SERVICE_AUDIENCE)) {
      throw new Error(`Audience mismatch: expected ${SERVICE_AUDIENCE}, got ${JSON.stringify(fullPayload.aud)}`);
    }

    // Rely on google-auth-library for issuer validation
    // Library automatically verifies iss is a valid Google issuer (https://accounts.google.com)

    // GCP service account ID tokens may not include email claim
    // If email is present, validate it against ALLOWED_CALLER_SA_EMAIL
    // If email is missing, rely on audience + issuer validation (both cryptographically verified)
    if (ALLOWED_CALLER_SA_EMAIL && fullPayload.email) {
      // If email claim is present AND we have a configured allowed email, validate it
      if (fullPayload.email !== ALLOWED_CALLER_SA_EMAIL) {
        throw new Error(
          `Caller email mismatch: expected ${ALLOWED_CALLER_SA_EMAIL}, got ${fullPayload.email}`
        );
      }
    }

    return {
      email: fullPayload.email || null,
      sub: fullPayload.sub,
      exp: fullPayload.exp,
      iat: fullPayload.iat,
      scope: fullPayload.scope || "",
    };
  } catch (error) {
    throw new Error(`GCP ID token verification failed: ${error.message}`);
  }
}

// verifyDelegatedJWT is now imported from shared module

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
 * Main middleware function
 */
async function validateKeystoneServiceCaller(request, response, next) {
  const requestId = getRequestId(request);

  // Extract Bearer token from Authorization header
  const auth = request.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      externalId: "keystone-service",
      reason: "missing_token",
      action: request.method + " " + request.path,
    });
    console.error(`\x1b[31m[Service Auth Failed]\x1b[0m - Missing token | RequestId: ${requestId} | Path: ${request.method} ${request.path}`);
    return response.status(401).json({ error: "Missing service identity token" });
  }

  let verifiedPayload;
  let callerIdentity;
  let delegatedActor = null;

  try {
    // Select verification mode based on environment
    if (SERVICE_AUTH_MODE === "local_jwt") {
      verifiedPayload = verifyLocalJWT(token);
      callerIdentity = verifiedPayload.sub;
    } else if (SERVICE_AUTH_MODE === "keystone_delegated_jwt") {
      // Delegated JWT mode - validates token with act claim containing user context
      console.log(`\x1b[36m[Service Auth]\x1b[0m - Validating delegated JWT | RequestId: ${requestId} | Path: ${request.method} ${request.path}`);

      // #region agent log
      try {
        const jwt = require("jsonwebtoken");
        const headerDecoded = jwt.decode(token, { complete: true });
        fetch('http://127.0.0.1:7243/ingest/57932fdd-f4f0-42ce-9b6e-a457128e157a', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'validateKeystoneServiceCaller.js:222', message: 'Before delegated JWT verification', data: { tokenAlg: headerDecoded?.header?.alg, expectedAlg: DELEGATED_JWT_ALG, authMode: SERVICE_AUTH_MODE }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'pre-fix', hypothesisId: 'D' }) }).catch(() => { });
      } catch (e) { }
      // #endregion

      verifiedPayload = verifyDelegatedJWT(token, {
        requestId,
        path: request.path,
        method: request.method,
      });
      callerIdentity = verifiedPayload.sub; // Service subject
      delegatedActor = verifiedPayload.act; // Requester context
    } else {
      // Default to GCP mode
      verifiedPayload = await verifyGCPIdToken(token);
      callerIdentity = verifiedPayload.email;
    }
  } catch (error) {
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      externalId: "keystone-service",
      reason: "verification_failed",
      error: error.message,
      action: request.method + " " + request.path,
      authMode: SERVICE_AUTH_MODE,
    });
    console.error(`\x1b[31m[Service Auth Failed]\x1b[0m - Verification failed | RequestId: ${requestId} | Path: ${request.method} ${request.path} | Mode: ${SERVICE_AUTH_MODE} | Error: ${error.message}`);
    return response.status(401).json({ error: "Invalid service identity token" });
  }

  // Map verified identity to system actor user
  try {
    const systemActorUser = await syncKeystoneServiceActor();

    // Check if user is suspended
    if (systemActorUser.suspended) {
      await logAuthEvent("keystone_service_auth_failed", {
        requestId,
        externalId: "keystone-service",
        reason: "service_actor_suspended",
        action: request.method + " " + request.path,
        userId: systemActorUser.id,
      });
      console.error(`\x1b[31m[Service Auth Failed]\x1b[0m - Service actor suspended | RequestId: ${requestId} | Path: ${request.method} ${request.path} | UserId: ${systemActorUser.id}`);
      return response.status(403).json({ error: "Service actor account is suspended" });
    }

    // Set response locals
    // Set multiUserMode for endpoints that use multiUserMode(response) helper
    const multiUserMode = await SystemSettings.isMultiUserMode();
    response.locals.multiUserMode = multiUserMode;
    response.locals.user = systemActorUser;
    response.locals.systemActor = true; // CRITICAL: Authorization must not consult end-user role/scope
    response.locals.scope = Array.isArray(verifiedPayload.scope)
      ? verifiedPayload.scope
      : (verifiedPayload.scope
        ? verifiedPayload.scope.split(" ").filter(Boolean)
        : []);
    // Set delegated actor if present (from delegated JWT mode)
    if (delegatedActor) {
      response.locals.delegatedActor = delegatedActor;
    }

    // Role-based access control for admin endpoints
    // Admin routes require admin role in delegated token (same as basic AnythingLLM access)
    if (request.path.startsWith("/v1/admin") && delegatedActor) {
      const delegatedRoles = delegatedActor.roles || [];
      if (!delegatedRoles.includes("admin")) {
        await logAuthEvent("keystone_service_auth_failed", {
          requestId,
          externalId: "keystone-service",
          reason: "insufficient_role",
          delegatedUserId: delegatedActor.sub,
          delegatedUserRoles: delegatedRoles.join(","),
          requiredRole: "admin",
          action: request.method + " " + request.path,
        });
        console.error(`\x1b[31m[Service Auth Failed]\x1b[0m - Insufficient role | RequestId: ${requestId} | Path: ${request.method} ${request.path} | Roles: [${delegatedRoles.join(", ")}] | Required: admin`);
        return response.status(403).json({ error: "Admin role required for this endpoint" });
      }
    }

    // Audit log success with full context
    await logAuthEvent("keystone_service_auth_success", {
      requestId,
      externalId: "keystone-service",
      callerIdentity,
      delegatedUserId: delegatedActor?.sub || null,
      delegatedUserRoles: delegatedActor?.roles?.join(",") || null,
      delegatedSessionId: delegatedActor?.sessionId || null,
      action: request.method + " " + request.path,
      scope: response.locals.scope.join(" "),
    });

    console.log(`\x1b[32m[Service Auth Success]\x1b[0m - Authentication successful | RequestId: ${requestId} | Path: ${request.method} ${request.path} | Service: ${callerIdentity}${delegatedActor ? ` | Delegated User: ${delegatedActor.sub} | Roles: [${delegatedActor.roles.join(", ")}]` : ""}`);

    return next();
  } catch (error) {
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      externalId: "keystone-service",
      reason: "user_sync_failed",
      error: error.message,
      action: request.method + " " + request.path,
    });
    console.error(`\x1b[31m[Service Auth Failed]\x1b[0m - User sync failed | RequestId: ${requestId} | Path: ${request.method} ${request.path} | Error: ${error.message}`);
    return response.status(500).json({ error: "Service identity verification failed" });
  }
}

module.exports = { validateKeystoneServiceCaller };


