const jwt = require("jsonwebtoken");
const { ExternalAuthConfig } = require("./config");

/**
 * Shared delegated token validation logic
 * Used by both validateKeystoneServiceCaller and validateExternalUserToken
 * 
 * Validates delegated JWTs that contain:
 * - Service identity (sub)
 * - Delegated user context (act claim with sub, roles, sessionId, provider)
 * 
 * @param {string} token - JWT token to verify
 * @returns {Object} Verified payload with sub, act, scope, exp, iat
 */
function verifyDelegatedJWT(token) {
  const DELEGATED_JWT_ALG = process.env.KEYSTONE_DELEGATED_JWT_ALG || "HS256";
  const DELEGATED_JWT_SECRET = process.env.KEYSTONE_DELEGATED_JWT_SECRET;
  const DELEGATED_JWT_PUBLIC_KEY = process.env.KEYSTONE_DELEGATED_JWT_PUBLIC_KEY;
  const DELEGATED_JWT_ISSUER = process.env.ANYTHINGLLM_SERVICE_AUDIENCE; // Keystone uses service audience as issuer
  const DELEGATED_JWT_AUDIENCE = process.env.ANYTHINGLLM_SERVICE_AUDIENCE || "anythingllm";

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

  // Get allowed issuers - accept both configured issuer and Keystone base URL
  const getAllowedIssuers = () => {
    const issuers = [DELEGATED_JWT_ISSUER].filter(Boolean);
    // Also accept Keystone base URL as issuer (for compatibility)
    // Accept both with and without /api suffix since Keystone may use either
    if (ExternalAuthConfig.baseUrl) {
      const keystoneBaseUrl = ExternalAuthConfig.baseUrl.replace(/\/$/, "");
      // Add base URL
      if (!issuers.includes(keystoneBaseUrl)) {
        issuers.push(keystoneBaseUrl);
      }
      // Also add base URL without /api if it ends with /api
      if (keystoneBaseUrl.endsWith('/api')) {
        const baseWithoutApi = keystoneBaseUrl.slice(0, -4);
        if (!issuers.includes(baseWithoutApi)) {
          issuers.push(baseWithoutApi);
        }
      }
      // Also add base URL with /api if it doesn't end with /api
      if (!keystoneBaseUrl.endsWith('/api')) {
        const baseWithApi = `${keystoneBaseUrl}/api`;
        if (!issuers.includes(baseWithApi)) {
          issuers.push(baseWithApi);
        }
      }
    }
    return issuers;
  };

  try {
    // Verify signature and decode
    const decoded = jwt.verify(token, verifyKey, {
      algorithms: [DELEGATED_JWT_ALG],
    });

    // Validate issuer - accept both configured issuer and Keystone base URL
    const allowedIssuers = getAllowedIssuers();
    if (!allowedIssuers.includes(decoded.iss)) {
      throw new Error(`Issuer mismatch: expected one of [${allowedIssuers.join(", ")}], got ${decoded.iss}`);
    }

    // Validate audience - accept both configured audience and "anythingllm" (for compatibility)
    const allowedAudiences = [DELEGATED_JWT_AUDIENCE, "anythingllm"].filter(Boolean);
    if (!allowedAudiences.includes(decoded.aud)) {
      throw new Error(`Audience mismatch: expected one of [${allowedAudiences.join(", ")}], got ${decoded.aud}`);
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
 * Check if a token appears to be a delegated token (has act claim)
 * This is a lightweight check before attempting full verification
 * @param {string} token - JWT token to check
 * @returns {boolean} True if token appears to be a delegated token
 */
function isDelegatedToken(token) {
  try {
    const decoded = jwt.decode(token, { complete: false });
    return decoded && 
           decoded.act && 
           typeof decoded.act === "object" && 
           decoded.act.sub && 
           Array.isArray(decoded.act.roles);
  } catch (error) {
    return false;
  }
}

module.exports = {
  verifyDelegatedJWT,
  isDelegatedToken,
};

