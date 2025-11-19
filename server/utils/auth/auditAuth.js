/**
 * Authentication Audit Logging
 * 
 * HIPAA-compliant audit logging for authentication events.
 * 
 * Rules:
 * - Never log raw tokens
 * - Never log PHI (email, name, etc.)
 * - Only log: userId, timestamp, IP, event type, success/failure
 */

const { EventLogs } = require("../../models/eventLogs");

/**
 * Log authentication events (HIPAA-compliant)
 * 
 * @param {string} eventType - Type of event (e.g., "external_auth_token_validated")
 * @param {Object} metadata - Additional metadata (must not contain PHI or tokens)
 * @param {number|null} userId - User ID if available
 * @returns {Promise<void>}
 */
async function logAuthEvent(eventType, metadata = {}, userId = null) {
  try {
    await EventLogs.logEvent(eventType, {
      ...metadata,
      authProvider: "keystone-core-api",
      timestamp: new Date().toISOString()
    }, userId);

    // TODO: Forward to GCP Cloud Logging for HIPAA audit retention
    // Structured logging for SIEM integration
    // console.info(JSON.stringify({
    //   compliance: "HIPAA",
    //   event: eventType,
    //   ...metadata,
    //   userId: userId || null
    // }));
  } catch (error) {
    // Don't fail auth if logging fails, but log the error
    console.error("Failed to log auth event:", error.message);
  }
}

module.exports = { logAuthEvent };



