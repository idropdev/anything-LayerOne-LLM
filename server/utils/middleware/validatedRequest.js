const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { EncryptionManager } = require("../EncryptionManager");
const { decodeJWT } = require("../http");
const { validateExternalUserToken } = require("./validateExternalUserToken");
const { ExternalAuthConfig } = require("../auth/config");
const EncryptionMgr = new EncryptionManager();

async function validatedRequest(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;

  if (ExternalAuthConfig.enabled && multiUserMode) {
    // Check if this is an internal admin JWT first
    // Internal admin JWTs have { id, username, role } structure
    // External Keystone JWTs will be handled by validateExternalUserToken
    const auth = request.header("Authorization");
    const token = auth ? auth.split(" ")[1] : null;

    if (token) {
      // Reject API keys on shared endpoints - they should only work on admin endpoints
      // API keys are UUIDs, typically in format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      // or the custom format from uuid-apikey package
      const { ApiKey } = require("../../models/apiKeys");
      const apiKey = await ApiKey.get({ secret: token });
      
      if (apiKey) {
        // This is an API key, not a JWT - reject it
        return response.status(401).json({
          error: "API keys cannot be used on this endpoint. Use JWT authentication.",
        });
      }

      try {
        // Try to decode as internal JWT
        const decoded = decodeJWT(token);
        
        // If it has id, username, and role, it's an internal JWT
        if (decoded && decoded.id && decoded.username && decoded.role) {
          // Validate internal admin JWT
          const user = await User.get({ id: decoded.id });
          
          if (user && user.role === "admin" && !user.suspended) {
            // Valid internal admin JWT - allow access
            response.locals.user = user;
            return next();
          }
        }
      } catch (error) {
        // Not an internal JWT, fall through to external validation
      }
    }

    // Not an internal admin JWT, use external validation
    return validateExternalUserToken(request, response, next);
  }

  if (multiUserMode)
    return await validateMultiUserRequest(request, response, next);

  // When in development passthrough auth token for ease of development.
  // Or if the user simply did not set an Auth token or JWT Secret
  if (
    process.env.NODE_ENV === "development" ||
    !process.env.AUTH_TOKEN ||
    !process.env.JWT_SECRET
  ) {
    next();
    return;
  }

  if (!process.env.AUTH_TOKEN) {
    response.status(401).json({
      error: "You need to set an AUTH_TOKEN environment variable.",
    });
    return;
  }

  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const bcrypt = require("bcrypt");
  const { p } = decodeJWT(token);

  if (p === null || !/\w{32}:\w{32}/.test(p)) {
    response.status(401).json({
      error: "Token expired or failed validation.",
    });
    return;
  }

  // Since the blame of this comment we have been encrypting the `p` property of JWTs with the persistent
  // encryptionManager PEM's. This prevents us from storing the `p` unencrypted in the JWT itself, which could
  // be unsafe. As a consequence, existing JWTs with invalid `p` values that do not match the regex
  // in ln:44 will be marked invalid so they can be logged out and forced to log back in and obtain an encrypted token.
  // This kind of methodology only applies to single-user password mode.
  if (
    !bcrypt.compareSync(
      EncryptionMgr.decrypt(p),
      bcrypt.hashSync(process.env.AUTH_TOKEN, 10)
    )
  ) {
    response.status(401).json({
      error: "Invalid auth credentials.",
    });
    return;
  }

  next();
}

async function validateMultiUserRequest(request, response, next) {
  const auth = request.header("Authorization");
  const token = auth ? auth.split(" ")[1] : null;

  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const valid = decodeJWT(token);
  if (!valid || !valid.id) {
    response.status(401).json({
      error: "Invalid auth token.",
    });
    return;
  }

  const user = await User.get({ id: valid.id });
  if (!user) {
    response.status(401).json({
      error: "Invalid auth for user.",
    });
    return;
  }

  if (user.suspended) {
    response.status(401).json({
      error: "User is suspended from system",
    });
    return;
  }

  response.locals.user = user;
  next();
}

module.exports = {
  validatedRequest,
};
