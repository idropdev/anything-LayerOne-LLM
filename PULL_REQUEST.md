# Service-to-Service Authentication: Keystone ↔ AnythingLLM

## Overview

This PR implements secure service-to-service authentication between Keystone Core API (public-facing) and AnythingLLM (internal RAG layer) using GCP OIDC ID tokens in production or RS256 JWTs for local development.

## Problem Statement

AnythingLLM's internal/admin routes need to be protected so that only Keystone Core API (running under an approved GCP service account) can access them. This provides a secure, HIPAA-aligned authentication boundary between services.

## Solution

- **Production**: Uses GCP OIDC ID tokens minted via Application Default Credentials (ADC)
- **Development**: Uses RS256 JWTs signed with a shared key pair
- **Verification**: Cryptographic token verification with fail-closed policy
- **Audit Logging**: All authentication events logged (no PHI)

## Key Changes

### New Files
- `server/utils/middleware/validateKeystoneServiceCaller.js` - Main authentication middleware
- `server/utils/middleware/requireServiceOrAdmin.js` - Composed middleware for workspace routes
- `docs/SERVICE_TO_SERVICE_AUTHENTICATION.md` - Complete implementation documentation
- `docs/KEYSTONE_IMPLEMENTATION_GUIDE.md` - Keystone developer guide
- `docs/IMPLEMENTATION_SUMMARY.md` - Implementation summary
- `docs/README.md` - Documentation index

### Modified Files
- `server/utils/auth/syncExternalUser.js` - Added `syncKeystoneServiceActor()` function
- `server/endpoints/api/admin/index.js` - Updated all routes to use `validateKeystoneServiceCaller`
- `server/endpoints/api/workspace/index.js` - Updated `POST /v1/workspace/new` to use `requireServiceOrAdmin`
- `server/package.json` - Added `google-auth-library` dependency (^10.5.0)
- `server/yarn.lock` - Updated with new dependency

## Protected Endpoints

### Admin Routes (14 endpoints - Exclusive Service Identity Only)
- `GET /v1/admin/is-multi-user-mode`
- `GET /v1/admin/users`
- `POST /v1/admin/users/new`
- `POST /v1/admin/users/:id`
- `GET /v1/admin/invites`
- `POST /v1/admin/invite/new`
- `DELETE /v1/admin/invite/:id`
- `GET /v1/admin/workspaces/:workspaceId/users`
- `POST /v1/admin/workspaces/:workspaceId/update-users`
- `POST /v1/admin/workspaces/:workspaceSlug/manage-users`
- `POST /v1/admin/workspace-chats`
- `POST /v1/admin/preferences`

### Workspace Routes
- `POST /v1/workspace/new` - Uses `requireServiceOrAdmin` (currently service-identity-only, policy decision pending)

## Authentication Flow

1. Keystone mints GCP OIDC ID token (or RS256 JWT in local mode)
2. Token attached in `Authorization: Bearer <token>` header
3. AnythingLLM middleware extracts and verifies token cryptographically
4. Verified identity mapped to system actor user (`externalProvider="keystone"`, `externalId="keystone-service"`)
5. System actor user auto-created if missing (role: admin)
6. Request proceeds with `response.locals.systemActor = true`

## Security Features

- ✅ **Fail-Closed Policy**: All authentication errors result in 401/403
- ✅ **No End-User Auth Fallback**: Admin routes explicitly reject end-user tokens
- ✅ **Cryptographic Verification**: Uses `google-auth-library` (GCP) or RS256 (local)
- ✅ **Audit Logging**: All authentication events logged via EventLogs (no PHI)
- ✅ **System Actor Isolation**: Service actors bypass normal role checks
- ✅ **No Hardcoded Secrets**: All secrets via environment variables
- ✅ **Lazy-Loading**: `google-auth-library` only loaded in GCP mode

## Environment Variables

### AnythingLLM (Required)

**GCP Mode:**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=gcp
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=<service-account>@<project-id>.iam.gserviceaccount.com
```

**Local JWT Mode:**
```env
ANYTHINGLLM_SERVICE_AUTH_MODE=local_jwt
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal
KEYSTONE_SERVICE_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----
```

### Keystone

See `docs/KEYSTONE_IMPLEMENTATION_GUIDE.md` for Keystone environment variables.

## Testing

### Test Endpoint
```bash
GET /v1/admin/is-multi-user-mode
```

This endpoint requires no request body and returns simple JSON, making it ideal for testing authentication.

### Manual Testing Steps

1. Configure environment variables in AnythingLLM
2. Ensure Keystone can mint service identity tokens (see Keystone guide)
3. Call test endpoint with valid service identity token
4. Verify successful response
5. Test with invalid/missing token to verify fail-closed behavior

## GCP Setup Required

**⚠️ These steps must be performed manually by the GCP operator:**

1. Create/configure GCP service account for Keystone
2. Grant `roles/iam.serviceAccountTokenCreator` permission
3. Attach service account to Keystone (GCE/Cloud Run/GKE)
4. Configure AnythingLLM environment variables
5. Ensure HTTPS Load Balancer forwards `Authorization` headers

See `docs/SERVICE_TO_SERVICE_AUTHENTICATION.md` for detailed GCP setup instructions.

## Breaking Changes

⚠️ **All `/v1/admin/*` routes now require service identity authentication.**

End-user authentication tokens are explicitly rejected on admin routes. Only Keystone service identity tokens are accepted.

## Migration Path

1. **Phase 1 (This PR)**: Implement service identity authentication
2. **Phase 2 (Future)**: Keystone implements token minting (see `docs/KEYSTONE_IMPLEMENTATION_GUIDE.md`)
3. **Phase 3 (Future)**: Update Keystone clients to use new authenticated endpoints

## Documentation

Complete documentation is available in the `docs/` directory:
- `SERVICE_TO_SERVICE_AUTHENTICATION.md` - Full implementation guide
- `KEYSTONE_IMPLEMENTATION_GUIDE.md` - Keystone developer guide
- `IMPLEMENTATION_SUMMARY.md` - Quick reference summary

## Dependencies

- Added `google-auth-library@^10.5.0` for GCP ID token verification

## Related Issues

<!-- Link to related issues or tickets -->

## Checklist

- [x] Code follows existing AnythingLLM patterns and conventions
- [x] All authentication errors result in appropriate HTTP status codes
- [x] Audit logging implemented (no PHI)
- [x] Environment variables documented
- [x] GCP setup steps documented
- [x] Keystone implementation guide provided
- [x] No hardcoded secrets or sensitive information
- [x] Lazy-loading of GCP libraries to prevent local dev failures
- [x] System actor user auto-creation and management
- [x] Comprehensive documentation in `docs/` directory

## Future Enhancements

- [ ] Policy decision for workspace provisioning routes (internal admin fallback)
- [ ] Potential `system_admin` role for service actors
- [ ] GCP Secret Manager integration for secrets management
- [ ] Rate limiting on service identity endpoints
- [ ] Enhanced audit log forwarding to GCP Cloud Logging

## Notes

- Service actor user is automatically created/updated on first authentication
- All authentication events are logged via EventLogs (standard AnythingLLM logging pattern)
- Code follows existing middleware patterns (similar to `validatedRequest`, `validApiKey`)
- Placeholder passwords in database are for schema compliance only (not used for authentication)
