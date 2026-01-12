# AnythingLLM Endpoint Role Analysis

**Date:** 2025-01-03  
**Purpose:** Comprehensive analysis of all endpoints and their role-based access requirements

---

## Table of Contents

1. [Authentication Middleware Types](#authentication-middleware-types)
2. [Role Hierarchy](#role-hierarchy)
3. [Endpoint Categories](#endpoint-categories)
4. [Complete Endpoint List by Role](#complete-endpoint-list-by-role)
5. [Service-to-Service Endpoints](#service-to-service-endpoints)
6. [Public Endpoints](#public-endpoints)
7. [Role Permission Matrix](#role-permission-matrix)

---

## Authentication Middleware Types

### Middleware Overview

| Middleware | Purpose | Role Enforcement |
|------------|---------|------------------|
| `validatedRequest` | General user authentication (JWT or external auth) | No role enforcement (endpoint-specific) |
| `requireAdmin` | Admin-only (API key authentication) | Admin only |
| `requireAdminJWT` | Admin-only (JWT authentication) | Admin only |
| `flexUserRoleValid([ROLES])` | Role-based access (only in multi-user mode) | Enforces roles when multi-user mode enabled |
| `strictMultiUserRoleValid([ROLES])` | Strict role check (requires multi-user mode) | Always enforces roles, requires multi-user mode |
| `validateKeystoneServiceCaller` | Service-to-service authentication | System actor (bypasses role checks) |
| `validateDelegatedToken` | S2S with user context | Enforces role-based restrictions from `act.roles` |
| `requireServiceOrAdmin` | Service identity OR internal admin | Service or admin |

---

## Role Hierarchy

| Role | Level | Description |
|------|-------|-------------|
| **admin** | Highest | Full system access, can manage all users and settings |
| **manager** | Medium | Can manage workspaces, documents, and users (but not other admins) |
| **default/user** | Lowest | Standard user with access to their assigned workspaces |
| **service** | Special | Service-to-service authentication (Keystone Core API) |

---

## Endpoint Categories

### 1. Admin-Only Endpoints (API Key Auth)

**Middleware:** `requireAdmin`  
**Location:** `/admin/*` routes  
**Access:** Admin only (via API key)

### 2. Admin-Only Endpoints (JWT Auth)

**Middleware:** `requireAdminJWT`  
**Location:** Various system endpoints  
**Access:** Admin only (via JWT)

### 3. Admin + Manager Endpoints

**Middleware:** `flexUserRoleValid([ROLES.admin, ROLES.manager])`  
**Access:** Admin and Manager roles

### 4. All Authenticated Users

**Middleware:** `validatedRequest` + `flexUserRoleValid([ROLES.all])` or just `validatedRequest`  
**Access:** All authenticated users (admin, manager, default)

### 5. Service-to-Service Endpoints

**Middleware:** `validateKeystoneServiceCaller`  
**Access:** Keystone service identity only (no end-user auth)

### 6. Public Endpoints

**Middleware:** None  
**Access:** No authentication required

---

## Complete Endpoint List by Role

### Admin Only (API Key - `/admin/*`)

| Method | Endpoint | Description | Middleware |
|--------|----------|-------------|------------|
| GET | `/admin/users` | List all users | `requireAdmin` |
| POST | `/admin/users/new` | Create new user | `requireAdmin` |
| POST | `/admin/user/:id` | Update user | `requireAdmin` |
| DELETE | `/admin/user/:id` | Delete user | `requireAdmin` |
| GET | `/admin/invites` | List all invites | `requireAdmin` |
| POST | `/admin/invite/new` | Create new invite | `requireAdmin` |
| DELETE | `/admin/invite/:id` | Delete invite | `requireAdmin` |
| GET | `/admin/workspaces` | List all workspaces | `requireAdmin` |
| POST | `/admin/workspace/:id/update` | Update workspace | `requireAdmin` |
| POST | `/admin/workspace/:id/update-users` | Update workspace users | `requireAdmin` |
| POST | `/admin/workspace/:id/update-documents` | Update workspace documents | `requireAdmin` |
| POST | `/admin/workspace/:id/update-chat-history` | Update workspace chat history | `requireAdmin` |
| DELETE | `/admin/workspace/:id` | Delete workspace | `requireAdmin` |
| GET | `/admin/system-preferences` | Get system preferences | `requireAdmin` |
| POST | `/admin/system-preferences` | Update system preferences | `requireAdmin` |
| GET | `/admin/api-keys` | List API keys | `requireAdmin` |
| POST | `/admin/generate-api-key` | Generate API key (requires JWT) | `requireAdminJWT` |
| POST | `/admin/regenerate-api-key` | Regenerate API key | `requireAdmin` |

### Admin Only (JWT - System Endpoints)

| Method | Endpoint | Description | Middleware |
|--------|----------|-------------|------------|
| GET | `/system/telemetry` | Get telemetry settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| POST | `/system/telemetry` | Update telemetry settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| GET | `/system/security-settings` | Get security settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| POST | `/system/security-settings` | Update security settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| GET | `/system/multi-user-settings` | Get multi-user settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| POST | `/system/multi-user-settings` | Update multi-user settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| POST | `/agent-flows/save` | Save agent flow | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| GET | `/agent-flows/list` | List agent flows | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| GET | `/agent-flows/:uuid` | Get agent flow | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| DELETE | `/agent-flows/:uuid` | Delete agent flow | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |
| POST | `/agent-flows/:uuid/toggle` | Toggle flow active status | `validatedRequest` + `flexUserRoleValid([ROLES.admin])` |

### Admin + Manager Endpoints

| Method | Endpoint | Description | Middleware |
|--------|----------|-------------|------------|
| POST | `/workspace/new` | Create new workspace | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/update` | Update workspace settings | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/upload` | Upload document to workspace | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/upload-link` | Upload link to workspace | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/update-embeddings` | Update workspace documents | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| DELETE | `/workspace/:slug` | Delete workspace | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| DELETE | `/workspace/:slug/reset-vector-db` | Reset workspace vector DB | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/suggested-messages` | Update suggested messages | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/update-pin` | Pin/unpin document | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/upload-pfp` | Upload workspace profile picture | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| DELETE | `/workspace/:slug/remove-pfp` | Remove workspace profile picture | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| DELETE | `/workspace/:slug/prompt-history` | Clear prompt history | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| DELETE | `/workspace/prompt-history/:id` | Delete prompt history item | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/workspace/:slug/upload-and-embed` | Upload and embed document | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| DELETE | `/workspace/:slug/remove-and-unembed` | Remove and unembed document | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/document/create-folder` | Create document folder | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/document/move-files` | Move document files | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/:repo_platform/branches` | Get repo branches | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/:repo_platform/repo` | Process repo | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/youtube/transcript` | Get YouTube transcript | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/confluence` | Process Confluence | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/website-depth` | Process website depth | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/drupalwiki` | Process Drupal wiki | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/ext/obsidian/vault` | Process Obsidian vault | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| GET | `/system/system-vectors` | Get system vectors | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/system/system-vectors` | Update system vectors | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| GET | `/system/llm-preference` | Get LLM preference | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/system/llm-preference` | Update LLM preference | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| GET | `/system/embedding-preference` | Get embedding preference | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/system/embedding-preference` | Update embedding preference | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| GET | `/system/vector-count` | Get vector count | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/system/workspace-limits` | Update workspace limits | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| GET | `/system/workspace-limits` | Get workspace limits | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| POST | `/system/workspace-user-limits` | Update workspace user limits | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |
| GET | `/system/workspace-user-limits` | Get workspace user limits | `validatedRequest` + `flexUserRoleValid([ROLES.admin, ROLES.manager])` |

### All Authenticated Users

| Method | Endpoint | Description | Middleware |
|--------|----------|-------------|------------|
| GET | `/workspaces` | List workspaces | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug` | Get workspace | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug/chats` | Get workspace chats | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| DELETE | `/workspace/:slug/delete-chats` | Delete chats | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| DELETE | `/workspace/:slug/delete-edited-chats` | Delete edited chats | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| POST | `/workspace/:slug/update-chat` | Update chat | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| POST | `/workspace/:slug/chat-feedback/:chatId` | Submit chat feedback | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug/suggested-messages` | Get suggested messages | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug/tts/:chatId` | Get TTS audio | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug/pfp` | Get workspace profile picture | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| POST | `/workspace/:slug/thread/fork` | Fork thread | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| PUT | `/workspace/workspace-chats/:id` | Hide chat | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug/prompt-history` | Get prompt history | `validatedRequest` + `flexUserRoleValid([ROLES.all])` |
| GET | `/workspace/:slug/threads` | Get workspace threads | `validatedRequest` |
| GET | `/workspace/:slug/thread/:threadSlug` | Get thread | `validatedRequest` |
| POST | `/workspace/:slug/thread/:threadSlug/update` | Update thread | `validatedRequest` |
| DELETE | `/workspace/:slug/thread/:threadSlug` | Delete thread | `validatedRequest` |
| GET | `/workspace/:slug/thread/:threadSlug/chats` | Get thread chats | `validatedRequest` |
| POST | `/workspace/:slug/thread/:threadSlug/chat` | Create thread chat | `validatedRequest` |
| GET | `/workspace/:slug/thread/:threadSlug/export` | Export thread | `validatedRequest` |
| POST | `/workspace/:slug/stream-chat` | Stream chat (SSE) | `validatedRequest` |
| POST | `/workspace/:slug/chat` | Send chat message | `validatedRequest` |
| POST | `/workspace/:slug/chat/:chatId/feedback` | Submit chat feedback | `validatedRequest` |
| POST | `/workspace/:slug/chat/:chatId/regenerate` | Regenerate chat response | `validatedRequest` |
| GET | `/system/user` | Get current user | `validatedRequest` |
| POST | `/system/user` | Update current user | `validatedRequest` |
| POST | `/system/upload-pfp` | Upload profile picture | `validatedRequest` |
| GET | `/system/pfp/:filename` | Get profile picture | `validatedRequest` |
| GET | `/system/user/preferences` | Get user preferences | `validatedRequest` |
| POST | `/system/user/preferences` | Update user preferences | `validatedRequest` |
| GET | `/system/check-token` | Validate authentication token | `validatedRequest` |
| GET | `/system/footer-data` | Get footer data | `validatedRequest` |
| GET | `/system/support-email` | Get support email | `validatedRequest` |
| GET | `/system/llm-models` | Get available LLM models | `validatedRequest` |
| GET | `/system/embedding-models` | Get available embedding models | `validatedRequest` |
| GET | `/system/vector-db-status` | Get vector DB status | `validatedRequest` |
| GET | `/system/workspace-count` | Get workspace count | `validatedRequest` |
| GET | `/system/document-count` | Get document count | `validatedRequest` |
| GET | `/v1/auth` | Get auth status | `validatedRequest` |
| GET | `/v1/users` | List users (multi-user mode only) | `validatedRequest` |
| GET | `/v1/users/:id/issue-auth-token` | Issue temporary auth token | `validatedRequest` |
| GET | `/v1/system` | Get system info | `validatedRequest` |
| GET | `/v1/system/vector-count` | Get vector count | `validatedRequest` |
| GET | `/v1/system/workspace-count` | Get workspace count | `validatedRequest` |
| GET | `/v1/system/document-count` | Get document count | `validatedRequest` |
| GET | `/v1/workspaces` | List workspaces | `validatedRequest` |
| GET | `/v1/workspace/:slug` | Get workspace | `validatedRequest` |
| GET | `/v1/workspace/:slug/chats` | Get workspace chats | `validatedRequest` |
| DELETE | `/v1/workspace/:slug` | Delete workspace | `validatedRequest` |
| POST | `/v1/workspace/:slug/update` | Update workspace | `validatedRequest` |
| POST | `/v1/workspace/:slug/update-embeddings` | Update workspace documents | `validatedRequest` |
| POST | `/v1/workspace/:slug/update-pin` | Update document pin status | `validatedRequest` |
| POST | `/v1/workspace/:slug/chat` | Send chat message | `validatedRequest` |
| POST | `/v1/workspace/:slug/stream-chat` | Stream chat (SSE) | `validatedRequest` |
| POST | `/v1/workspace/:slug/vector-search` | Vector similarity search | `validatedRequest` |
| GET | `/v1/workspace/:slug/thread/:threadSlug` | Get thread | `validatedRequest` |
| GET | `/v1/workspace/:slug/thread/:threadSlug/chats` | Get thread chats | `validatedRequest` |
| POST | `/v1/workspace/:slug/thread/:threadSlug/chat` | Create thread chat | `validatedRequest` |
| POST | `/v1/workspace/:slug/thread/:threadSlug/stream-chat` | Stream thread chat | `validatedRequest` |
| POST | `/v1/workspace/:slug/thread/new` | Create new thread | `validatedRequest` |
| POST | `/v1/workspace/:slug/thread/:threadSlug/update` | Update thread | `validatedRequest` |
| DELETE | `/v1/workspace/:slug/thread/:threadSlug` | Delete thread | `validatedRequest` |
| GET | `/v1/documents` | List documents | `validatedRequest` |
| GET | `/v1/document/:docName` | Get document | `validatedRequest` |
| POST | `/v1/document/upload` | Upload document | `validatedRequest` |
| POST | `/v1/document/upload/:folderName` | Upload document to folder | `validatedRequest` |
| POST | `/v1/document/upload-link` | Upload link | `validatedRequest` |
| POST | `/v1/document/raw-text` | Upload raw text | `validatedRequest` |
| GET | `/v1/documents/folder/:folderName` | Get folder documents | `validatedRequest` |
| GET | `/v1/document/accepted-file-types` | Get accepted file types | `validatedRequest` |
| GET | `/v1/document/metadata-schema` | Get metadata schema | `validatedRequest` |
| POST | `/v1/document/create-folder` | Create folder | `validatedRequest` |
| DELETE | `/v1/document/remove-folder` | Remove folder | `validatedRequest` |
| POST | `/v1/document/move-files` | Move files | `validatedRequest` |
| GET | `/v1/openai/models` | Get OpenAI models | `validatedRequest` |
| GET | `/v1/embed` | Get embed configs | `validatedRequest` |

---

## Service-to-Service Endpoints

**Middleware:** `validateKeystoneServiceCaller`  
**Access:** Keystone service identity only (system actor, bypasses role checks)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/admin/is-multi-user-mode` | Check multi-user mode |
| GET | `/v1/admin/users` | List all users |
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

**Note:** `POST /v1/workspace/new` uses `requireServiceOrAdmin` (service identity OR internal admin)

---

## Public Endpoints

**Middleware:** None  
**Access:** No authentication required

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

### Workspace Operations

| Operation | Admin | Manager | User | Service |
|------------|-------|--------|------|---------|
| Create workspace | ✅ | ✅ | ❌ | ✅* |
| Update workspace | ✅ | ✅ | ❌ | ❌ |
| Delete workspace | ✅ | ✅ | ❌ | ❌ |
| View workspace | ✅ | ✅ | ✅** | ✅ |
| Upload documents | ✅ | ✅ | ❌ | ❌ |
| Manage documents | ✅ | ✅ | ❌ | ❌ |
| View chats | ✅ | ✅ | ✅** | ✅ |
| Send chat | ✅ | ✅ | ✅** | ✅ |
| Delete own chats | ✅ | ✅ | ✅** | ❌ |

\* Service can create workspaces via `/v1/workspace/new`  
\*\* Users can only access workspaces they're assigned to

### User Management

| Operation | Admin | Manager | User | Service |
|-----------|-------|---------|------|---------|
| List users | ✅ | ❌ | ❌ | ✅ |
| Create user | ✅ | ❌ | ❌ | ✅ |
| Update user | ✅ | ❌ | ❌ | ✅ |
| Delete user | ✅ | ❌ | ❌ | ✅ |
| Manage invites | ✅ | ❌ | ❌ | ✅ |

### System Settings

| Operation | Admin | Manager | User | Service |
|-----------|-------|---------|------|---------|
| System preferences | ✅ | ❌ | ❌ | ✅ |
| LLM/Embedding settings | ✅ | ✅ | ❌ | ❌ |
| Workspace limits | ✅ | ✅ | ❌ | ❌ |
| Security settings | ✅ | ❌ | ❌ | ❌ |
| Multi-user settings | ✅ | ❌ | ❌ | ❌ |
| Telemetry settings | ✅ | ❌ | ❌ | ❌ |

### Document Management

| Operation | Admin | Manager | User | Service |
|-----------|-------|---------|------|---------|
| Upload documents | ✅ | ✅ | ❌ | ❌ |
| List documents | ✅ | ✅ | ✅ | ❌ |
| Delete documents | ✅ | ✅ | ❌ | ❌ |
| Create folders | ✅ | ✅ | ❌ | ❌ |
| Move files | ✅ | ✅ | ❌ | ❌ |

### Extensions

| Operation | Admin | Manager | User | Service |
|-----------|-------|---------|------|---------|
| Repo extensions | ✅ | ✅ | ❌ | ❌ |
| YouTube transcript | ✅ | ✅ | ❌ | ❌ |
| Confluence | ✅ | ✅ | ❌ | ❌ |
| Website depth | ✅ | ✅ | ❌ | ❌ |
| Obsidian vault | ✅ | ✅ | ❌ | ❌ |

### Agent Flows

| Operation | Admin | Manager | User | Service |
|-----------|-------|---------|------|---------|
| Create flow | ✅ | ❌ | ❌ | ❌ |
| List flows | ✅ | ❌ | ❌ | ❌ |
| Update flow | ✅ | ❌ | ❌ | ❌ |
| Delete flow | ✅ | ❌ | ❌ | ❌ |

---

## Notes

### Multi-User Mode Behavior

- **`flexUserRoleValid`**: Only enforces roles when multi-user mode is enabled. In single-user mode, these endpoints are accessible to all authenticated users.
- **`strictMultiUserRoleValid`**: Always enforces roles and requires multi-user mode to be enabled.

### Workspace Access Control

- Default users can only access workspaces they're explicitly assigned to.
- This is enforced at the model level (`Workspace.getWithUser()`, `Workspace.whereWithUser()`), not just middleware.
- Admin and Manager roles can access all workspaces.

### Service Authentication

- `/v1/admin/*` endpoints use `validateKeystoneServiceCaller` and do NOT accept end-user tokens (even admin JWTs).
- Service identity sets `systemActor=true`, which bypasses role checks.
- For delegated tokens with user context, use `validateDelegatedToken` middleware instead.

### API Keys vs JWTs

- `/admin/*` routes use API key authentication (`requireAdmin`)
- Other routes use JWT authentication (`validatedRequest`)
- Service routes use service identity tokens (`validateKeystoneServiceCaller`)

### External Auth

- When `EXTERNAL_AUTH_ENABLED=true`, external users (from Keystone) always get `default` role and cannot access admin endpoints.
- External auth uses `validateExternalUserToken` middleware which introspects tokens via Keystone.

---

## Summary Statistics

- **Total Endpoints Analyzed:** ~200+
- **Admin-Only Endpoints:** ~30
- **Admin + Manager Endpoints:** ~50
- **All Authenticated Users:** ~100
- **Service-to-Service Endpoints:** ~12
- **Public Endpoints:** ~8

---

**Last Updated:** 2025-01-03  
**Version:** 1.0




