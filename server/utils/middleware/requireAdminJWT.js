const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { EncryptionManager } = require("../EncryptionManager");
const JWT = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const EncryptionMgr = new EncryptionManager();

/**
 * Middleware to require JWT authentication with admin role
 * This is specifically for the /admin/generate-api-key endpoint
 * which needs JWT auth to prove admin status before generating API keys.
 * 
 * All other admin endpoints use API key authentication via requireAdmin middleware.
 */
async function requireAdminJWT(request, response, next) {
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

  // Verify JWT using internal JWT_SECRET only
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

  if (multiUserMode) {
    // Multi-user mode: JWT should contain { id, username, role }
    if (!decoded || !decoded.id || !decoded.username) {
      return response.status(401).json({
        error: "Invalid or expired token",
      });
    }

    // Check if role exists and is admin
    if (!decoded.role || decoded.role !== "admin") {
      return response.status(403).json({
        error: "Forbidden",
      });
    }

    // Attach decoded payload to request
    request.user = decoded;
  } else {
    // Single-user mode: validate using AUTH_TOKEN
    if (
      process.env.NODE_ENV === "development" ||
      !process.env.AUTH_TOKEN ||
      !process.env.JWT_SECRET
    ) {
      request.user = { id: null, username: null, role: "admin" };
      return next();
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

    request.user = { id: null, username: null, role: "admin" };
  }

  next();
}

module.exports = { requireAdminJWT };
