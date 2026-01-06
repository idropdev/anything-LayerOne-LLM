/**
 * Scope Enforcement Middleware for Delegated JWT Mode
 *
 * Optional defense-in-depth middleware that enforces scope-to-endpoint mapping
 * for delegated JWT requests. This is NOT authorization - Keystone is the
 * authorization authority. This is additional validation only.
 *
 * IMPORTANT: This middleware does NOT use delegatedActor.roles for authorization.
 * Roles in the act claim are for audit/observability only.
 */

const ENABLE_SCOPE_ENFORCEMENT = process.env.ENABLE_DELEGATED_SCOPE_ENFORCEMENT === "true";

/**
 * Scope-to-endpoint mapping table
 * Maps route patterns to required scopes
 */
const SCOPE_ENDPOINT_MAP = {
  // Admin read operations
  "GET /v1/admin/is-multi-user-mode": ["anythingllm:admin:read"],
  "GET /v1/admin/users": ["anythingllm:admin:read"],
  "GET /v1/admin/invites": ["anythingllm:admin:read"],
  "GET /v1/admin/workspaces/:workspaceId/users": ["anythingllm:admin:read"],

  // Admin write operations
  "POST /v1/admin/users/new": ["anythingllm:admin:write"],
  "POST /v1/admin/users/:id": ["anythingllm:admin:write"],
  "DELETE /v1/admin/users/:id": ["anythingllm:admin:write"],
  "POST /v1/admin/invite/new": ["anythingllm:admin:write"],
  "DELETE /v1/admin/invite/:id": ["anythingllm:admin:write"],
  "POST /v1/admin/workspaces/:workspaceId/update-users": ["anythingllm:admin:write"],
  "POST /v1/admin/workspaces/:workspaceSlug/manage-users": ["anythingllm:admin:write"],
  "POST /v1/admin/preferences": ["anythingllm:admin:write"],
  "POST /v1/admin/workspace-chats": ["anythingllm:admin:read"],

  // Thread operations (if Keystone calls these)
  "POST /v1/workspace/:slug/thread/:threadSlug/chat": ["anythingllm:thread:write"],
  "GET /v1/workspace/:slug/thread/:threadSlug/chats": ["anythingllm:thread:read"],

  // Workspace operations
  "POST /v1/workspace/new": ["anythingllm:workspace:write"],
};

/**
 * Normalize path for pattern matching
 * Replaces dynamic segments with placeholders
 */
function normalizePath(path) {
  // Replace numeric IDs
  let normalized = path.replace(/\/\d+/g, "/:id");
  // Replace workspace slugs (for manage-users pattern)
  normalized = normalized.replace(/\/[a-z0-9-]+(?=\/manage-users)/, "/:workspaceSlug");
  // Replace thread slugs
  normalized = normalized.replace(/\/[a-z0-9-]+(?=\/thread\/)/, "/:slug");
  normalized = normalized.replace(/\/thread\/[a-z0-9-]+(?=\/)/, "/thread/:threadSlug");
  return normalized;
}

/**
 * Get required scopes for a given method and path
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @returns {string[]} - Array of required scopes, or empty array if not found
 */
function getRequiredScopes(method, path) {
  const normalizedPath = normalizePath(path);
  const routeKey = `${method} ${normalizedPath}`;

  // Try exact match first
  if (SCOPE_ENDPOINT_MAP[routeKey]) {
    return SCOPE_ENDPOINT_MAP[routeKey];
  }

  // Try pattern matching for dynamic routes
  for (const [pattern, scopes] of Object.entries(SCOPE_ENDPOINT_MAP)) {
    const patternMethod = pattern.split(" ")[0];
    const patternPath = pattern.split(" ")[1];

    if (patternMethod === method) {
      // Convert pattern to regex (e.g., /v1/admin/users/:id -> /v1/admin/users/[^/]+)
      const regexPattern = patternPath.replace(/:[^/]+/g, "[^/]+");
      const regex = new RegExp(`^${regexPattern}$`);

      if (regex.test(normalizedPath) || regex.test(path)) {
        return scopes;
      }
    }
  }

  // No mapping found - return empty array (no enforcement)
  return [];
}

/**
 * Middleware factory for scope enforcement
 * @param {string[]} requiredScopes - Explicit required scopes (optional, will auto-detect if not provided)
 * @returns {Function} Express middleware function
 */
function enforceDelegatedScopes(requiredScopes = null) {
  return (request, response, next) => {
    // Only enforce if delegated mode AND feature enabled
    if (response.locals.authMode !== "keystone_delegated_jwt") {
      return next(); // Skip for other modes
    }

    if (!ENABLE_SCOPE_ENFORCEMENT) {
      return next(); // Skip if feature disabled
    }

    // Determine required scopes
    const scopesToCheck = requiredScopes || getRequiredScopes(request.method, request.path);

    // If no scopes required, allow
    if (scopesToCheck.length === 0) {
      return next();
    }

    // Get user scopes from response.locals
    const userScopes = response.locals.scope || [];

    // Check if user has all required scopes
    const hasRequiredScopes = scopesToCheck.every((scope) =>
      userScopes.includes(scope)
    );

    if (!hasRequiredScopes) {
      console.log(
        `\x1b[33m[Scope Enforcement Failed]\x1b[0m - ` +
        `Insufficient scopes | Method: ${request.method} | Path: ${request.path} | ` +
        `Required: [${scopesToCheck.join(", ")}] | Provided: [${userScopes.join(", ")}]`
      );
      return response.status(403).json({
        error: "Insufficient scope permissions",
        required: scopesToCheck,
        provided: userScopes,
      });
    }

    next();
  };
}

module.exports = { enforceDelegatedScopes, getRequiredScopes };









