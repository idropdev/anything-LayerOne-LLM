const jwt = require("jsonwebtoken");
const { ExternalAuthConfig } = require("./config");

/**
 * Shared delegated token validation logic
 * Used by validateKeystoneServiceCaller for admin routes
 * 
 * Uses the SAME simple HS256 verification as validateDelegatedToken.js
 * which works for workspace and document upload endpoints.
 * 
 * @param {string} token - JWT token to verify
 * @param {Object} options - Optional logging context (requestId, path, method)
 * @returns {Object} Verified payload with sub, act, scope, exp, iat
 */
function verifyDelegatedJWT(token, options = {}) {
  const { requestId, path, method } = options;
  const DELEGATED_JWT_SECRET = process.env.KEYSTONE_DELEGATED_JWT_SECRET;
  const DELEGATED_JWT_ISSUER = process.env.ANYTHINGLLM_SERVICE_AUDIENCE;
  const DELEGATED_JWT_AUDIENCE = process.env.ANYTHINGLLM_SERVICE_AUDIENCE || "anythingllm";

  if (!DELEGATED_JWT_SECRET) {
    const errorMsg = "Missing secret for JWT verification. Set KEYSTONE_DELEGATED_JWT_SECRET";
    console.error(`\x1b[31m[Delegated Token Validation Failed]\x1b[0m - ${errorMsg}${requestId ? ` | RequestId: ${requestId}` : ""}`);
    throw new Error(errorMsg);
  }

  // Get allowed issuers
  const getAllowedIssuers = () => {
    const issuers = [DELEGATED_JWT_ISSUER].filter(Boolean);
    if (ExternalAuthConfig.baseUrl) {
      const keystoneBaseUrl = ExternalAuthConfig.baseUrl.replace(/\/$/, "");
      if (!issuers.includes(keystoneBaseUrl)) {
        issuers.push(keystoneBaseUrl);
      }
      if (keystoneBaseUrl.endsWith('/api')) {
        const baseWithoutApi = keystoneBaseUrl.slice(0, -4);
        if (!issuers.includes(baseWithoutApi)) {
          issuers.push(baseWithoutApi);
        }
      }
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
    if (requestId || path) {
      console.log(`\x1b[36m[Delegated Token Validation]\x1b[0m - Starting verification${requestId ? ` | RequestId: ${requestId}` : ""}${path ? ` | Path: ${method || ""} ${path}` : ""}`);
    }

    // Decode token header to log algorithm
    const decodedHeader = jwt.decode(token, { complete: true });
    const tokenAlg = decodedHeader?.header?.alg;

    console.log(`\x1b[36m[Delegated Token Validation]\x1b[0m - Token algorithm: ${tokenAlg} (forcing HS256)${requestId ? ` | RequestId: ${requestId}` : ""}`);

    // FORCE HS256 verification - Keystone uses symmetric secret even if header says RS256
    // This is a workaround until Keystone properly sets alg: HS256 in the JWT header
    const verifyOptions = {
      algorithms: ["HS256"],
    };

    const decoded = jwt.verify(token, DELEGATED_JWT_SECRET, verifyOptions);

    // Validate issuer
    const allowedIssuers = getAllowedIssuers();
    if (allowedIssuers.length > 0 && !allowedIssuers.includes(decoded.iss)) {
      const errorMsg = `Issuer mismatch: expected one of [${allowedIssuers.join(", ")}], got ${decoded.iss}`;
      console.error(`\x1b[31m[Delegated Token Validation Failed]\x1b[0m - ${errorMsg}${requestId ? ` | RequestId: ${requestId}` : ""}`);
      throw new Error(errorMsg);
    }

    // Validate audience
    const allowedAudiences = [DELEGATED_JWT_AUDIENCE, "anythingllm"].filter(Boolean);
    if (!allowedAudiences.includes(decoded.aud)) {
      const errorMsg = `Audience mismatch: expected one of [${allowedAudiences.join(", ")}], got ${decoded.aud}`;
      console.error(`\x1b[31m[Delegated Token Validation Failed]\x1b[0m - ${errorMsg}${requestId ? ` | RequestId: ${requestId}` : ""}`);
      throw new Error(errorMsg);
    }

    // Validate expiration
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

    // Parse scope
    let scopeArray = [];
    if (decoded.scope) {
      if (Array.isArray(decoded.scope)) {
        scopeArray = decoded.scope;
      } else if (typeof decoded.scope === "string") {
        scopeArray = decoded.scope.split(" ").filter(Boolean);
      }
    }

    const result = {
      sub: decoded.sub,
      act: {
        sub: decoded.act.sub,
        roles: decoded.act.roles,
        sessionId: decoded.act.sessionId || null,
        provider: decoded.act.provider || null,
      },
      scope: scopeArray,
      exp: decoded.exp,
      iat: decoded.iat,
    };

    if (requestId || path) {
      console.log(`\x1b[32m[Delegated Token Validation Success]\x1b[0m${requestId ? ` | RequestId: ${requestId}` : ""}${path ? ` | Path: ${method || ""} ${path}` : ""} | Service: ${result.sub} | Delegated User: ${result.act.sub} | Roles: [${result.act.roles.join(", ")}]`);
    }

    return result;
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      const errorMsg = `Delegated JWT verification failed: ${error.message}`;
      console.error(`\x1b[31m[Delegated Token Validation Failed]\x1b[0m - ${errorMsg}${requestId ? ` | RequestId: ${requestId}` : ""}${path ? ` | Path: ${method || ""} ${path}` : ""}`);
      throw new Error(errorMsg);
    }
    console.error(`\x1b[31m[Delegated Token Validation Failed]\x1b[0m - ${error.message}${requestId ? ` | RequestId: ${requestId}` : ""}${path ? ` | Path: ${method || ""} ${path}` : ""}`);
    throw error;
  }
}

/**
 * Check if a token appears to be a delegated token (has act claim)
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
