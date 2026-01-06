# AnythingLLM Delegated Token Authentication & Authorization Guide

**Project:** Keystone Core API → AnythingLLM Integration  
**Date:** 2025-01-03  
**Focus:** Service-to-Service Authentication with User Context Delegation

---

## Executive Summary

Keystone Core API issues **delegated tokens** for AnythingLLM requests. These tokens use **service-to-service (S2S) authentication** as the medium, but embed user context (user/manager/admin roles) in the token payload.

**Key Principle:**
- **Authentication Medium:** Service-to-Service (Keystone → AnythingLLM)
- **Token Issuer:** `svc-keystone` (Keystone service identity)
- **User Context:** Embedded in `act` claim (RFC 8693)
- **Authorization:** AnythingLLM enforces role-based restrictions based on `act.roles`

**Why This Approach:**
- ✅ S2S tokens are trusted (come from Keystone)
- ✅ User context preserved (roles, userId, sessionId)
- ✅ AnythingLLM can enforce fine-grained authorization
- ✅ HIPAA compliant (no PHI in tokens)

---

## 1. Token Structure

### 1.1 Delegated Token Payload

When Keystone issues a delegated token, it has the following structure:

```json
{
  "sub": "svc-keystone",           // Service identity (who issued the token)
  "act": {                          // Actor claim (RFC 8693) - who is making the request
    "sub": "user-123",              // Original user ID
    "roles": ["admin"],             // User roles: ["admin"] | ["manager"] | ["user"]
    "sessionId": "session-456",    // Session ID for audit
    "provider": "google"            // Auth provider (optional)
  },
  "scope": ["anythingllm:system:read", "anythingllm:system:write"],  // OAuth2 scopes
  "aud": "anythingllm",             // Audience (must match AnythingLLM config)
  "iss": "https://keystone.example.com",  // Issuer (optional)
  "iat": 1738000000,                // Issued at (Unix timestamp)
  "exp": 1738000300,                // Expiration (Unix timestamp)
  "nbf": 1737999940                 // Not before (Unix timestamp)
}
```

### 1.2 Token Header

```json
{
  "alg": "HS256",                   // Algorithm (HMAC SHA-256)
  "typ": "JWT"                      // Token type
}
```

### 1.3 Key Claims Explained

| Claim | Value | Purpose |
|-------|-------|---------|
| `sub` | `"svc-keystone"` | **Service identity** - indicates token is from Keystone (S2S medium) |
| `act.sub` | `"user-123"` | **User ID** - the actual user making the request |
| `act.roles` | `["admin"]` | **User roles** - used for authorization decisions |
| `act.sessionId` | `"session-456"` | **Session ID** - for audit logging and revocation |
| `scope` | `["anythingllm:..."]` | **OAuth2 scopes** - permissions granted |
| `aud` | `"anythingllm"` | **Audience** - must match AnythingLLM configuration |
| `iss` | `"https://..."` | **Issuer** - Keystone's issuer URL (optional) |

---

## 2. Authentication Flow

### 2.1 Request Flow

```
1. User authenticates with Keystone → Gets user JWT
2. User requests AnythingLLM operation → Sends user JWT to Keystone
3. Keystone validates user JWT → Extracts user context (userId, roles)
4. Keystone issues delegated token → Embeds user context in `act` claim
5. Keystone forwards request to AnythingLLM → Uses delegated token
6. AnythingLLM validates delegated token → Extracts user context from `act` claim
7. AnythingLLM enforces role-based authorization → Checks `act.roles`
```

### 2.2 Token Validation Steps

AnythingLLM validates the delegated token in this order:

#### Step 1: Verify Token Signature
```javascript
// Verify token is signed by Keystone using shared secret
const decoded = jwt.verify(token, KEYSTONE_DELEGATED_TOKEN_SECRET, {
  algorithms: ['HS256'],
  audience: 'anythingllm',
  issuer: 'https://keystone.example.com' // if configured
});
```

#### Step 2: Verify Service Identity
```javascript
// Token must be issued by Keystone service
if (decoded.sub !== 'svc-keystone') {
  throw new Error('Invalid token: not from Keystone service');
}
```

#### Step 3: Verify Actor Claim
```javascript
// Actor claim must be present
if (!decoded.act || !decoded.act.sub) {
  throw new Error('Invalid token: missing actor claim');
}

const userId = decoded.act.sub;
const roles = decoded.act.roles || [];
const sessionId = decoded.act.sessionId;
```

#### Step 4: Check Token Expiration
```javascript
const now = Math.floor(Date.now() / 1000);
if (decoded.exp < now) {
  throw new Error('Token expired');
}
```

---

## 3. Authorization (Role-Based Access Control)

### 3.1 Role Hierarchy

| Role | ID | Permissions |
|------|-----|-------------|
| **admin** | Highest | Full access to all operations |
| **manager** | Medium | Most operations, limited admin functions |
| **user** | Lowest | Basic operations, own resources only |

### 3.2 Authorization Decision Logic

**Critical Rule:** Even though the token comes from Keystone (S2S trusted), AnythingLLM **MUST** enforce role-based restrictions based on `act.roles`.

```javascript
function authorizeOperation(operation, token) {
  const decoded = jwt.verify(token, KEYSTONE_DELEGATED_TOKEN_SECRET, {
    algorithms: ['HS256'],
    audience: 'anythingllm'
  });

  // Extract user context from act claim
  const userId = decoded.act.sub;
  const roles = decoded.act.roles || [];
  const isAdmin = roles.includes('admin');
  const isManager = roles.includes('manager');
  const isUser = roles.includes('user');

  // Enforce role-based restrictions
  switch (operation) {
    case 'SYSTEM_READ':
      // All authenticated users can read system info
      return { allowed: true, userId, roles };

    case 'ADMIN_WORKSPACE_CREATE':
      // Only admins and managers
      if (isAdmin || isManager) {
        return { allowed: true, userId, roles };
      }
      return { allowed: false, reason: 'Insufficient role' };

    case 'ADMIN_USER_DELETE':
      // Only admins
      if (isAdmin) {
        return { allowed: true, userId, roles };
      }
      return { allowed: false, reason: 'Admin role required' };

    case 'WORKSPACE_READ':
      // All authenticated users
      return { allowed: true, userId, roles };

    case 'WORKSPACE_DELETE':
      // Admins can delete any, users can delete own
      if (isAdmin) {
        return { allowed: true, userId, roles };
      }
      // Check if user owns the workspace
      // ... ownership check logic ...
      return { allowed: false, reason: 'Not authorized' };

    default:
      return { allowed: false, reason: 'Unknown operation' };
  }
}
```

### 3.3 Role-Based Operation Matrix

| Operation | Admin | Manager | User | Notes |
|-----------|-------|---------|------|-------|
| `SYSTEM_READ` | ✅ | ✅ | ✅ | System info visible to all |
| `SYSTEM_AUTH_CHECK` | ✅ | ✅ | ✅ | Auth check available to all |
| `ADMIN_USER_CREATE` | ✅ | ✅ | ❌ | User creation (admin/manager only) |
| `ADMIN_USER_DELETE` | ✅ | ❌ | ❌ | User deletion (admin only) |
| `ADMIN_WORKSPACE_CREATE` | ✅ | ✅ | ❌ | Workspace creation (admin/manager) |
| `WORKSPACE_READ` | ✅ | ✅ | ✅ | Read own workspaces |
| `WORKSPACE_DELETE` | ✅ | ✅ | ✅* | Delete own workspaces (*admin can delete any) |
| `DOCUMENT_UPLOAD` | ✅ | ✅ | ✅ | Upload to own workspaces |
| `DOCUMENT_DELETE` | ✅ | ✅ | ✅* | Delete own documents (*admin can delete any) |
| `THREAD_CREATE` | ✅ | ✅ | ✅ | Create threads in own workspaces |
| `CHAT_SEND` | ✅ | ✅ | ✅ | Send messages in own threads |

---

## 4. Implementation Guide for AnythingLLM

### 4.1 Middleware: Validate Delegated Token

The middleware is located at: `server/utils/middleware/validateDelegatedToken.js`

**Usage:**
```javascript
const { validateDelegatedToken } = require('../../utils/middleware/validateDelegatedToken');

// Apply to routes
router.use(validateDelegatedToken);
// or
router.get('/endpoint', [validateDelegatedToken], handler);
```

**What it does:**
1. Extracts Bearer token from `Authorization` header
2. Verifies token signature using `KEYSTONE_DELEGATED_TOKEN_SECRET`
3. Validates service identity (`sub === 'svc-keystone'`)
4. Extracts user context from `act` claim
5. Attaches user context to `req.user` and `response.locals.user`
6. Logs authentication events for audit

**Request object after middleware:**
```javascript
req.user = {
  id: 'user-123',              // From act.sub
  roles: ['admin'],            // From act.roles
  sessionId: 'session-456',    // From act.sessionId
  provider: 'google',          // From act.provider
  scope: [...],                // From scope claim
  issuedAt: 1738000000,        // From iat
  expiresAt: 1738000300        // From exp
};
```

### 4.2 Authorization Helper: Check Roles

The authorization helpers are located at: `server/utils/authorization.js`

**Available functions:**
- `hasRole(user, role)` - Check if user has a specific role
- `isAdmin(user)` - Check if user is admin
- `isManager(user)` - Check if user is manager
- `isUser(user)` - Check if user is standard user
- `requireRole(user, role)` - Throw error if user doesn't have role
- `requireAdmin(user)` - Throw error if user is not admin
- `requireManagerOrAdmin(user)` - Throw error if user is not manager or admin
- `requireUser(user)` - Throw error if user has no roles

**Usage:**
```javascript
const { requireAdmin, requireManagerOrAdmin, hasRole } = require('../../utils/authorization');

// In route handler
router.get('/admin/users', [validateDelegatedToken], (req, res, next) => {
  try {
    requireAdmin(req.user);
    // ... admin-only logic ...
  } catch (error) {
    return res.status(403).json({ error: error.message });
  }
});
```

### 4.3 Example: Protected Endpoint

```javascript
// routes/system.js
const express = require('express');
const router = express.Router();
const { validateDelegatedToken } = require('../middleware/validateDelegatedToken');
const { requireAdmin, requireManagerOrAdmin } = require('../utils/authorization');

// All routes require delegated token
router.use(validateDelegatedToken);

// GET /v1/system - All authenticated users
router.get('/system', (req, res) => {
  res.json({
    version: '1.0.0',
    user: {
      id: req.user.id,
      roles: req.user.roles
    }
  });
});

// DELETE /v1/admin/users/:id - Admin only
router.delete('/admin/users/:id', (req, res, next) => {
  try {
    requireAdmin(req.user);
    // ... delete user logic ...
    res.json({ success: true });
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});

// POST /v1/admin/workspaces - Manager or Admin
router.post('/admin/workspaces', (req, res, next) => {
  try {
    requireManagerOrAdmin(req.user);
    // ... create workspace logic ...
    res.json({ success: true });
  } catch (error) {
    res.status(403).json({ error: error.message });
  }
});
```

---

## 5. Configuration

### 5.1 Environment Variables

Add to AnythingLLM `.env`:

```bash
# Keystone Delegated Token Configuration
KEYSTONE_DELEGATED_TOKEN_SECRET=<shared-secret-with-keystone>
KEYSTONE_ISSUER=https://keystone.example.com  # Optional
KEYSTONE_AUDIENCE=anythingllm
CORRELATION_ID_HEADER_NAME=x-correlation-id  # Optional, defaults to x-correlation-id
```

### 5.2 Secret Management

**Important:** The `KEYSTONE_DELEGATED_TOKEN_SECRET` must match the secret configured in Keystone.

**Security Best Practices:**
- ✅ Store secret in environment variables (never in code)
- ✅ Use GCP Secret Manager or similar for production
- ✅ Rotate secrets periodically
- ✅ Use different secrets per environment (dev/staging/prod)
- ✅ TODO: Move to GCP Secret Manager in production

---

## 6. Error Handling

### 6.1 Authentication Errors

| Error | Status | Response |
|-------|--------|----------|
| Missing token | 401 | `{ "error": "Missing or invalid authorization header" }` |
| Invalid signature | 401 | `{ "error": "Invalid token" }` |
| Token expired | 401 | `{ "error": "Token expired" }` |
| Missing act claim | 401 | `{ "error": "Invalid token: missing actor claim" }` |
| Wrong service identity | 401 | `{ "error": "Invalid token: not from Keystone service" }` |

### 6.2 Authorization Errors

| Error | Status | Response |
|-------|--------|----------|
| Insufficient role | 403 | `{ "error": "Role 'admin' required" }` |
| Operation not allowed | 403 | `{ "error": "Operation not allowed for your role" }` |

---

## 7. Audit Logging

### 7.1 What to Log

For each request, the middleware logs:

```javascript
{
  timestamp: ISO8601,
  event: 'delegated_token_auth_success' | 'delegated_token_auth_failed',
  userId: req.user.id,              // From act.sub
  roles: req.user.roles,            // From act.roles
  sessionId: req.user.sessionId,    // From act.sessionId
  endpoint: req.path,
  method: req.method,
  correlationId: '...',
  authProvider: 'keystone-delegated-token'
}
```

### 7.2 What NOT to Log

- ❌ Raw tokens (JWT strings)
- ❌ Token payloads (except user context)
- ❌ PHI (emails, names, health data)
- ❌ Request/response bodies (may contain sensitive data)

**Note:** Logs are stored via `EventLogs.logEvent()`. TODO: Forward to GCP Cloud Logging with retention for HIPAA audits.

---

## 8. Testing

### 8.1 Test Token Structure

You can decode a token to verify structure:

```javascript
const jwt = require('jsonwebtoken');

// Decode without verification (for testing)
const decoded = jwt.decode(token, { complete: true });

console.log('Header:', decoded.header);
console.log('Payload:', JSON.stringify(decoded.payload, null, 2));
```

### 8.2 Test Cases

1. **Valid token with admin role** → Should allow admin operations
2. **Valid token with user role** → Should allow user operations, deny admin
3. **Expired token** → Should return 401
4. **Invalid signature** → Should return 401
5. **Missing act claim** → Should return 401
6. **Wrong service identity** → Should return 401

---

## 9. Summary

### Key Points

1. **S2S is the Medium:** Tokens are issued by `svc-keystone` (service identity)
2. **User Context in `act` Claim:** Extract `userId` and `roles` from `decoded.act`
3. **Enforce Role-Based Authorization:** Check `act.roles` for all operations
4. **Trust but Verify:** Token is trusted (from Keystone), but roles must be checked

### Authentication Flow

```
Token from Keystone (S2S) → Verify Signature → Extract act.roles → Enforce Authorization
```

### Authorization Flow

```
Request → Extract roles from act.roles → Check role permissions → Allow/Deny
```

---

## 10. Integration with Existing Auth

### 10.1 Relationship to Other Auth Methods

This delegated token authentication is **separate** from:
- `validateKeystoneServiceCaller` - Used for `/v1/admin/*` endpoints (sets `systemActor=true`, bypasses role checks)
- `validateExternalUserToken` - Used for user-facing endpoints (introspects user tokens)
- `validatedRequest` - Used for internal/external user authentication

**Key Difference:**
- `validateDelegatedToken` - S2S auth with user context, enforces role-based authorization
- `validateKeystoneServiceCaller` - S2S auth without user context, bypasses role checks (system actor)

### 10.2 When to Use Which

| Use Case | Middleware | Notes |
|----------|------------|-------|
| User operations with role restrictions | `validateDelegatedToken` | User context in `act` claim, enforce roles |
| Admin-only service operations | `validateKeystoneServiceCaller` | System actor, no role checks |
| User-facing endpoints | `validateExternalUserToken` | Introspect user tokens from Keystone |

---

## 11. Support

For questions or issues:
- Review Keystone Core API documentation
- Check token structure using JWT decode tools
- Verify `KEYSTONE_DELEGATED_TOKEN_SECRET` matches Keystone configuration
- Ensure `aud` claim matches `KEYSTONE_AUDIENCE`
- Check audit logs via `EventLogs` model

---

**Last Updated:** 2025-01-03  
**Version:** 1.0




