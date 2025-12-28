# Service-to-Service Authentication Implementation

## Overview

This document describes the service-to-service authentication implementation between Keystone Core API and AnythingLLM, enabling secure communication using GCP OIDC ID tokens (production) or RS256 JWTs (local development).

## Architecture

- **Keystone Core API**: Front-facing public API that authenticates end users and manages service requests
- **AnythingLLM**: Internal RAG layer running on a GCE VM behind a Google Cloud HTTPS Load Balancer
- **Authentication Method**: GCP OIDC ID tokens (production) or RS256 JWTs (local development)
- **Security Model**: Fail-closed policy with cryptographic token verification

## Implementation Details

### AnythingLLM Side

#### Middleware

**File:** `server/utils/middleware/validateKeystoneServiceCaller.js`

- Verifies GCP OIDC ID tokens using `google-auth-library`
- Supports local RS256 JWT verification for development
- Maps verified service identity to system actor user
- Enforces audience and service account email validation

**Key Features:**
- Lazy-loads `google-auth-library` (only in GCP mode) to prevent local dev failures
- Creates/updates system actor user (`externalProvider="keystone"`, `externalId="keystone-service"`)
- Audit logging via EventLogs (no PHI)
- Fail-closed on all verification errors

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

**Critical Invariant:** `ANYTHINGLLM_SERVICE_AUDIENCE` must be identical across Keystone and AnythingLLM, and must never be reused for end-user tokens.

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
3. **Audit Logging**: All authentication events are logged (no PHI)
4. **Token Verification**: Cryptographic verification via `google-auth-library` (GCP) or RS256 (local)
5. **System Actor Isolation**: Service actor users have `systemActor=true` flag and bypass normal role checks

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
- `server/utils/middleware/requireServiceOrAdmin.js` - Composed middleware for workspace routes
- `docs/SERVICE_TO_SERVICE_AUTHENTICATION.md` - This document
- `docs/KEYSTONE_IMPLEMENTATION_GUIDE.md` - Keystone implementation guide

### Modified Files
- `server/utils/auth/syncExternalUser.js` - Added `syncKeystoneServiceActor()` function
- `server/endpoints/api/admin/index.js` - Updated all routes to use `validateKeystoneServiceCaller`
- `server/endpoints/api/workspace/index.js` - Updated `POST /v1/workspace/new` to use `requireServiceOrAdmin`
- `server/package.json` - Added `google-auth-library` dependency

## Future Enhancements

- [ ] Policy decision for workspace provisioning routes (internal admin fallback)
- [ ] Potential `system_admin` role for service actors
- [ ] GCP Secret Manager integration for secrets management
- [ ] Rate limiting on service identity endpoints
- [ ] Enhanced audit log forwarding to GCP Cloud Logging

