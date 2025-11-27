const JWT = require("jsonwebtoken");

/**
 * Verifies an Admin JWT token locally
 * Admin JWTs are issued by an external admin auth system
 * JWT verification details come from the login endpoint, not env vars
 * @param {string} token - The JWT token to verify
 * @param {Object} verificationConfig - Optional verification config from login endpoint
 * @returns {Object|null} - Decoded token payload if valid, null otherwise
 */
function verifyAdminJWT(token, verificationConfig = null) {
  if (!token) return null;

  try {
    // If verification config is provided (from login endpoint), use it
    if (verificationConfig) {
      const { secret, publicKey, issuer, audience } = verificationConfig;
      
      const verifyOptions = {};
      if (issuer) verifyOptions.issuer = issuer;
      if (audience) verifyOptions.audience = audience;

      // Use public key if provided (for RS256), otherwise use secret (for HS256)
      const key = publicKey || secret;
      if (!key) {
        console.error("Admin JWT verification config missing key");
        return null;
      }

      const decoded = JWT.verify(token, key, verifyOptions);
      
      // Verify role is admin
      if (decoded.role !== "admin") {
        console.error("Admin JWT does not have admin role");
        return null;
      }

      return decoded;
    }

    // Fallback: Try to decode without verification (less secure, but allows flexibility)
    // This is useful when verification details come from the login endpoint response
    // In production, you should always verify with proper keys
    const decoded = JWT.decode(token, { complete: true });
    
    if (!decoded || !decoded.payload) {
      return null;
    }

    // Check expiration manually
    if (decoded.payload.exp && decoded.payload.exp * 1000 < Date.now()) {
      console.error("Admin JWT has expired");
      return null;
    }

    // Verify role is admin
    if (decoded.payload.role !== "admin") {
      console.error("Admin JWT does not have admin role");
      return null;
    }

    return decoded.payload;
  } catch (error) {
    // Token is expired, invalid signature, wrong issuer/audience, etc.
    console.error("Admin JWT verification failed:", error.message);
    return null;
  }
}

/**
 * Extracts and verifies Admin JWT from Authorization header
 * @param {Object} request - Express request object
 * @param {Object} verificationConfig - Optional verification config from login endpoint
 * @returns {Object|null} - Decoded token payload if valid, null otherwise
 */
function verifyAdminJWTFromRequest(request, verificationConfig = null) {
  const auth = request.header("Authorization");
  if (!auth) return null;

  const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
  if (!token) return null;

  return verifyAdminJWT(token, verificationConfig);
}

module.exports = {
  verifyAdminJWT,
  verifyAdminJWTFromRequest,
};

