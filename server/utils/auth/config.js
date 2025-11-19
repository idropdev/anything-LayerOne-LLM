/**
 * External Authentication Configuration
 * 
 * Handles configuration for Keystone Core API token validation.
 * Supports both introspection mode (recommended) and shared-secret mode (backup only).
 * 
 * Standards Compliance:
 * - RFC 7662 (OAuth 2.0 Token Introspection)
 * - RFC 6750 (OAuth 2.0 Bearer Token Usage)
 * - RFC 7519 (JSON Web Token)
 * - HIPAA Compliance (no PHI in tokens/logs)
 */

const ExternalAuthConfig = {
  enabled: process.env.EXTERNAL_AUTH_ENABLED === "true",
  mode: process.env.EXTERNAL_AUTH_MODE || "introspect",
  apiUrl: process.env.EXTERNAL_AUTH_API_URL,
  issuer: process.env.EXTERNAL_AUTH_ISSUER,
  audience: process.env.EXTERNAL_AUTH_AUDIENCE,
  serviceKey: process.env.EXTERNAL_API_SERVICE_KEY,
  cacheTTL: parseInt(process.env.EXTERNAL_AUTH_INTROSPECTION_CACHE_TTL || "300", 10),
  requireHTTPS: process.env.NODE_ENV === "production" && 
                process.env.EXTERNAL_AUTH_REQUIRE_HTTPS !== "false",
  jwtSecret: process.env.EXTERNAL_AUTH_JWT_SECRET,  // Only for shared-secret mode
  verifySession: process.env.EXTERNAL_AUTH_VERIFY_SESSION === "true"
};

// Validate configuration
if (ExternalAuthConfig.enabled) {
  if (!ExternalAuthConfig.apiUrl) {
    throw new Error("EXTERNAL_AUTH_API_URL required when EXTERNAL_AUTH_ENABLED=true");
  }
  
  if (ExternalAuthConfig.mode === "introspect" && !ExternalAuthConfig.serviceKey) {
    throw new Error("EXTERNAL_API_SERVICE_KEY required when EXTERNAL_AUTH_MODE=introspect");
  }
  
  if (ExternalAuthConfig.mode === "shared-secret" && !ExternalAuthConfig.jwtSecret) {
    throw new Error("EXTERNAL_AUTH_JWT_SECRET required when EXTERNAL_AUTH_MODE=shared-secret");
  }
  
  // Enforce HTTPS in production
  if (ExternalAuthConfig.requireHTTPS) {
    try {
      const url = new URL(ExternalAuthConfig.apiUrl);
      if (url.protocol !== "https:") {
        throw new Error("EXTERNAL_AUTH_API_URL must use HTTPS in production");
      }
    } catch (error) {
      // If URL parsing fails, validation will fail when actually used
    }
  }
}

module.exports = { ExternalAuthConfig };



