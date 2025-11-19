/**
 * Token Introspection Cache
 * 
 * Implements caching for token introspection results to reduce API calls
 * to Keystone Core API. Uses the cache_data table for persistence.
 */

const { CacheData } = require("../../models/cacheData");

const CACHE_PREFIX = "introspect:";

/**
 * Get cached introspection result
 * @param {string} token - The JWT token (or hash of token)
 * @returns {Promise<Object|null>} Cached introspection result or null
 */
async function getCachedIntrospection(token) {
  try {
    const cacheKey = `${CACHE_PREFIX}${token}`;
    const cacheEntry = await CacheData.get({
      name: cacheKey,
      expiresAt: {
        gt: new Date()
      }
    });

    if (!cacheEntry) {
      return null;
    }

    return JSON.parse(cacheEntry.data);
  } catch (error) {
    // Fail silently - cache miss is not an error
    return null;
  }
}

/**
 * Set cached introspection result
 * @param {string} token - The JWT token (or hash of token)
 * @param {Object} introspection - The introspection result
 * @param {number} ttlSeconds - Time to live in seconds
 * @returns {Promise<void>}
 */
async function setCachedIntrospection(token, introspection, ttlSeconds) {
  try {
    const cacheKey = `${CACHE_PREFIX}${token}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // Delete existing cache entry if any
    await CacheData.delete({ name: cacheKey });

    // Create new cache entry
    await CacheData.new({
      name: cacheKey,
      data: JSON.stringify(introspection),
      belongsTo: "external_auth",
      expiresAt: expiresAt
    });
  } catch (error) {
    // Fail silently - cache write failure is not critical
    console.error("Failed to cache introspection result:", error.message);
  }
}

/**
 * Create a hash of the token for use as cache key
 * This avoids storing full tokens in the database
 * @param {string} token - The JWT token
 * @returns {string} Hash of the token
 */
function hashToken(token) {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  getCachedIntrospection,
  setCachedIntrospection,
  hashToken
};



