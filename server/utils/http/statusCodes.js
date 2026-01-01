/**
 * HTTP Status Code Utilities
 * 
 * Provides semantic status codes following REST API best practices.
 * 
 * Principles:
 * - 201 Created: POST requests that successfully create a new resource (with response body)
 * - 204 No Content: Successful operations that don't return content (DELETE, some updates)
 * - 200 OK: Successful operations that return content (GET, PUT, PATCH with content)
 * - 400 Bad Request: Client errors (validation, malformed requests)
 * - 404 Not Found: Resource not found
 * - 401 Unauthorized: Authentication required
 * - 403 Forbidden: Authenticated but not authorized
 * - 500 Internal Server Error: Server errors
 */

/**
 * Determines the appropriate HTTP status code for a resource creation operation
 * 
 * REST API Best Practice:
 * - 201 Created: Standard for POST requests that successfully create a resource and return it
 * - 204 No Content: Used when creation succeeds but no content is returned (less common for POST)
 * 
 * @param {boolean} success - Whether the operation succeeded
 * @param {boolean} hasContent - Whether the response includes the created resource
 * @param {object} options - Optional configuration
 * @param {boolean} options.use204ForCreation - If true, return 204 instead of 201 for successful creation (non-standard but acceptable)
 * @returns {number} HTTP status code (201 if success with content, 204 if success without content, 400 if failed)
 */
function statusForCreation(success, hasContent = true, options = {}) {
  if (!success) return 400;
  
  // Allow override to use 204 for creation (non-standard but sometimes preferred)
  if (options.use204ForCreation) {
    return 204;
  }
  
  // 201 Created: Resource was created and we're returning it (REST standard)
  // 204 No Content: Resource was created but we're not returning it (less common for POST)
  return hasContent ? 201 : 204;
}

/**
 * Determines the appropriate HTTP status code for a resource update operation
 * @param {boolean} success - Whether the operation succeeded
 * @param {boolean} hasContent - Whether the response includes the updated resource
 * @returns {number} HTTP status code (200 if success with content, 204 if success without content, 400 if failed)
 */
function statusForUpdate(success, hasContent = true) {
  if (!success) return 400;
  // 200 OK: Update succeeded and we're returning the updated resource
  // 204 No Content: Update succeeded but we're not returning content
  return hasContent ? 200 : 204;
}

/**
 * Determines the appropriate HTTP status code for a resource deletion operation
 * @param {boolean} success - Whether the operation succeeded
 * @returns {number} HTTP status code (204 if success, 404 if resource not found, 400 if failed)
 */
function statusForDeletion(success, notFound = false) {
  if (notFound) return 404;
  if (!success) return 400;
  // 204 No Content: Standard for successful DELETE operations
  return 204;
}

/**
 * Determines the appropriate HTTP status code for a retrieval operation
 * @param {boolean} success - Whether the operation succeeded
 * @param {boolean} found - Whether the resource was found
 * @returns {number} HTTP status code (200 if success, 404 if not found, 400 if failed)
 */
function statusForRetrieval(success, found = true) {
  if (!success) return 400;
  if (!found) return 404;
  return 200;
}

/**
 * Generic status code selector based on operation type
 * @param {string} operation - Operation type: 'create', 'update', 'delete', 'retrieve'
 * @param {boolean} success - Whether the operation succeeded
 * @param {object} options - Additional options
 * @param {boolean} options.hasContent - Whether response includes resource content
 * @param {boolean} options.notFound - Whether resource was not found (for delete/retrieve)
 * @returns {number} HTTP status code
 */
function statusForOperation(operation, success, options = {}) {
  const { hasContent = true, notFound = false } = options;

  switch (operation) {
    case 'create':
      return statusForCreation(success, hasContent);
    case 'update':
      return statusForUpdate(success, hasContent);
    case 'delete':
      return statusForDeletion(success, notFound);
    case 'retrieve':
      return statusForRetrieval(success, !notFound);
    default:
      return success ? 200 : 400;
  }
}

module.exports = {
  statusForCreation,
  statusForUpdate,
  statusForDeletion,
  statusForRetrieval,
  statusForOperation,
};
