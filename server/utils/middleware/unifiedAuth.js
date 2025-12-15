const { ApiKey } = require("../../models/apiKeys");
const {
  introspectKeystoneTokenFromRequest,
  buildDefaultUserPrincipal,
} = require("../auth/keystoneIntrospection");
const { verifyAdminJWTFromRequest } = require("../auth/adminJWT");
const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const JWT = require("jsonwebtoken");

/**
 * Unified authentication middleware for shared endpoints
 * Routes authentication based on JWT role:
 * - Admin role: Uses internal JWT verification
 * - Default role: Uses Keystone JWT introspection
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

  // Step 1: Decode JWT to check the role field (without full verification)
  let decodedToken;
  try {
    decodedToken = JWT.decode(token);
  } catch (error) {
    console.error("[unifiedAuth] Failed to decode JWT:", error.message);
    response.status(401).json({
      error: "Invalid token format.",
    });
    return;
  }

  if (!decodedToken) {
    response.status(401).json({
      error: "Invalid token format.",
    });
    return;
  }

  console.log("[unifiedAuth] Decoded JWT role:", decodedToken.role);

  // Step 2: Route authentication based on role
  if (decodedToken.role === "admin") {
    // Admin role - use internal JWT verification
    console.log("[unifiedAuth] Admin role detected, using internal JWT verification");
    
    const adminJWT = verifyAdminJWTFromRequest(request);
    if (!adminJWT) {
      response.status(401).json({
        error: "Invalid or expired admin JWT.",
      });
      return;
    }

    // Find or create user from admin JWT
    let user = null;
    if (adminJWT.id) {
      user = await User.get({ id: Number(adminJWT.id) });
      
      if (!user && adminJWT.username) {
        // Try to find by username
        user = await User.get({ username: String(adminJWT.username) });
      }

      if (user && user.suspended) {
        response.status(401).json({
          error: "User is suspended from system",
        });
        return;
      }
    }

    // Create Admin Principal
    response.locals.principal = {
      type: "admin",
      sub: adminJWT.sub || adminJWT.id,
      role: adminJWT.role,
      username: adminJWT.username,
    };
    response.locals.user = user;
    next();
    return;
  }

  // Step 3: Default role or any other role - use Keystone introspection
  console.log("[unifiedAuth] Default/other role detected, using Keystone introspection");
  
  // Check if external auth is enabled
  const rawValue = process.env.EXTERNAL_AUTH_ENABLED;
  const externalAuthEnabled = String(rawValue || "")
    .split("#")[0] // Remove inline comments
    .trim()
    .toLowerCase();
  
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

