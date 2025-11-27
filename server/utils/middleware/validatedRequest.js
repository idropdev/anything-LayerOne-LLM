const { SystemSettings } = require("../../models/systemSettings");
const { User } = require("../../models/user");
const { EncryptionManager } = require("../EncryptionManager");
const { decodeJWT } = require("../http");
const EncryptionMgr = new EncryptionManager();

async function validatedRequest(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;
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
  if (!auth || !auth.startsWith("Bearer ")) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  const token = auth.split(" ")[1];
  if (!token) {
    response.status(401).json({
      error: "No auth token found.",
    });
    return;
  }

  // Step 1: Try API key lookup first (for admin access)
  const { ApiKey } = require("../../models/apiKeys");
  const apiKey = await ApiKey.get({ secret: token });
  if (apiKey) {
    // API key found - admin access
    // For UI endpoints, we might still need a user object, but admins can access
    response.locals.principal = {
      type: "admin",
      apiKey: apiKey,
    };
    // Note: UI endpoints might need user object, but for now we'll allow admin API keys
    next();
    return;
  }

  // Step 2: If not API key, treat as Keystone JWT and do introspection
  // Check if external auth is enabled (with trimming and removing inline comments)
  const externalAuthEnabled = String(process.env.EXTERNAL_AUTH_ENABLED || "")
    .split("#")[0] // Remove inline comments
    .trim()
    .toLowerCase();
  if (externalAuthEnabled !== "true") {
    console.error("[validatedRequest] EXTERNAL_AUTH_ENABLED check failed. Raw value:", process.env.EXTERNAL_AUTH_ENABLED, "normalized:", externalAuthEnabled);
    response.status(401).json({
      error: "External authentication is not enabled. Check EXTERNAL_AUTH_ENABLED in .env file.",
    });
    return;
  }

  const {
    introspectKeystoneTokenFromRequest,
    buildDefaultUserPrincipal,
  } = require("../auth/keystoneIntrospection");

  const introspectionResult = await introspectKeystoneTokenFromRequest(request);
  if (!introspectionResult || !introspectionResult.active) {
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

  // Find user from external auth
  let user = await User.get({
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

  response.locals.user = user;
  response.locals.principal = {
    type: "default",
    ...userPrincipal,
  };
  next();
}

module.exports = {
  validatedRequest,
};

