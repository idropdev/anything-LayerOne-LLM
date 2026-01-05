const jwt = require("jsonwebtoken");
const { EventLogs } = require("../../models/eventLogs");
const { SystemSettings } = require("../../models/systemSettings");
const { v4: uuidv4 } = require("uuid");

/**
 * Delegated Token Authentication Middleware
 *
 * Validates delegated tokens issued by Keystone Core API for S2S authentication
 * with embedded user context in the `act` claim (RFC 8693).
 *
 * Key Principle:
 * - Authentication Medium: Service-to-Service (Keystone → AnythingLLM)
 * - Token Issuer: svc-keystone (service identity)
 * - User Context: Embedded in `act` claim
 * - Authorization: Role-based restrictions are enforced based on `act.roles`
 *
 * Token Structure:
 * {
 *   "sub": "svc-keystone",
 *   "act": {
 *     "sub": "user-123",
 *     "roles": ["admin"],
 *     "sessionId": "session-456",
 *     "provider": "google"
 *   },
 *   "scope": ["anythingllm:system:read", "anythingllm:system:write"],
 *   "aud": "anythingllm",
 *   "iss": "https://keystone.example.com",
 *   "iat": 1738000000,
 *   "exp": 1738000300
 * }
 */

// Configuration
// TODO: Move secrets to GCP Secret Manager in production
const DELEGATED_TOKEN_SECRET = process.env.KEYSTONE_DELEGATED_TOKEN_SECRET;
const DELEGATED_TOKEN_ISSUER = process.env.KEYSTONE_ISSUER;
const DELEGATED_TOKEN_AUDIENCE = process.env.KEYSTONE_AUDIENCE || "anythingllm";
const CORRELATION_ID_HEADER = process.env.CORRELATION_ID_HEADER_NAME || "x-correlation-id";

/**
 * Extract correlation ID from headers or generate one
 */
function getCorrelationId(request) {
  return (
    request.header(CORRELATION_ID_HEADER) ||
    request.header("x-request-id") ||
    uuidv4()
  );
}

/**
 * Audit logging for delegated token auth events (NO PHI)
 */
async function logAuthEvent(eventType, metadata = {}) {
  try {
    await EventLogs.logEvent(
      eventType,
      {
        ...metadata,
        timestamp: new Date().toISOString(),
        authProvider: "keystone-delegated-token",
      },
      metadata.userId || null
    );
  } catch (error) {
    console.error(
      `\x1b[31m[Delegated Token Auth Logging Failed]\x1b[0m - ${eventType}`,
      error.message
    );
  }
}

/**
 * Main middleware function
 * Validates delegated token and extracts user context from act claim
 */
async function validateDelegatedToken(req, res, next) {
  const correlationId = getCorrelationId(req);

  // Extract Bearer token from Authorization header
  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    console.log(
      `\x1b[31m[Delegated Token Auth Failed]\x1b[0m - ` +
        `Missing token | Path: ${req.path} | CorrelationId: ${correlationId}`
    );
    await logAuthEvent("delegated_token_auth_failed", {
      correlationId,
      reason: "missing_token",
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({
      error: "Missing or invalid authorization header",
    });
  }

  // Validate configuration
  if (!DELEGATED_TOKEN_SECRET) {
    console.error(
      `\x1b[31m[Delegated Token Auth Error]\x1b[0m - KEYSTONE_DELEGATED_TOKEN_SECRET not configured`
    );
    await logAuthEvent("delegated_token_auth_failed", {
      correlationId,
      reason: "configuration_error",
      method: req.method,
      path: req.path,
    });
    return res.status(500).json({
      error: "Token validation failed",
    });
  }

  let decoded;

  try {
    // Step 1: Verify token signature and basic claims
    const verifyOptions = {
      algorithms: ["HS256"],
      audience: DELEGATED_TOKEN_AUDIENCE,
    };

    if (DELEGATED_TOKEN_ISSUER) {
      verifyOptions.issuer = DELEGATED_TOKEN_ISSUER;
    }

    decoded = jwt.verify(token, DELEGATED_TOKEN_SECRET, verifyOptions);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      console.log(
        `\x1b[31m[Delegated Token Auth Failed]\x1b[0m - ` +
          `Token expired | Path: ${req.path} | CorrelationId: ${correlationId}`
      );
      await logAuthEvent("delegated_token_auth_failed", {
        correlationId,
        reason: "token_expired",
        method: req.method,
        path: req.path,
      });
      return res.status(401).json({
        error: "Token expired",
      });
    }
    if (error.name === "JsonWebTokenError") {
      console.log(
        `\x1b[31m[Delegated Token Auth Failed]\x1b[0m - ` +
          `Invalid token | Path: ${req.path} | CorrelationId: ${correlationId} | Error: ${error.message}`
      );
      await logAuthEvent("delegated_token_auth_failed", {
        correlationId,
        reason: "invalid_token",
        error: error.message,
        method: req.method,
        path: req.path,
      });
      return res.status(401).json({
        error: "Invalid token",
      });
    }
    console.log(
      `\x1b[31m[Delegated Token Auth Error]\x1b[0m - ` +
        `Token validation failed | Path: ${req.path} | CorrelationId: ${correlationId} | Error: ${error.message}`
    );
    await logAuthEvent("delegated_token_auth_failed", {
      correlationId,
      reason: "validation_error",
      error: error.message,
      method: req.method,
      path: req.path,
    });
    return res.status(500).json({
      error: "Token validation failed",
    });
  }

  // Step 2: Verify service identity
  if (decoded.sub !== "svc-keystone") {
    console.log(
      `\x1b[31m[Delegated Token Auth Failed]\x1b[0m - ` +
        `Invalid service identity | Expected: svc-keystone, Got: ${decoded.sub} | CorrelationId: ${correlationId}`
    );
    await logAuthEvent("delegated_token_auth_failed", {
      correlationId,
      reason: "invalid_service_identity",
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({
      error: "Invalid token: not from Keystone service",
    });
  }

  // Step 3: Verify actor claim
  if (!decoded.act || !decoded.act.sub) {
    console.log(
      `\x1b[31m[Delegated Token Auth Failed]\x1b[0m - ` +
        `Missing actor claim | Path: ${req.path} | CorrelationId: ${correlationId}`
    );
    await logAuthEvent("delegated_token_auth_failed", {
      correlationId,
      reason: "missing_actor_claim",
      method: req.method,
      path: req.path,
    });
    return res.status(401).json({
      error: "Invalid token: missing actor claim",
    });
  }

  // Step 4: Extract user context from act claim
  const userId = decoded.act.sub;
  const roles = Array.isArray(decoded.act.roles) ? decoded.act.roles : [];
  const sessionId = decoded.act.sessionId || null;
  const provider = decoded.act.provider || null;

  // Parse scope (string or array)
  let scopeArray = [];
  if (decoded.scope) {
    if (Array.isArray(decoded.scope)) {
      scopeArray = decoded.scope;
    } else if (typeof decoded.scope === "string") {
      scopeArray = decoded.scope.split(" ").filter(Boolean);
    }
  }

  // Step 5: Set multi-user mode
  const multiUserMode = await SystemSettings.isMultiUserMode();
  res.locals.multiUserMode = multiUserMode;

  // Step 6: Attach user context to request
  // Note: We attach a user-like object with roles, not a systemActor
  // This allows role-based authorization to work
  req.user = {
    id: userId,
    roles: roles,
    sessionId: sessionId,
    provider: provider,
    scope: scopeArray,
    issuedAt: decoded.iat,
    expiresAt: decoded.exp,
  };

  // Also attach to response.locals for compatibility
  res.locals.user = req.user;
  res.locals.correlationId = correlationId;

  // Step 7: Log successful authentication
  console.log(
    `\x1b[32m[Delegated Token Auth Success]\x1b[0m - ` +
      `User: ${userId} | Roles: [${roles.join(", ")}] | Path: ${req.path} | CorrelationId: ${correlationId}`
  );

  await logAuthEvent("delegated_token_auth_success", {
    correlationId,
    userId,
    roles: roles,
    sessionId: sessionId,
    method: req.method,
    path: req.path,
  });

  // Step 8: Continue to next middleware
  next();
}

module.exports = { validateDelegatedToken };

