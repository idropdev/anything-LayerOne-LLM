# Service-to-Service Authentication Implementation

## Overview

This document describes the service-to-service authentication implementation between Keystone Core API and AnythingLLM, enabling secure communication using:
- **GCP OIDC ID tokens** (production)
- **RS256 JWTs** (local development)
- **Delegated JWTs** (production with requester context embedding)

## Architecture

- **Keystone Core API**: Front-facing public API that authenticates end users and manages service requests
- **AnythingLLM**: Internal RAG layer running on a GCE VM behind a Google Cloud HTTPS Load Balancer
- **Authentication Method**: GCP OIDC ID tokens (production) or RS256 JWTs (local development)
- **Security Model**: Fail-closed policy with cryptographic token verification

## Implementation Details

### AnythingLLM Side

#### Middleware

**File:** `server/utils/middleware/validateKeystoneServiceCaller.js`

- Verifies GCP OIDC ID tokens using `google-auth-library` (GCP mode)
- Supports local RS256 JWT verification for development (local_jwt mode)
- Supports delegated JWTs with requester context in `act` claim (keystone_delegated_jwt mode)
- Maps verified service identity to system actor user
- Enforces audience and service account email validation (GCP mode)
- Enforces issuer, audience, and act claim validation (delegated mode)
- Captures correlation IDs for audit trail continuity

**Key Features:**
- Lazy-loads `google-auth-library` (only in GCP mode) to prevent local dev failures
- Creates/updates system actor user (`externalProvider="keystone"`, `externalId="keystone-service"`)
- Audit logging via EventLogs (no PHI, includes correlation ID and delegatedActor context)
- Fail-closed on all verification errors
- Supports HS256 or RS256 for delegated JWTs
- Optional scope enforcement middleware for defense-in-depth

#### Service Actor Sync

**File:** `server/utils/auth/syncExternalUser.js`

Function: `syncKeystoneServiceActor()`
- Creates or updates local user record for Keystone service identity
- Sets role to "admin"
- Maps `externalProvider="keystone"`, `externalId="keystone-service"`

#### Protected Endpoints

All `/v1/admin/*` routes require exclusive service identity authentication (no end-user auth fallback):

- User Management: `GET /v1/admin/users`, `POST /v1/admin/users/new`, `POST /v1/admin/users/:id`
- Invite Management: `GET /v1/admin/invites`, `POST /v1/admin/invite/new`, `DELETE /v1/admin/invite/:id`
- Workspace Management: `GET /v1/admin/workspaces/:workspaceId/users`, `POST /v1/admin/workspaces/:workspaceId/update-users`, `POST /v1/admin/workspaces/:workspaceSlug/manage-users`
- Chat Management: `POST /v1/admin/workspace-chats`
- System Preferences: `POST /v1/admin/preferences`
- System Status: `GET /v1/admin/is-multi-user-mode`

Workspace provisioning route:
- `POST /v1/workspace/new` - Uses `requireServiceOrAdmin` middleware (currently service-identity-only)

### Keystone Side

See [KEYSTONE_IMPLEMENTATION_GUIDE.md](./KEYSTONE_IMPLEMENTATION_GUIDE.md) for Keystone-specific implementation details.

## Environment Variables

### AnythingLLM

**GCP Mode (Production):**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=keystone-svc@<PROJECT_ID>.iam.gserviceaccount.com
```

**Local JWT Mode (Development):**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=local_jwt
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
KEYSTONE_SERVICE_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

**Delegated JWT Mode (Production with Requester Context):**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=keystone_delegated_jwt
KEYSTONE_DELEGATED_JWT_ALG=HS256
KEYSTONE_DELEGATED_JWT_SECRET=your-shared-secret
KEYSTONE_DELEGATED_JWT_ISSUER=svc-keystone
KEYSTONE_DELEGATED_JWT_AUDIENCE=anythingllm
CORRELATION_ID_HEADER_NAME=x-correlation-id
ENABLE_DELEGATED_SCOPE_ENFORCEMENT=false
```

For RS256 delegated JWTs:
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=keystone_delegated_jwt
KEYSTONE_DELEGATED_JWT_ALG=RS256
KEYSTONE_DELEGATED_JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
KEYSTONE_DELEGATED_JWT_ISSUER=svc-keystone
KEYSTONE_DELEGATED_JWT_AUDIENCE=anythingllm
```

**Critical Invariants:**
- `ANYTHINGLLM_SERVICE_AUDIENCE` (GCP/local_jwt) or `KEYSTONE_DELEGATED_JWT_AUDIENCE` (delegated) must be identical across Keystone and AnythingLLM
- Service audience must never be reused for end-user tokens
- Delegated JWTs MUST include `act` claim with `sub` and `roles` array
- Keystone is the authorization authority; AnythingLLM does NOT enforce roles from `delegatedActor.roles`

### Keystone

See [KEYSTONE_IMPLEMENTATION_GUIDE.md](./KEYSTONE_IMPLEMENTATION_GUIDE.md) for Keystone environment variables.

## GCP Setup

### Service Account Configuration

1. **Create Service Account for Keystone**
   - Name: `keystone-svc` (or as appropriate)
   - Ensure it has necessary IAM roles to run Keystone

2. **Configure Keystone to Run with Service Account**
   - GCE: Set `serviceAccountEmail` in instance metadata
   - Cloud Run: Set `serviceAccountName` in service configuration
   - GKE: Set `serviceAccountName` in pod spec

3. **Configure AnythingLLM Environment Variables**
   - Set `ANYTHINGLLM_SERVICE_AUDIENCE` to match Keystone's audience
   - Set `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL` to Keystone's service account email

4. **Ensure HTTPS Load Balancer Forwards Authorization Headers**
   - Do not strip `Authorization` header
   - Do not rely on client IP for authentication

## Security Considerations

1. **Fail-Closed Policy**: All authentication errors result in 401/403 responses
2. **No End-User Auth Fallback**: Admin routes explicitly reject end-user tokens
3. **Audit Logging**: All authentication events are logged (no PHI, includes correlation ID and delegatedActor context)
4. **Token Verification**: Cryptographic verification via:
   - `google-auth-library` (GCP mode)
   - RS256 JWT verification (local_jwt mode)
   - HS256 or RS256 JWT verification (delegated mode)
5. **System Actor Isolation**: Service actor users have `systemActor=true` flag and bypass normal role checks
6. **Authority Boundary**: Keystone is the authorization authority; AnythingLLM authenticates and audits but does NOT authorize based on `delegatedActor.roles`
7. **Correlation ID Propagation**: Correlation IDs from headers are captured and included in audit logs for request tracing
8. **Optional Scope Enforcement**: Defense-in-depth scope-to-endpoint enforcement available when `ENABLE_DELEGATED_SCOPE_ENFORCEMENT=true` (not primary authorization)

## Error Responses

### 401 Unauthorized
- Missing `Authorization` header
- Invalid or expired token
- Token verification failure
- Audience/email mismatch

### 403 Forbidden
- Service actor account suspended

### 500 Internal Server Error
- Service actor user sync failure
- Database errors

## Dependencies

- `google-auth-library`: ^10.5.0 (for GCP ID token verification)
- `jsonwebtoken`: ^9.0.0 (for local JWT verification)

## Testing

Test endpoint (simplest):
```bash
GET /v1/admin/is-multi-user-mode
```

This endpoint requires no request body and returns a simple JSON response, making it ideal for testing authentication.

## Files Modified/Created

### New Files
- `server/utils/middleware/validateKeystoneServiceCaller.js` - Main authentication middleware
- `server/utils/middleware/enforceDelegatedScopes.js` - Optional scope enforcement middleware for delegated mode
- `server/utils/middleware/requireServiceOrAdmin.js` - Composed middleware for workspace routes
- `server/__tests__/middleware/validateKeystoneServiceCaller.delegated.test.js` - Delegated JWT test suite
- `docs/SERVICE_TO_SERVICE_AUTHENTICATION.md` - This document
- `docs/KEYSTONE_IMPLEMENTATION_GUIDE.md` - Keystone implementation guide

### Modified Files
- `server/utils/middleware/validateKeystoneServiceCaller.js` - Added delegated JWT mode support, correlation ID extraction
- `server/utils/auth/config.js` - Added `DelegatedJWTConfig` object
- `server/utils/auth/syncExternalUser.js` - Added `syncKeystoneServiceActor()` function
- `server/endpoints/api/admin/index.js` - Updated all routes to use `validateKeystoneServiceCaller`
- `server/endpoints/api/workspace/index.js` - Updated `POST /v1/workspace/new` to use `requireServiceOrAdmin`
- `server/__tests__/middleware/auth.test.js` - Added regression tests for gcp/local_jwt modes
- `server/package.json` - Added `google-auth-library` dependency

## Delegated JWT Mode Details

### Token Structure

Delegated JWTs must include the following claims:

```json
{
  "sub": "svc-keystone",
  "iss": "svc-keystone",
  "aud": "anythingllm",
  "exp": 1234567890,
  "iat": 1234567890,
  "nbf": 1234567890,  // Optional
  "scope": "anythingllm:admin:read anythingllm:admin:write",  // String or array
  "act": {
    "sub": "user-123",
    "roles": ["admin", "manager"],
    "sessionId": "session-abc",  // Optional
    "provider": "google"  // Optional
  }
}
```

### Security Invariants

1. **Authority Boundary**: Keystone is the authorization authority. AnythingLLM does NOT authorize based on `delegatedActor.roles`.
2. **systemActor Semantics**: `systemActor=true` means service-authenticated, NOT admin-allowed.
3. **No PHI in Tokens**: Tokens contain only identity metadata, never health data.
4. **Single Bearer Token**: No nested JWTs, no token concatenation.
5. **Audit Logging**: Includes service subject, delegatedActor.sub, delegatedActor.roles (for audit only), correlation ID, and request path.

### Scope Enforcement (Optional)

When `ENABLE_DELEGATED_SCOPE_ENFORCEMENT=true`, the `enforceDelegatedScopes` middleware can be applied to endpoints for defense-in-depth validation. This is NOT primary authorization - Keystone authorizes, AnythingLLM validates.

Example scope mappings:
- `GET /v1/admin/*` → `anythingllm:admin:read`
- `POST /v1/admin/*` → `anythingllm:admin:write`
- `POST /v1/workspace/:slug/thread/:threadSlug/chat` → `anythingllm:thread:write`

## Future Enhancements

- [x] Delegated JWT mode with requester context embedding
- [x] Correlation ID propagation and audit logging
- [x] Optional scope enforcement middleware
- [ ] Policy decision for workspace provisioning routes (internal admin fallback)
- [ ] Potential `system_admin` role for service actors
- [ ] GCP Secret Manager integration for secrets management
- [ ] Rate limiting on service identity endpoints
- [ ] Enhanced audit log forwarding to GCP Cloud Logging

