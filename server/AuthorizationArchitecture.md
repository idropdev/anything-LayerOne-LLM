# AnythingLLM Authorization Architecture

This document captures the authorization model currently implemented in the backend, covering both admin/system APIs and default user APIs that authenticate through Keystone.

## Credential Types

| Credential    | Issued By                                                     | Used On                                                       | Validation Path                                                        |
| ------------- | ------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Admin API Key | `/api/system/generate-api-key` (after verifying an Admin JWT) | Admin/system endpoints (`adminOnlyAuth`) and shared endpoints | Direct lookup in `api_keys` table                                      |
| Keystone JWT  | Keystone Core                                                 | Default user endpoints + shared endpoints                     | Introspection via `EXTERNAL_AUTH_API_URL` + `EXTERNAL_API_SERVICE_KEY` |

All HTTP calls use `Authorization: Bearer <token>`. Admin endpoints accept API keys only. User endpoints rely on `unifiedAuth`, which first attempts API key lookup (to allow admins to hit user APIs) and falls back to Keystone introspection for default users.

## Keystone Introspection Flow

1. `unifiedAuth` / `validatedRequest` detect non–API-key requests.
2. `keystoneIntrospection` POSTs `token`, `tokenTypeHint`, and `includeUser` to `EXTERNAL_AUTH_API_URL` (default `/api/v1/auth/introspect`) with `Authorization: Bearer ${EXTERNAL_API_SERVICE_KEY}`.
3. Issuer, audience, expiration, and `active` flags are validated. Responses are cached briefly to reduce load.
4. `buildDefaultUserPrincipal` maps the introspection payload to a principal object (`sub`, `role`, `scope`, etc.). These values are stored on `response.locals.principal`.

## Auto-Provisioning External Users

`User.findOrCreateExternalUser()` (added in `server/models/user.js`) ensures an introspected identity exists in the local `users` table:

- `externalId` and `externalProvider` are persisted, and we enforce a unique `(externalId, externalProvider)` index.
- Usernames are deterministically generated (`<provider>:<sub>`) and sanitized. Collisions append numeric counters or a short random suffix.
- Roles bubble through from the Keystone token. Invalid roles degrade to `default`.
- Passwords are random and unused (default users authenticate solely through Keystone).

`unifiedAuth` and `validatedRequest` call this helper automatically when a matching local user is not found, eliminating the “User not found” failure mode for default users.

## Workspace Scoping Helper

`server/utils/workspaces/access.js` centralizes role-aware workspace filtering:

- `isAdminRequest(response)` simply checks whether the resolved principal was an admin/api-key request.
- `scopeWorkspaceQuery(response, prismaArgs)` injects a `workspace_users.some.user_id = currentUser.id` clause for default users, while leaving admin queries untouched.
- `getWorkspaceForRequest(response, clause, options)` wraps `_findFirst` with the scoping logic, ensuring any single-workspace lookup respects membership.
- `getAccessibleWorkspaceIds(response)` returns the set of workspace IDs a caller can reach, simplifying joins (e.g., embed configs, thread lists).

These utilities are consumed by every shared API so the filtering rules stay consistent and maintainable.

## Endpoint Behavior

- **Workspaces (`server/endpoints/api/workspace/index.js`)**

  - Creation: default users become members of the workspace they create.
  - Listing, slug lookups, deletion, updates, chat/vector endpoints, and document pinning all run through `getWorkspaceForRequest` or scoped Prisma queries.
  - Admin/API key requests retain legacy behavior (full visibility).

- **Workspace Threads (`server/endpoints/api/workspaceThread/index.js`)**

  - Thread CRUD, chat, and streaming require membership in the parent workspace. Default users cannot interact with threads outside their scope.

- **OpenAI-Compatible Routes (`server/endpoints/api/openai/index.js`)**

  - `/v1/openai/models` and `/v1/openai/vector_stores` return only workspaces the caller can access.
  - `/v1/openai/chat/completions` uses `getWorkspaceForRequest`, preventing default users from chatting against unauthorized workspaces.

- **Embed APIs (`server/endpoints/api/embed/index.js`)**

  - Listing embeds filters by the caller’s accessible workspace IDs.
  - Chat history, creation, update, and deletion operations require ownership of the underlying workspace via `getAuthorizedEmbed`.

- **Documents & Other APIs**
  - `validatedRequest` guards legacy multi-user endpoints (browser-based) with the same auth stack, so UI flows benefit from Keystone introspection automatically.

## Endpoint Auth Matrix

| Area / File                               | Representative Routes                                                                                                                             | Middleware                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Workspaces (`api/workspace`)              | `/v1/workspaces`, `/v1/workspace/:slug`, `/v1/workspace/:slug/chat`, `/v1/workspace/:slug/vector-search`, etc.                                    | `unifiedAuth` (admins via API key, default users via Keystone) + `scopeWorkspaceQuery`/`getWorkspaceForRequest` |
| Workspace Threads (`api/workspaceThread`) | `/v1/workspace/:slug/thread/*` CRUD + chat/stream                                                                                                 | `unifiedAuth` with `getWorkspaceForRequest`                                                                     |
| OpenAI-Compatible (`api/openai`)          | `/v1/openai/models`, `/v1/openai/chat/completions`, `/v1/openai/vector_stores`                                                                    | `unifiedAuth` + workspace scoping helpers                                                                       |
| Embed API (`api/embed`)                   | `/v1/embed`, `/v1/embed/:uuid`, `/v1/embed/:uuid/chats*`                                                                                          | `unifiedAuth` + `getWorkspaceForRequest` / `getAuthorizedEmbed`                                                 |
| System Settings (`api/system`)            | `/v1/system`, `/v1/system/vector-count`, `/v1/system/update-env`, `/v1/system/export-chats`, `/v1/system/remove-documents`, `/v1/system/env-dump` | `adminOnlyAuth` (API key required)                                                                              |
| User Management (`api/userManagement`)    | `/v1/users`, `/v1/users/:id/issue-auth-token`                                                                                                     | `adminOnlyAuth` + `simpleSSOEnabled` (where applicable)                                                         |
| Documents (`api/document`)                | All document uploads, local file listings, folder management, and retrieval endpoints                                                             | `adminOnlyAuth`                                                                                                 |

Use this table as the source of truth when wiring new routes: user-facing flows share `unifiedAuth`, while anything that manipulates global settings, users, or raw documents must require an admin API key.

## Testing Considerations

1. Confirm admin API key calls to shared endpoints still return global datasets and allow full mutation.
2. Use a Keystone JWT for a default user:
   - Hit `/api/v1/workspaces`, `/v1/openai/models`, `/v1/embed`, and workspace thread routes to verify scoping.
   - Create a workspace to ensure auto-provisioning and membership linking work end-to-end.
3. Rotate the Keystone token/role to ensure role propagation (e.g., `manager`) behaves as expected.

### Quick Test Path

1. **Request admin token**
   - POST `/api/request-token` with admin credentials to receive the internal admin JWT.
2. **Generate admin API key**
   - POST `/api/system/generate-api-key` using `Authorization: Bearer <admin-JWT>` to mint a new API key.
3. **Call workspace endpoint as admin**
   - GET `/api/v1/workspaces` with `Authorization: Bearer <api-key>` and confirm the full workspace list is returned.
4. **Obtain Keystone JWT**
   - Log in to Keystone Core and capture the user JWT issued for a default user.
5. **Call workspace endpoint as default user**
   - GET `/api/v1/workspaces` with `Authorization: Bearer <keystone-JWT>` and verify only workspaces linked to that user are returned.

## Environment Checklist

- `EXTERNAL_AUTH_ENABLED=true`
- `EXTERNAL_AUTH_MODE=introspect`
- `EXTERNAL_AUTH_API_URL=<keystone-base-url>`
- `EXTERNAL_API_SERVICE_KEY` (same as in keystone)
- `EXTERNAL_AUTH_REQUIRE_HTTPS=false` (in development)

Ensure the backend reloads after updating `.env` so the introspection configuration and API service key take effect.
