const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");
const { EventLogs } = require("../../models/eventLogs");
const { syncKeystoneServiceActor } = require("../auth/syncExternalUser");
const { User } = require("../../models/user");

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
    });
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
      verifiedPayload = verifyDelegatedJWT(token);
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
    });
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
    // Set delegated actor if present (from delegated JWT mode)
    if (delegatedActor) {
      response.locals.delegatedActor = delegatedActor;
    }

    // Audit log success
    await logAuthEvent("keystone_service_auth_success", {
      requestId,
      externalId: "keystone-service",
      callerIdentity,
      action: request.method + " " + request.path,
    });

    return next();
  } catch (error) {
    await logAuthEvent("keystone_service_auth_failed", {
      requestId,
      externalId: "keystone-service",
      reason: "user_sync_failed",
      error: error.message,
    });
    return response.status(500).json({ error: "Service identity verification failed" });
  }
}

module.exports = { validateKeystoneServiceCaller };


