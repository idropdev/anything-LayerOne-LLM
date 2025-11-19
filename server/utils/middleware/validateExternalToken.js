/**
 * External Token Validation Middleware
 * 
 * RFC 7662: OAuth 2.0 Token Introspection
 * RFC 6750: OAuth 2.0 Bearer Token Usage
 * RFC 7519: JSON Web Token
 * 
 * Validates JWT tokens issued by Keystone Core API via introspection endpoint.
 */

const { ExternalAuthConfig } = require("../auth/config");
const { syncExternalUser, findByExternalId } = require("../auth/syncExternalUser");
const { getCachedIntrospection, setCachedIntrospection, hashToken } = require("../auth/cache");
const { logAuthEvent } = require("../auth/auditAuth");
const { User } = require("../../models/user");

/**
 * Validate external token via introspection or shared secret
 */
async function validateExternalToken(req, res, next) {
  // Feature flag: fall back to internal auth if disabled
  if (!ExternalAuthConfig.enabled) {
    return next();
  }

  // RFC 6750: Extract Bearer token
  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;

  if (!token) {
    logAuthEvent("external_auth_token_validation_failed", {
      reason: "missing_token",
      ipAddress: req.ip || req.connection.remoteAddress
    });
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Optional: Light structural check (no cryptographic validation here)
  const decodedPayload = safeDecodePayload(token);
  if (
    !decodedPayload ||
    (typeof decodedPayload.sub !== "string" && typeof decodedPayload.id !== "string") ||
    typeof decodedPayload.exp !== "number"
  ) {
    logAuthEvent("external_auth_token_validation_failed", {
      reason: "invalid_token_structure",
      ipAddress: req.ip || req.connection.remoteAddress
    });
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Quick local exp check to avoid unnecessary network calls
  const now = Math.floor(Date.now() / 1000);
  const exp = decodedPayload.exp;
  const skew = 60; // 60s skew for clock differences
  if (exp + skew < now) {
    logAuthEvent("external_auth_token_validation_failed", {
      reason: "expired_token",
      ipAddress: req.ip || req.connection.remoteAddress
    });
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  try {
    let introspection;

    if (ExternalAuthConfig.mode === "introspect") {
      // RFC 7662: Token Introspection with caching
      introspection = await validateViaIntrospection(token);
    } else if (ExternalAuthConfig.mode === "shared-secret") {
      // Shared secret mode (backup only - not recommended for production)
      introspection = await validateViaSharedSecret(token);
    } else {
      throw new Error(`Unknown auth mode: ${ExternalAuthConfig.mode}`);
    }

    // RFC 7662: Check active field
    if (!introspection || !introspection.active) {
      logAuthEvent("external_auth_token_validation_failed", {
        reason: "inactive_token",
        ipAddress: req.ip || req.connection.remoteAddress
      });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Defense in depth: Re-check iss/aud from introspection response
    if (
      introspection.iss !== ExternalAuthConfig.issuer ||
      introspection.aud !== ExternalAuthConfig.audience
    ) {
      logAuthEvent("external_auth_token_validation_failed", {
        reason: "invalid_issuer_or_audience",
        ipAddress: req.ip || req.connection.remoteAddress
      });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Extract user info (handle both legacy and new formats)
    const externalUser = {
      id: introspection.sub || introspection.id,  // RFC 7519: sub claim (or legacy id)
      role: introspection.role,
      provider: introspection.provider,
      email: introspection.email ?? null,
      scope: introspection.scope ?? "",
      sid: introspection.sid || introspection.sessionId  // Session ID
    };

    // Sync user to local database
    const existingUser = await findByExternalId(externalUser.id);
    const localUser = await syncExternalUser(externalUser, existingUser);

    // Check if user is suspended
    if (localUser.suspended) {
      logAuthEvent("external_auth_token_validation_failed", {
        reason: "user_suspended",
        userId: localUser.id,
        externalUserId: externalUser.id,
        ipAddress: req.ip || req.connection.remoteAddress
      });
      return res.status(401).json({ error: "User is suspended from system" });
    }

    // Log successful validation
    logAuthEvent("external_auth_token_validated", {
      userId: localUser.id,
      externalUserId: externalUser.id,
      ipAddress: req.ip || req.connection.remoteAddress,
      success: true
    }, localUser.id);

    // Attach to request
    res.locals.user = localUser;
    res.locals.externalUser = externalUser;
    res.locals.scope = externalUser.scope.split(" ").filter(Boolean);  // OAuth2 scopes

    return next();
  } catch (error) {
    // Fail closed: reject request if validation fails
    console.error("External token validation error:", error.message);
    logAuthEvent("external_auth_token_validation_failed", {
      reason: "validation_error",
      error: error.message.substring(0, 100), // Truncate error message
      ipAddress: req.ip || req.connection.remoteAddress
    });
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Validate token via introspection endpoint (RFC 7662)
 */
async function validateViaIntrospection(token) {
  const tokenHash = hashToken(token);
  let introspection = await getCachedIntrospection(tokenHash);

  if (!introspection) {
    try {
      introspection = await callKeystoneIntrospect(token);
      
      // Only cache active tokens
      if (introspection && introspection.active) {
        await setCachedIntrospection(tokenHash, introspection, ExternalAuthConfig.cacheTTL);
      }
    } catch (error) {
      // If introspection fails, check cache for stale result
      const cachedResult = await getCachedIntrospection(tokenHash);
      if (cachedResult && cachedResult.active) {
        introspection = cachedResult;
      } else {
        // Fail closed: reject request if no cache and introspection fails
        throw error;
      }
    }
  }

  return introspection;
}

/**
 * Call Keystone Core API introspection endpoint (RFC 7662)
 */
async function callKeystoneIntrospect(token) {
  const response = await fetch(`${ExternalAuthConfig.apiUrl}/v1/auth/introspect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${ExternalAuthConfig.serviceKey}`
    },
    body: JSON.stringify({
      token: token,
      tokenTypeHint: "access_token",
      includeUser: true
    })
  });

  if (!response.ok) {
    throw new Error(`Introspection failed: ${response.status}`);
  }

  return await response.json();
}

/**
 * Validate token via shared secret (backup mode only)
 */
async function validateViaSharedSecret(token) {
  const JWT = require("jsonwebtoken");
  
  // Validate using shared secret
  let decoded;
  try {
    decoded = JWT.verify(token, ExternalAuthConfig.jwtSecret);
  } catch (error) {
    throw new Error("Invalid token signature");
  }
  
  if (!decoded || (!decoded.sub && !decoded.id)) {
    throw new Error("Invalid token structure");
  }

  // Verify session is still valid via Keystone Core API (for revocation support)
  if (ExternalAuthConfig.verifySession) {
    const sessionId = decoded.sid || decoded.sessionId;
    const sessionValid = await verifySession(sessionId);
    if (!sessionValid) {
      throw new Error("Session revoked");
    }
  }

  // Convert decoded token to introspection-like format
  return {
    active: true,
    sub: decoded.sub || decoded.id,
    id: decoded.id || decoded.sub,
    role: decoded.role,
    provider: decoded.provider,
    email: decoded.email ?? null,
    scope: decoded.scope ?? "",
    sid: decoded.sid || decoded.sessionId,
    iss: decoded.iss || ExternalAuthConfig.issuer,
    aud: decoded.aud || ExternalAuthConfig.audience
  };
}

/**
 * Verify session is still active (for shared-secret mode)
 */
async function verifySession(sessionId) {
  // Call Keystone Core API to verify session is still active
  // This is a lightweight check, not full introspection
  try {
    const response = await fetch(
      `${ExternalAuthConfig.apiUrl}/v1/auth/session/${sessionId}/verify`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${ExternalAuthConfig.serviceKey}`
        }
      }
    );
    return response.ok;
  } catch (error) {
    return false; // Fail closed
  }
}

/**
 * Safe base64url decode of JWT payload (no signature verification)
 */
function safeDecodePayload(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    
    const payload = parts[1];
    const decoded = Buffer.from(payload, "base64url").toString("utf-8");
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

module.exports = { validateExternalToken };

