## Summary

Implements role mapping from Keystone delegated tokens to AnythingLLM user roles and adds external ID lookup for S2S user verification.

### Features
- mapKeystoneRole() - Maps Keystone roles to AnythingLLM (admin/manager/default)
- Role immutability for external users
- GET /v1/admin/users/external/:externalId endpoint
- User.getByExternalId() and User.getByAnyId() methods
- Audit logging via EventLogs

### Files Changed
- server/models/user.js
- server/endpoints/api/admin/index.js
- server/utils/middleware/validateKeystoneServiceCaller.js
- docs/Keystone-anythingllm-user-onboard-integration.md
- docs/ENDPOINT_ROLE_GUIDE.md
