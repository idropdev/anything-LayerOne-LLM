# AnythingLLM Endpoint Role Guide

Complete reference guide for all endpoints categorized by role requirements.

## Role Hierarchy

- **admin**: Full system access, can manage all users and settings
- **manager**: Can manage workspaces, documents, and users (but not other admins)
- **default**: Standard user with access to their assigned workspaces
- **service**: Service-to-service authentication (Keystone Core API)

## Authentication Middleware Types

- `requireAdmin`: Admin-only endpoints (API key authentication for `/admin/*` routes)
- `requireAdminJWT`: Admin-only endpoints (JWT authentication)
- `validatedRequest`: User authentication (JWT or external auth)
- `flexUserRoleValid([ROLES])`: Role-based access control (applies only in multi-user mode)
- `strictMultiUserRoleValid([ROLES])`: Strict role check (requires multi-user mode)
- `validateKeystoneServiceCaller`: Service-to-service authentication (for `/v1/admin/*` routes)

---

## Admin-Only Endpoints

These endpoints require `requireAdmin` middleware (API key authentication).

### `/admin/*` Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/users` | List all users |
| POST | `/admin/users/new` | Create new user |
| POST | `/admin/user/:id` | Update user |
| DELETE | `/admin/user/:id` | Delete user |
| GET | `/admin/invites` | List all invites |
| POST | `/admin/invite/new` | Create new invite |
| DELETE | `/admin/invite/:id` | Delete invite |
| GET | `/admin/workspaces` | List all workspaces |
| POST | `/admin/workspace/:id/update` | Update workspace |
| POST | `/admin/workspace/:id/update-users` | Update workspace users |
| POST | `/admin/workspace/:id/update-documents` | Update workspace documents |
| POST | `/admin/workspace/:id/update-chat-history` | Update workspace chat history |
| DELETE | `/admin/workspace/:id` | Delete workspace |
| GET | `/admin/system-preferences` | Get system preferences |
| POST | `/admin/system-preferences` | Update system preferences |
| GET | `/admin/api-keys` | List API keys |
| POST | `/admin/generate-api-key` | Generate API key (requires JWT) |
| POST | `/admin/regenerate-api-key` | Regenerate API key |

### System Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/system/upload-logo` | Upload custom logo |
| GET | `/system/remove-logo` | Remove custom logo |
| GET | `/system/api-keys` | List API keys |
| POST | `/system/generate-api-key` | Generate API key |

---

## Admin + Manager Endpoints

These endpoints allow both admin and manager roles.

### Workspace Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workspace/new` | Create new workspace |
| POST | `/workspace/:slug/update` | Update workspace settings |
| POST | `/workspace/:slug/upload` | Upload document to workspace |
| POST | `/workspace/:slug/update-documents` | Update workspace documents |
| POST | `/workspace/:slug/update-chat-history` | Update workspace chat history |
| POST | `/workspace/:slug/update-users` | Update workspace users |
| POST | `/workspace/:slug/update-suggested-messages` | Update suggested messages |
| POST | `/workspace/:slug/update-agent` | Update workspace agent |
| POST | `/workspace/:slug/update-agent-flows` | Update agent flows |
| DELETE | `/workspace/:slug` | Delete workspace |
| POST | `/workspace/:slug/update-pfp` | Update workspace profile picture |

### Document Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/document/create-folder` | Create document folder |
| POST | `/document/move-files` | Move document files |

### System Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/system-vectors` | Get system vectors |
| POST | `/system/system-vectors` | Update system vectors |
| GET | `/system/llm-preference` | Get LLM preference |
| POST | `/system/llm-preference` | Update LLM preference |
| GET | `/system/embedding-preference` | Get embedding preference |
| POST | `/system/embedding-preference` | Update embedding preference |
| GET | `/system/vector-count` | Get vector count |
| POST | `/system/workspace-limits` | Update workspace limits |
| GET | `/system/workspace-limits` | Get workspace limits |
| POST | `/system/workspace-user-limits` | Update workspace user limits |
| GET | `/system/workspace-user-limits` | Get workspace user limits |

---

## Admin-Only (Role-Based)

These endpoints require admin role (via `flexUserRoleValid([ROLES.admin])`).

### System Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/telemetry` | Get telemetry settings |
| POST | `/system/telemetry` | Update telemetry settings |
| GET | `/system/security-settings` | Get security settings |
| POST | `/system/security-settings` | Update security settings |
| GET | `/system/multi-user-settings` | Get multi-user settings |
| POST | `/system/multi-user-settings` | Update multi-user settings |

---

## All Users Endpoints

These endpoints are accessible to all authenticated users (admin, manager, default).

### Workspace Access

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/workspace/:slug` | Get workspace |
| GET | `/workspace/:slug/chats` | Get workspace chats |
| GET | `/workspace/:slug/chat/:chatId` | Get specific chat |
| POST | `/workspace/:slug/chat/:chatId/update` | Update chat |
| DELETE | `/workspace/:slug/chat/:chatId` | Delete chat |
| GET | `/workspace/:slug/threads` | Get workspace threads |
| GET | `/workspace/:slug/thread/:threadSlug` | Get thread |
| POST | `/workspace/:slug/thread/:threadSlug/update` | Update thread |
| DELETE | `/workspace/:slug/thread/:threadSlug` | Delete thread |
| GET | `/workspace/:slug/thread/:threadSlug/chats` | Get thread chats |
| POST | `/workspace/:slug/thread/:threadSlug/chat` | Create thread chat |
| GET | `/workspace/:slug/thread/:threadSlug/export` | Export thread |

### Chat Operations

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workspace/:slug/stream-chat` | Stream chat (SSE) |
| POST | `/workspace/:slug/chat` | Send chat message |
| POST | `/workspace/:slug/chat/:chatId/feedback` | Submit chat feedback |
| POST | `/workspace/:slug/chat/:chatId/regenerate` | Regenerate chat response |

### User Profile

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/user` | Get current user |
| POST | `/system/user` | Update current user |
| POST | `/system/upload-pfp` | Upload profile picture |
| GET | `/system/pfp/:filename` | Get profile picture |
| GET | `/system/user/preferences` | Get user preferences |
| POST | `/system/user/preferences` | Update user preferences |

### System Information

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system/check-token` | Validate authentication token |
| GET | `/system/footer-data` | Get footer data |
| GET | `/system/support-email` | Get support email |
| GET | `/system/llm-models` | Get available LLM models |
| GET | `/system/embedding-models` | Get available embedding models |
| GET | `/system/vector-db-status` | Get vector DB status |
| GET | `/system/workspace-count` | Get workspace count |
| GET | `/system/document-count` | Get document count |

### API Endpoints (v1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/auth` | Get auth status |
| GET | `/v1/users` | List users (multi-user mode only) |
| GET | `/v1/users/:id/issue-auth-token` | Issue temporary auth token |
| GET | `/v1/system` | Get system info |
| GET | `/v1/system/vector-count` | Get vector count |
| GET | `/v1/system/workspace-count` | Get workspace count |
| GET | `/v1/system/document-count` | Get document count |
| GET | `/v1/workspaces` | List workspaces |
| GET | `/v1/workspace/:slug` | Get workspace |
| GET | `/v1/workspace/:slug/thread/:threadSlug` | Get thread |
| GET | `/v1/workspace/:slug/thread/:threadSlug/chats` | Get thread chats |
| POST | `/v1/workspace/:slug/thread/:threadSlug/chat` | Create thread chat |
| GET | `/v1/documents` | List documents |
| GET | `/v1/document/:docName` | Get document |
| GET | `/v1/openai/models` | Get OpenAI models |
| GET | `/v1/embed` | Get embed configs |

---

## Service-to-Service Endpoints

These endpoints require `validateKeystoneServiceCaller` middleware (Keystone service identity).

### `/v1/admin/*` Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/is-multi-user-mode` | Check multi-user mode |
| GET | `/v1/admin/users` | List all users |
| GET | `/v1/admin/users/external/:externalId` | Look up user by external ID |
| POST | `/v1/admin/users/new` | Create new user |
| POST | `/v1/admin/users/:id` | Update user |
| DELETE | `/v1/admin/users/:id` | Delete user |
| GET | `/v1/admin/invites` | List all invites |
| POST | `/v1/admin/invite/new` | Create new invite |
| DELETE | `/v1/admin/invite/:id` | Delete invite |
| GET | `/v1/admin/workspaces/:workspaceId/users` | Get workspace users |
| POST | `/v1/admin/workspaces/:workspaceId/update-users` | Update workspace users |
| POST | `/v1/admin/workspaces/:workspaceSlug/manage-users` | Manage workspace users |
| POST | `/v1/admin/workspace-chats` | Get workspace chats |
| POST | `/v1/admin/preferences` | Update system preferences |

### Workspace Provisioning

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/workspace/new` | Create workspace (service or admin) |

---

## Public Endpoints

These endpoints require no authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ping` | Health check |
| GET | `/migrate` | Migration status |
| GET | `/setup-complete` | Check setup status |
| GET | `/invite/:code` | Get invite details |
| POST | `/invite/:code` | Accept invite |
| POST | `/request-token` | Login (get JWT) |
| POST | `/password-recovery` | Request password recovery |
| POST | `/password-recovery/reset` | Reset password |
| GET | `/sso/login` | SSO login |

---

## Role Permission Matrix

| Endpoint Type | Admin | Manager | Default | Service |
|---------------|-------|---------|---------|---------|
| `/admin/*` | ✅ | ❌ | ❌ | ❌ |
| `/v1/admin/*` | ❌ | ❌ | ❌ | ✅ |
| Workspace Management (create/update/delete) | ✅ | ✅ | ❌ | ✅* |
| Workspace Access (view/chat) | ✅ | ✅ | ✅** | ✅ |
| Document Management | ✅ | ✅ | ❌ | ❌ |
| System Settings | ✅ | ✅*** | ❌ | ❌ |
| User Profile | ✅ | ✅ | ✅ | ❌ |
| Public Endpoints | ✅ | ✅ | ✅ | ✅ |

\* Service can create workspaces via `/v1/workspace/new`  
\*\* Default users can only access workspaces they're assigned to  
\*\*\* Managers can update some system settings (vectors, LLM preferences, etc.)

---

## Notes

1. **Multi-User Mode**: Role-based endpoints (`flexUserRoleValid`) only enforce roles when multi-user mode is enabled. In single-user mode, these endpoints are accessible to all authenticated users.

2. **Workspace Access Control**: Default users can only access workspaces they're explicitly assigned to. This is enforced at the model level, not just middleware.

3. **Service Authentication**: `/v1/admin/*` endpoints use service-to-service authentication and do NOT accept end-user tokens (even admin JWTs).

4. **API Keys vs JWTs**: 
   - `/admin/*` routes use API key authentication (`requireAdmin`)
   - Other routes use JWT authentication (`validatedRequest`)
   - Service routes use service identity tokens (`validateKeystoneServiceCaller`)

5. **External Auth**: When `EXTERNAL_AUTH_ENABLED=true`, external users (from Keystone) always get `default` role and cannot access admin endpoints.

---

## Quick Reference by Use Case

### Creating a Workspace
- **Admin/Manager**: `POST /workspace/new`
- **Service**: `POST /v1/workspace/new`

### Managing Users
- **Admin (UI)**: `POST /admin/users/new`, `POST /admin/user/:id`
- **Service**: `POST /v1/admin/users/new`, `POST /v1/admin/users/:id`

### Sending a Chat
- **All Users**: `POST /workspace/:slug/stream-chat` or `POST /workspace/:slug/chat`

### Managing Documents
- **Admin/Manager**: `POST /document/create-folder`, `POST /document/move-files`

### System Configuration
- **Admin**: `POST /admin/system-preferences`
- **Admin/Manager**: `POST /system/llm-preference`, `POST /system/embedding-preference`

---

*Last Updated: Based on codebase analysis of endpoint files*






