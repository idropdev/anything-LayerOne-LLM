const { SystemSettings } = require("../../models/systemSettings");
const { EncryptionManager } = require("../EncryptionManager");
const JWT = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const EncryptionMgr = new EncryptionManager();

/**
 * Middleware to require JWT authentication with admin role
 * IMPORTANT: This middleware ONLY uses internal JWT decoding - it NEVER calls external auth introspection
 * - Multi-user mode: requires role === "admin" in JWT token (from /request-token endpoint)
 * - Single-user mode: requires valid AUTH_TOKEN (anyone with token is admin)
 * - External auth is explicitly bypassed - admin endpoints use only internal JWT validation
 *
 * This middleware decodes JWTs created by /request-token which use JWT_SECRET and contain:
 * Multi-user: { id, username, role }
 * Single-user: { p: encrypted(password) }
 */
async function requireAdmin(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;

  // Get Authorization header
  const authHeader = request.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return response.status(401).json({
      error: "Invalid or expired token",
    });
  }

  // Extract token
  const token = authHeader.split(" ")[1];

  if (!token) {
    return response.status(401).json({
      error: "Invalid or expired token",
    });
  }

  if (multiUserMode) {
    // Multi-user mode: ONLY accept API keys (no JWT fallback)
    // API keys are validated against the database
    const { ApiKey } = require("../../models/apiKeys");
    const { User } = require("../../models/user");

    const apiKey = await ApiKey.get({ secret: token });

    if (!apiKey) {
      return response.status(401).json({
        error: "Invalid or expired token",
      });
    }

    // Fetch the user who created this API key
    if (!apiKey.createdBy) {
      return response.status(401).json({
        error: "Invalid API key - no associated user",
      });
    }

    const user = await User.get({ id: apiKey.createdBy });

    if (!user) {
      return response.status(401).json({
        error: "Invalid API key - user not found",
      });
    }

    // Verify the user is an admin
    if (user.role !== "admin") {
      return response.status(403).json({
        error: "Forbidden - admin access required",
      });
    }

    // Check if user is suspended
    if (user.suspended) {
      return response.status(403).json({
        error: "Forbidden - user account suspended",
      });
    }

    // Attach user to request
    request.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };

    return next();
  } else {
    // Single-user mode: validate using AUTH_TOKEN (same as before)
    // In development or if no AUTH_TOKEN/JWT_SECRET, allow passthrough
    if (
      process.env.NODE_ENV === "development" ||
      !process.env.AUTH_TOKEN ||
      !process.env.JWT_SECRET
    ) {
      request.user = { id: null, username: null, role: "admin" }; // Default for single-user
      return next();
    }

    // Verify JWT using internal JWT_SECRET
    let decoded;
    try {
      if (!process.env.JWT_SECRET) {
        return response.status(500).json({
          error: "JWT_SECRET not configured",
        });
      }
      decoded = JWT.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return response.status(401).json({
        error: "Invalid or expired token",
      });
    }

    if (!decoded || !decoded.p) {
      return response.status(401).json({
        error: "Invalid or expired token",
      });
    }

    // Validate the p property (encrypted password)
    if (!/\w{32}:\w{32}/.test(decoded.p)) {
      return response.status(401).json({
        error: "Invalid or expired token",
      });
    }

    // Verify the encrypted password matches AUTH_TOKEN
    if (
      !bcrypt.compareSync(
        EncryptionMgr.decrypt(decoded.p),
        bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
      )
    ) {
      return response.status(401).json({
        error: "Invalid or expired token",
      });
    }

    // In single-user mode, anyone with valid token is admin
    request.user = { id: null, username: null, role: "admin" };
  }

  next();
}

module.exports = { requireAdmin };
