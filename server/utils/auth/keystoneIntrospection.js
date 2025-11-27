// Simple in-memory cache for introspection results (30 second TTL as per spec)
const introspectionCache = new Map();

// Clean up expired cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of introspectionCache.entries()) {
    if (value.expiresAt < now) {
      introspectionCache.delete(key);
    }
  }
}, 5000); // Clean up every 5 seconds

/**
 * Introspects a Keystone JWT token via Keystone Core API
 * @param {string} token - The Keystone JWT token to introspect
 * @returns {Object|null} - Introspection result if valid, null otherwise
 */
async function introspectKeystoneToken(token) {
  if (!token) return null;

  // Check cache first
  const cacheKey = `keystone_introspect_${token.substring(0, 20)}`;
  const cached = introspectionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Check if external auth is enabled (with trimming and removing inline comments)
  const externalAuthEnabled = String(process.env.EXTERNAL_AUTH_ENABLED || "")
    .split("#")[0] // Remove inline comments
    .trim()
    .toLowerCase();
  if (externalAuthEnabled !== "true") {
    console.error("External auth is not enabled. Raw value:", process.env.EXTERNAL_AUTH_ENABLED, "normalized:", externalAuthEnabled);
    return null;
  }

  // Check if mode is introspection (with trimming and removing inline comments)
  const externalAuthMode = String(process.env.EXTERNAL_AUTH_MODE || "")
    .split("#")[0] // Remove inline comments
    .trim()
    .toLowerCase();
  if (externalAuthMode !== "introspect") {
    console.error("External auth mode is not set to introspect. Raw value:", process.env.EXTERNAL_AUTH_MODE, "normalized:", externalAuthMode);
    return null;
  }

  // Use EXTERNAL_AUTH_API_URL from .env
  const keystoneUrl = process.env.EXTERNAL_AUTH_API_URL;
  if (!keystoneUrl) {
    console.error("Keystone URL not configured. Set EXTERNAL_AUTH_API_URL");
    return null;
  }

  // Remove any inline comments from the URL
  let cleanUrl = keystoneUrl.split("#")[0].trim();

  // If URL already includes a path (has / after domain), use it as-is
  // Otherwise, append the default introspection path
  let introspectionEndpoint;
  try {
    const urlObj = new URL(cleanUrl);
    if (urlObj.pathname && urlObj.pathname !== "/") {
      // URL already has a path, use it as the introspection endpoint
      introspectionEndpoint = cleanUrl;
    } else {
      // No path specified, append default introspection path
      const introspectionPath = process.env.EXTERNAL_AUTH_INTROSPECT_PATH || "/api/v1/auth/introspect";
      cleanUrl = cleanUrl.replace(/\/$/, ""); // Remove trailing slash if present
      introspectionEndpoint = `${cleanUrl}${introspectionPath}`;
    }
  } catch (error) {
    // If URL parsing fails, assume it's a base URL and append path
    const introspectionPath = process.env.EXTERNAL_AUTH_INTROSPECT_PATH || "/api/v1/auth/introspect";
    cleanUrl = cleanUrl.replace(/\/$/, ""); // Remove trailing slash if present
    introspectionEndpoint = `${cleanUrl}${introspectionPath}`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const serviceKey = (process.env.EXTERNAL_API_SERVICE_KEY || "").split("#")[0].trim();
    if (!serviceKey) {
      console.warn(
        "[keystoneIntrospection] EXTERNAL_API_SERVICE_KEY is not set. Keystone may reject introspection requests."
      );
    }

    console.log("[keystoneIntrospection] Calling introspection endpoint:", introspectionEndpoint);
    const response = await fetch(introspectionEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(serviceKey ? { Authorization: `Bearer ${serviceKey}` } : {}),
      },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error("[keystoneIntrospection] Introspection endpoint returned error:", response.status, response.statusText, errorText);
      return null;
    }

    const introspectionResult = await response.json();
    console.log("[keystoneIntrospection] Introspection result:", {
      active: introspectionResult.active,
      sub: introspectionResult.sub,
      exp: introspectionResult.exp,
      iss: introspectionResult.iss,
      aud: introspectionResult.aud,
    });

    // Validate introspection result
    if (!introspectionResult.active) {
      console.error("[keystoneIntrospection] Token is not active");
      return null;
    }

    // Check expiration
    if (introspectionResult.exp && introspectionResult.exp * 1000 < Date.now()) {
      console.error("[keystoneIntrospection] Token has expired");
      return null;
    }

    // Validate issuer if configured
    if (process.env.EXTERNAL_AUTH_ISSUER) {
      const expectedIssuer = process.env.EXTERNAL_AUTH_ISSUER.split("#")[0].trim();
      if (introspectionResult.iss && introspectionResult.iss !== expectedIssuer) {
        console.error("Introspection result issuer mismatch");
        return null;
      }
    }

    // Validate audience if configured
    if (process.env.EXTERNAL_AUTH_AUDIENCE) {
      const expectedAudience = process.env.EXTERNAL_AUTH_AUDIENCE;
      if (introspectionResult.aud && introspectionResult.aud !== expectedAudience) {
        console.error("Introspection result audience mismatch");
        return null;
      }
    }

    // Cache the result with expiration
    introspectionCache.set(cacheKey, {
      data: introspectionResult,
      expiresAt: Date.now() + 30000, // 30 seconds
    });

    return introspectionResult;
  } catch (error) {
    // Introspection failed - fail closed (reject)
    if (error.name !== "AbortError") {
      console.error("Keystone introspection failed:", error.message);
    }
    return null;
  }
}

/**
 * Extracts and introspects Keystone JWT from Authorization header
 * @param {Object} request - Express request object
 * @returns {Object|null} - Introspection result if valid, null otherwise
 */
async function introspectKeystoneTokenFromRequest(request) {
  const auth = request.header("Authorization");
  if (!auth) return null;

  const token = auth.startsWith("Bearer ") ? auth.split(" ")[1] : null;
  if (!token) return null;

  return await introspectKeystoneToken(token);
}

/**
 * Builds a Default User Principal from introspection result
 * @param {Object} introspectionResult - The introspection result from Keystone
 * @returns {Object|null} - User principal object or null
 */
function buildDefaultUserPrincipal(introspectionResult) {
  if (!introspectionResult || !introspectionResult.active) {
    return null;
  }

  return {
    sub: introspectionResult.sub,
    role: introspectionResult.role || "default",
    scope: introspectionResult.scope,
    session_id: introspectionResult.session_id,
    externalId: introspectionResult.sub,
    externalProvider: "keystone",
  };
}

module.exports = {
  introspectKeystoneToken,
  introspectKeystoneTokenFromRequest,
  buildDefaultUserPrincipal,
};

