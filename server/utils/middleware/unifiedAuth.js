const { ApiKey } = require("../../models/apiKeys");
const {
  introspectKeystoneTokenFromRequest,
  buildDefaultUserPrincipal,
} = require("../auth/keystoneIntrospection");
const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");

/**
 * Unified authentication middleware for user endpoints
 * Tries API key first (for admin access), then Keystone JWT introspection (for default users)
 * @param {Object} request - Express request object
 * @param {Object} response - Express response object
 * @param {Function} next - Express next function
 */
async function unifiedAuth(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;

  const auth = request.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    response.status(401).json({
      error: "No authorization token found.",
    });
    return;
  }

  const token = auth.split(" ")[1];
  if (!token) {
    response.status(401).json({
      error: "No authorization token found.",
    });
    return;
  }

  // Step 1: Try API key lookup first (for admin access)
  const apiKey = await ApiKey.get({ secret: token });
  if (apiKey) {
    // API key found - create Admin Principal
    response.locals.principal = {
      type: "admin",
      apiKey: apiKey,
    };
    response.locals.user = null; // Admin doesn't need user object for user endpoints
    next();
    return;
  }

  // Step 2: If not API key, treat as Keystone JWT and do introspection
  // Only do introspection if external auth is enabled
  // Check with trimming and removing inline comments to handle .env file format
  const rawValue = process.env.EXTERNAL_AUTH_ENABLED;
  const externalAuthEnabled = String(rawValue || "")
    .split("#")[0] // Remove inline comments
    .trim()
    .toLowerCase();
  
  // Debug logging
  console.log("[unifiedAuth] EXTERNAL_AUTH_ENABLED check:", {
    raw: rawValue,
    type: typeof rawValue,
    normalized: externalAuthEnabled,
    allEnvKeys: Object.keys(process.env).filter(k => k.includes("EXTERNAL_AUTH"))
  });
  
  if (externalAuthEnabled !== "true") {
    console.error("[unifiedAuth] EXTERNAL_AUTH_ENABLED check failed. Raw value:", rawValue, "normalized:", externalAuthEnabled);
    response.status(401).json({
      error: "External authentication is not enabled. Check EXTERNAL_AUTH_ENABLED in .env file.",
      debug: process.env.NODE_ENV === "development" ? {
        rawValue: rawValue,
        normalized: externalAuthEnabled,
        envKeys: Object.keys(process.env).filter(k => k.includes("EXTERNAL"))
      } : undefined
    });
    return;
  }

  const introspectionResult = await introspectKeystoneTokenFromRequest(request);
  if (!introspectionResult || !introspectionResult.active) {
    console.error("[unifiedAuth] Introspection failed or token not active:", {
      hasResult: !!introspectionResult,
      active: introspectionResult?.active,
      sub: introspectionResult?.sub,
    });
    response.status(401).json({
      error: "Invalid or expired token.",
    });
    return;
  }

  // Build Default User Principal from introspection result
  const userPrincipal = buildDefaultUserPrincipal(introspectionResult);
  if (!userPrincipal) {
    response.status(401).json({
      error: "Invalid token format.",
    });
    return;
  }

  // Try to find or create user from external auth
  let user = null;
  if (userPrincipal.externalId && userPrincipal.externalProvider) {
    user = await User.get({
      externalId: userPrincipal.externalId,
      externalProvider: userPrincipal.externalProvider,
    });

    if (!user) {
      user = await User.findOrCreateExternalUser({
        externalId: userPrincipal.externalId,
        externalProvider: userPrincipal.externalProvider,
        username: userPrincipal.username || userPrincipal.sub,
        role: userPrincipal.role,
      });
    }

    if (!user) {
      response.status(401).json({
        error: "User not found.",
      });
      return;
    }

    if (user.suspended) {
      response.status(401).json({
        error: "User is suspended from system",
      });
      return;
    }
  }

  // Set Default User Principal
  response.locals.principal = {
    type: "default",
    ...userPrincipal,
  };
  response.locals.user = user;
  next();
}

/**
 * Admin-only authentication middleware
 * Only accepts API keys (no Keystone JWT fallback)
 * @param {Object} request - Express request object
 * @param {Object} response - Express response object
 * @param {Function} next - Express next function
 */
async function adminOnlyAuth(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;

  const auth = request.header("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    response.status(401).json({
      error: "No authorization token found.",
    });
    return;
  }

  const token = auth.split(" ")[1];
  if (!token) {
    response.status(401).json({
      error: "No authorization token found.",
    });
    return;
  }

  // Only check API key - no Keystone JWT fallback for admin endpoints
  const apiKey = await ApiKey.get({ secret: token });
  if (!apiKey) {
    response.status(401).json({
      error: "Invalid API key. Admin endpoints require a valid API key.",
    });
    return;
  }

  // Create Admin Principal
  response.locals.principal = {
    type: "admin",
    apiKey: apiKey,
  };
  next();
}

module.exports = {
  unifiedAuth,
  adminOnlyAuth,
};

