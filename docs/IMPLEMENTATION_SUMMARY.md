# Service-to-Service Authentication - Implementation Summary

## Date: Today's Implementation

## Overview

Implemented secure service-to-service authentication between Keystone Core API and AnythingLLM using GCP OIDC ID tokens (production) or RS256 JWTs (local development).

## Changes Made

### New Files Created

1. **`server/utils/middleware/validateKeystoneServiceCaller.js`**
   - Main authentication middleware for service identity verification
   - Supports both GCP ID token and local JWT verification modes
   - Handles user sync and audit logging

2. **`server/utils/middleware/requireServiceOrAdmin.js`**
   - Composed middleware for routes that may allow either service identity or internal admin
   - Currently defaults to service-identity-only (policy decision pending)

3. **`docs/SERVICE_TO_SERVICE_AUTHENTICATION.md`**
   - Complete implementation documentation
   - Security considerations and GCP setup instructions

4. **`docs/KEYSTONE_IMPLEMENTATION_GUIDE.md`**
   - Guide for Keystone developers on token minting and API calls
   - Examples and troubleshooting

5. **`docs/README.md`**
   - Documentation index

6. **`docs/IMPLEMENTATION_SUMMARY.md`**
   - This summary document

### Files Modified

1. **`server/utils/auth/syncExternalUser.js`**
   - Added `syncKeystoneServiceActor()` function
   - Creates/updates system actor user with `externalProvider="keystone"`, `externalId="keystone-service"`

2. **`server/endpoints/api/admin/index.js`**
   - Updated all `/v1/admin/*` routes to use `validateKeystoneServiceCaller`
   - Removed `validatedRequest` from admin routes (exclusive service identity only)

3. **`server/endpoints/api/workspace/index.js`**
   - Updated `POST /v1/workspace/new` to use `requireServiceOrAdmin`

4. **`server/package.json`**
   - Added `google-auth-library` dependency (^10.5.0)

### Files Removed

1. **`server/SERVICE_IDENTITY_DEBUGGING.md`** - Temporary debugging guide
2. **`server/SERVICE_TO_SERVICE_AUTH.md`** - Original plan document (consolidated)
3. **`server/SERVICE_IDENTITY_ENDPOINTS.md`** - Endpoint list (consolidated)
4. **`server/KEYSTONE_SERVICE_IDENTITY_GUIDE.md`** - Moved to `docs/`

## Security Review

✅ **No hardcoded secrets** - All secrets come from environment variables  
✅ **No hardcoded service account emails or project IDs** - All use placeholders in docs  
✅ **Placeholder passwords** - Only used for database schema compliance, not authentication  
✅ **Fail-closed policy** - All auth errors result in 401/403  
✅ **No PHI in logs** - Audit logs only contain service identity metadata  
✅ **Lazy-loading** - `google-auth-library` only loaded in GCP mode  

## Protected Endpoints

### Admin Routes (14 endpoints)
All `/v1/admin/*` routes now require exclusive service identity authentication:
- User management (4 endpoints)
- Invite management (3 endpoints)
- Workspace user management (3 endpoints)
- Chat management (1 endpoint)
- System preferences (1 endpoint)
- System status (1 endpoint)
- Admin preferences (1 endpoint)

### Workspace Routes (1 endpoint)
- `POST /v1/workspace/new` - Uses `requireServiceOrAdmin` (currently service-identity-only)

## Environment Variables Required

### AnythingLLM

**GCP Mode:**
- `ANYTHINGLLM_SERVICE_AUTH_MODE=gcp`
- `ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal`
- `ANYTHINGLLM_ALLOWED_CALLER_SA_EMAIL=<service-account>@<project-id>.iam.gserviceaccount.com`

**Local JWT Mode:**
- `ANYTHINGLLM_SERVICE_AUTH_MODE=local_jwt`
- `ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm-internal`
- `KEYSTONE_SERVICE_PUBLIC_KEY=<public-key>`

## Testing

Test endpoint: `GET /v1/admin/is-multi-user-mode`

This endpoint requires no request body and returns simple JSON, making it ideal for testing authentication.

## Next Steps

1. **Keystone Implementation**: Follow `docs/KEYSTONE_IMPLEMENTATION_GUIDE.md` to implement token minting in Keystone
2. **GCP Setup**: Configure service accounts and IAM roles as documented
3. **Policy Decision**: Decide if workspace provisioning routes should allow internal admin fallback
4. **Testing**: Test end-to-end authentication flow
5. **Production Deployment**: Deploy with proper environment variable configuration

## Notes

- Service actor user is automatically created/updated on first authentication
- All authentication events are logged via EventLogs (standard AnythingLLM logging)
- Code follows existing AnythingLLM patterns and conventions
- Documentation is comprehensive and ready for use

