/**
 * Composed middleware for workspace provisioning routes
 *
 * TODO: POLICY DECISION REQUIRED
 * Should workspace provisioning routes allow internal admin users,
 * or should they be service-actor-only like admin routes?
 *
 * Current implementation: Service identity only (same as admin routes)
 * To allow internal admins in the future, this middleware would need
 * to check for service identity first, then fall back to internal admin check.
 */
const { validateKeystoneServiceCaller } = require("./validateKeystoneServiceCaller");

/**
 * Middleware for workspace provisioning routes
 * Currently requires service identity (same as admin routes)
 * TODO: If policy decision allows internal admins, implement fallback logic
 */
async function requireServiceOrAdmin(request, response, next) {
  // Use service identity verification (same as admin routes)
  return validateKeystoneServiceCaller(request, response, next);
}

module.exports = { requireServiceOrAdmin };
