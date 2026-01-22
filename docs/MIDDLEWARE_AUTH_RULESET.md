# Middleware Authentication Ruleset

This document defines the authentication middleware standards for AnythingLLM API endpoints.

---

## Middleware Overview

| Middleware | Purpose | Use Case |
|------------|---------|----------|
| `validateKeystoneServiceCaller` | S2S + Delegated Token Auth | Admin routes, workspace provisioning |
| `validatedRequest` | User token validation | User-facing endpoints (documents, etc.) |
| `requireServiceOrAdmin` | Wrapper for S2S auth | Workspace provisioning (calls `validateKeystoneServiceCaller`) |

---

## `validateKeystoneServiceCaller`

### Purpose
Validates service-to-service (S2S) requests from Keystone Core API using delegated JWT tokens with user context.

### Authentication Modes
| Mode | Env Var Value | Description |
|------|---------------|-------------|
| `keystone_delegated_jwt` | `ANYTHINGLLM_SERVICE_AUTH_MODE=keystone_delegated_jwt` | Delegated JWT with `act` claim containing user context |
| `local_jwt` | `ANYTHINGLLM_SERVICE_AUTH_MODE=local_jwt` | RS256 signed JWT |
| `gcp` | `ANYTHINGLLM_SERVICE_AUTH_MODE=gcp` | GCP OIDC ID tokens (default) |

### Required Environment Variables

```bash
# Auth mode selection
ANYTHINGLLM_SERVICE_AUTH_MODE=keystone_delegated_jwt

# Service audience (used for issuer AND audience validation)
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal

# Shared secret for HS256 JWT verification
KEYSTONE_DELEGATED_JWT_SECRET=<shared-secret-with-keystone>
```

### Dependencies
- `jsonwebtoken` - JWT verification
- `../auth/delegatedTokenValidator` - Shared delegated token verification
- `../auth/syncExternalUser` - System actor synchronization

### What It Authenticates
1. **S2S Identity**: Verifies the token is from Keystone service
2. **User Context**: Extracts `act` claim with:
   - `act.sub` - Requester ID
   - `act.roles` - Requester roles (admin, manager, default)
   - `act.sessionId` - Session ID (optional)
   - `act.provider` - Provider (optional)

### Response Locals Set
```javascript
response.locals.user = systemActorUser;        // System actor user record
response.locals.systemActor = true;            // Flag for system actor mode
response.locals.scope = [];                    // Token scope array
response.locals.delegatedActor = { ... };      // User context from act claim
```

### Endpoints Using This Middleware
- `/v1/admin/*` - All admin routes
- `/v1/workspace/new` - Workspace provisioning

---

## `validatedRequest`

### Purpose
Validates user tokens for user-facing API endpoints.

### Authentication Flow
1. Check if external auth is enabled
2. If internal admin JWT → allow access
3. Otherwise → delegate to `validateExternalUserToken`

### Required Environment Variables
```bash
# External auth must be configured in ExternalAuthConfig
```

### Dependencies
- `validateExternalUserToken` - External user token validation
- `EncryptionManager` - Token decryption
- `../http` - JWT decoding utilities

### What It Authenticates
- Internal admin JWTs
- External user tokens (via introspection or delegated validation)

### Response Locals Set
```javascript
response.locals.user = user;                   // Authenticated user record
response.locals.multiUserMode = boolean;       // Multi-user mode flag
```

### Endpoints Using This Middleware
- `/v1/document/upload` - Document upload
- `/v1/document/upload/:folderName` - Document upload to folder
- `/v1/documents` - List documents
- `/v1/document/:docName` - Get document

---

## `requireServiceOrAdmin`

### Purpose
Wrapper middleware for workspace provisioning routes. Currently delegates to `validateKeystoneServiceCaller`.

### Implementation
```javascript
async function requireServiceOrAdmin(request, response, next) {
  return validateKeystoneServiceCaller(request, response, next);
}
```

### Future Considerations
May be extended to allow internal admin fallback for workspace provisioning.

---

## When to Use Each Middleware

| Endpoint Type | Middleware | Reason |
|---------------|------------|--------|
| Admin operations (user CRUD, invites) | `validateKeystoneServiceCaller` | Pure S2S, system actor |
| Workspace provisioning | `requireServiceOrAdmin` | S2S with potential admin fallback |
| Document operations | `validatedRequest` | User context required |
| Chat endpoints | `validatedRequest` | User context required |
| System status | `validateKeystoneServiceCaller` | S2S only |

---

## Adding New Endpoints

### For S2S-Only Endpoints (Admin, System)
```javascript
const { validateKeystoneServiceCaller } = require("../../../utils/middleware/validateKeystoneServiceCaller");

app.post("/v1/admin/new-endpoint", [validateKeystoneServiceCaller], async (req, res) => {
  // response.locals.systemActor === true
  // response.locals.delegatedActor contains user context
});
```

### For User-Facing Endpoints
```javascript
const { validatedRequest } = require("../../../utils/middleware/validatedRequest");

app.post("/v1/some-user-endpoint", [validatedRequest], async (req, res) => {
  // response.locals.user contains authenticated user
});
```

---

## Token Structure (Delegated JWT)

```json
{
  "sub": "svc-keystone",
  "iss": "anythingllm-internal",
  "aud": "anythingllm-internal",
  "act": {
    "sub": "user-123",
    "roles": ["admin"],
    "sessionId": "session-abc",
    "provider": "keystone"
  },
  "scope": "read write",
  "exp": 1738000300,
  "iat": 1738000000
}
```

---

## Critical Rules

> [!IMPORTANT]
> **Admin routes require admin role**: When accessing `/v1/admin/*` endpoints, the delegated token's `act.roles` must include `"admin"`.

> [!NOTE]
> **S2S + Role Check**: Authentication is via S2S (delegated JWT), but authorization checks the delegated user's role - same as basic AnythingLLM role access.

> [!WARNING]
> Do not mix `validateKeystoneServiceCaller` and `validatedRequest` on the same endpoint. Choose one based on the endpoint's purpose.

> [!CAUTION]
> Always use `ANYTHINGLLM_SERVICE_AUDIENCE` for both issuer and audience when in `keystone_delegated_jwt` mode.

---

## Role Requirements by Endpoint

| Route Pattern | Required Role | Description |
|--------------|---------------|-------------|
| `/v1/admin/*` | `admin` | User CRUD, invites, preferences |
| `/v1/workspace/new` | Any role | Workspace provisioning |
| `/v1/document/upload` | Any role | Document upload |
