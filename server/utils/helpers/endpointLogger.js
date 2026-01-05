/**
 * Endpoint Operation Logger
 * 
 * Provides consistent logging for all endpoint operations following
 * AnythingLLM's internal logging practices.
 */

const { EventLogs } = require("../../models/eventLogs");

/**
 * Log an endpoint operation
 * @param {Object} params - Logging parameters
 * @param {string} params.method - HTTP method (GET, POST, etc.)
 * @param {string} params.path - Request path
 * @param {string} params.operation - Operation name (e.g., "workspace_created", "user_updated")
 * @param {Object} params.metadata - Additional context metadata
 * @param {number|null} params.userId - User ID who performed the operation
 * @param {boolean} params.skipEventLog - Skip EventLogs.logEvent (default: false)
 */
async function logEndpointOperation({
  method,
  path,
  operation,
  metadata = {},
  userId = null,
  skipEventLog = false,
}) {
  const logMetadata = {
    method,
    path,
    ...metadata,
  };

  // Console log for operation tracking
  console.log(
    `\x1b[36m[Endpoint Operation]\x1b[0m - ` +
    `${method} ${path} | Operation: ${operation} | UserId: ${userId || "system"}`
  );

  // Event log for audit trail (unless skipped)
  if (!skipEventLog) {
    try {
      await EventLogs.logEvent(operation, logMetadata, userId);
    } catch (error) {
      console.error(
        `\x1b[31m[Event Logging Failed]\x1b[0m - ${operation}`,
        error.message
      );
    }
  }
}

/**
 * Log an endpoint error
 * @param {Object} params - Error logging parameters
 * @param {string} params.method - HTTP method
 * @param {string} params.path - Request path
 * @param {string} params.operation - Operation name
 * @param {Error} params.error - Error object
 * @param {number|null} params.userId - User ID
 */
function logEndpointError({ method, path, operation, error, userId = null }) {
  console.error(
    `\x1b[31m[Endpoint Error]\x1b[0m - ` +
    `${method} ${path} | Operation: ${operation} | UserId: ${userId || "system"} | ` +
    `Error: ${error.message || error}`
  );
}

module.exports = {
  logEndpointOperation,
  logEndpointError,
};




