/**
 * Authorization Helper Functions
 *
 * Provides role-based authorization utilities for use with delegated tokens.
 * These functions check roles from req.user.roles (extracted from act.roles in delegated tokens).
 */

/**
 * Check if user has a specific role
 * @param {Object} user - User object with roles array (from req.user)
 * @param {string} role - Role to check (e.g., 'admin', 'manager', 'user')
 * @returns {boolean}
 */
function hasRole(user, role) {
  if (!user || !user.roles) {
    return false;
  }
  return Array.isArray(user.roles) && user.roles.includes(role);
}

/**
 * Check if user is an admin
 * @param {Object} user - User object with roles array
 * @returns {boolean}
 */
function isAdmin(user) {
  return hasRole(user, "admin");
}

/**
 * Check if user is a manager
 * @param {Object} user - User object with roles array
 * @returns {boolean}
 */
function isManager(user) {
  return hasRole(user, "manager");
}

/**
 * Check if user is a standard user
 * @param {Object} user - User object with roles array
 * @returns {boolean}
 */
function isUser(user) {
  return hasRole(user, "user");
}

/**
 * Require a specific role, throw error if user doesn't have it
 * @param {Object} user - User object with roles array
 * @param {string} requiredRole - Required role
 * @throws {Error} If user doesn't have the required role
 */
function requireRole(user, requiredRole) {
  if (!hasRole(user, requiredRole)) {
    throw new Error(`Role '${requiredRole}' required`);
  }
}

/**
 * Require admin role, throw error if user is not admin
 * @param {Object} user - User object with roles array
 * @throws {Error} If user is not an admin
 */
function requireAdmin(user) {
  requireRole(user, "admin");
}

/**
 * Require manager or admin role, throw error if user is neither
 * @param {Object} user - User object with roles array
 * @throws {Error} If user is not a manager or admin
 */
function requireManagerOrAdmin(user) {
  if (!isAdmin(user) && !isManager(user)) {
    throw new Error("Manager or Admin role required");
  }
}

/**
 * Require at least user role (all authenticated users)
 * This is mostly for clarity/documentation
 * @param {Object} user - User object with roles array
 * @throws {Error} If user has no roles (shouldn't happen with valid delegated tokens)
 */
function requireUser(user) {
  if (!user || !user.roles || user.roles.length === 0) {
    throw new Error("User role required");
  }
}

module.exports = {
  hasRole,
  isAdmin,
  isManager,
  isUser,
  requireRole,
  requireAdmin,
  requireManagerOrAdmin,
  requireUser,
};






