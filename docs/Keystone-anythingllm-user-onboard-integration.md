# HIPAA-Compliant Automatic User Onboarding Architecture

## System Overview

This architecture ensures that when a new user is created in Keystone Core API, a corresponding user account is automatically provisioned in AnythingLLM in a secure, HIPAA-compliant manner. The design leverages Keystone's existing service-to-service trust with AnythingLLM, using Google Cloud service account OIDC tokens for authentication. All communications occur over protected admin APIs on AnythingLLM, and detailed audit logs are maintained without exposing sensitive data. The following sections outline each component of the system, how they interact, and the security benefits of the approach.

## Service-to-Service Authentication (OIDC via GCP)

At the core of this integration is a robust service-to-service authentication mechanism. Keystone uses a Service Identity Service to mint short-lived OIDC ID tokens from a GCP service account, with a specific audience (`anythingllm-internal`) that AnythingLLM expects. These tokens are automatically cached (usually ~55 minutes, since they expire after 1 hour) to reduce overhead while ensuring freshness. The token minting process relies on Google's secure infrastructure, meaning the token's issuer is Google and includes the service account's identity and the intended audience. This guarantees that AnythingLLM will only trust calls from authorized Keystone services.

On the AnythingLLM side, a `ServiceIdentityGuard` (middleware) validates incoming tokens on admin endpoints: it ensures the token is from Google, the service account email matches, and the audience claim is exactly the expected value. End-user JWTs are not accepted on these internal routes – only the GCP-based service token is honored. This setup provides a zero-trust approach where Keystone must present a trusted token on each call, eliminating shared static credentials. By using OIDC tokens and Google's identity federation, we get automatic audience matching (the token can only be used for the intended service) and implicit rotation (short token lifespans), significantly enhancing security. The communication occurs over TLS to AnythingLLM's internal admin API endpoint, further protecting data in transit.

For detailed implementation information, see [SERVICE_TO_SERVICE_AUTHENTICATION.md](./SERVICE_TO_SERVICE_AUTHENTICATION.md).

## Automatic User Creation Workflow

When a user is created in Keystone (e.g., via an admin action or self-registration workflow), the system triggers a sequence to provision this user in AnythingLLM. This can be implemented as an event listener or post-signup hook in Keystone Core. The workflow proceeds as follows:

### 1. Invoke AnythingLLM Admin API

Keystone calls the AnythingLLM Admin create-user endpoint (`POST /v1/admin/users/new`) to create the new account. This call is made through the `AnythingLLMClientService`, which automatically attaches the required OIDC bearer token and a unique request ID to the HTTP request. For example, the client service would execute a call such as:

```javascript
await anythingllmClient.callAnythingLLM('/v1/admin/users/new', {
  method: 'POST',
  body: JSON.stringify({
    username,
    password,
    role: 'default',
    externalId: keystoneUserId,
    externalProvider: 'keystone'
  })
});
```

**Implementation Notes:**

- **Username**: Should match the Keystone username (subject to AnythingLLM's validation rules: 2-100 characters, lowercase alphanumeric with periods/underscores/hyphens only)
- **Password**: Generate a secure random string (external users typically won't log in directly to AnythingLLM; they authenticate through Keystone)
- **Role**: Always set to `"default"` for all Keystone-provisioned users (see Role Mapping section below)
- **External Identity Fields**: Include `externalId` (Keystone user UUID) and `externalProvider: "keystone"` to mark the account as externally managed

The service call will return a JSON response containing the new user's ID and details if successful, or an error if, for example, the username already exists. The Keystone side should handle any errors (e.g., logging and alerting if user creation failed).

### 2. Map External Identity

The new AnythingLLM user entry will include fields to tie it back to Keystone. Specifically, Keystone's user ID and an identifier for Keystone as the provider should be stored as `externalId` and `externalProvider` in AnythingLLM's user record.

**User Model Fields (from MULTI_USER_MODE_PERMISSIONS.md):**

- **`externalId`** (String?, Nullable): User ID from external authentication provider (e.g., Keystone Core API user UUID)
- **`externalProvider`** (String?, Nullable): Identifier for the external authentication provider (set to `"keystone"`)

**Permission Impact:**

- External users are **always assigned `default` role** and cannot change their role
- External users must be explicitly added to workspaces (no implicit access)
- External users follow the same permission rules as internal `default` users
- These fields are indexed together (`@@index([externalId, externalProvider])`) for fast lookups

This mapping is crucial for maintaining a clear boundary: Keystone is the source of truth for identity, and AnythingLLM will treat those users as limited-access accounts tied to an external system.

### 3. Assign to Workspaces

Once the user exists in AnythingLLM, the next step is to assign them to the appropriate workspace(s). In Keystone, a user might belong to certain projects, organizations, or groups that correspond to AnythingLLM workspaces. The integration uses the admin workspace management endpoint to reflect this association.

For each workspace the user should have access to, Keystone calls `POST /v1/admin/workspaces/:workspaceSlug/manage-users` with the new user's ID and an action to add them. This endpoint (part of AnythingLLM's admin API) allows adding a list of user IDs to a given workspace's membership list. The call is made through the same authenticated client service, including the OIDC token. For example, to add a user (ID 42) to workspace "alpha-team", Keystone would issue:

```javascript
POST /v1/admin/workspaces/alpha-team/manage-users
{
  "userIds": [42],
  "reset": false
}
```

Using `reset: false` means we are adding to existing members rather than overwriting the whole list. On success, the response will confirm the user's inclusion.

**Workspace Access Rules (from MULTI_USER_MODE_PERMISSIONS.md):**

- **Admin & Manager roles**: Have access to ALL workspaces automatically
- **Default users**: Must be explicitly added to workspaces via the `workspace_users` relationship
- **Workspace Assignment**: Only admins and managers can add/remove users from workspaces (but in this case, Keystone service identity acts as admin)

This step enforces the principle of least privilege: by default, new users (especially external ones) have no workspace access until explicitly granted. Default-role users can only access workspaces they are explicitly added to. Administrators (or automation in this case) must therefore assign every external user to the appropriate workspaces; they have no implicit access. If Keystone's user has an associated role or group that implies workspace membership, the integration logic should map that to the correct workspace slug or ID. This controlled assignment ensures that even within AnythingLLM, each user's access is scoped to the "minimum necessary" data they need, supporting HIPAA's least-access requirements.

### 4. Handle Conflicts and Idempotency

The system should be designed to handle cases where a Keystone user might already exist in AnythingLLM (for example, if the process ran twice or a rollback occurred). The AnythingLLM admin endpoints return errors for duplicate usernames; the integration should catch this and avoid creating duplicates. It could log that the user exists and proceed to ensure workspace assignments are up to date.

#### Looking Up Users by External ID

To check if a user already exists, Keystone can use the external ID lookup endpoint:

```http
GET /v1/admin/users/external/:externalId?provider=keystone
Authorization: Bearer <keystone-service-token>
```

**Example:**
```http
GET /v1/admin/users/external/550e8400-e29b-41d4-a716-446655440000?provider=keystone
```

**Response (200 OK if found):**
```json
{
  "user": {
    "id": 42,
    "username": "john.doe",
    "role": "admin",
    "externalId": "550e8400-e29b-41d4-a716-446655440000",
    "externalProvider": "keystone"
  }
}
```

**Response (404 Not Found):**
```json
{
  "error": "User not found",
  "externalId": "550e8400-e29b-41d4-a716-446655440000",
  "provider": "keystone"
}
```

#### Idempotent Onboarding Pattern

In general, the onboarding process can be made idempotent:

1. **Check if user exists** via `GET /v1/admin/users/external/:externalId`
2. **If not found**, create the user via `POST /v1/admin/users/new`
3. **If found**, skip creation (optionally update workspace assignments)
4. **Assign workspaces** via `POST /v1/admin/workspaces/:slug/manage-users`

This approach is safe to rerun and helps recover from partial failures.

### 5. Suspend/Deactivate Sync (Recommended Extension)

For completeness, the architecture should also handle user deactivation. If a user is disabled or deleted in Keystone, the system should suspend or remove the corresponding AnythingLLM account via the admin API.

**Suspension Handling (from MULTI_USER_MODE_PERMISSIONS.md):**

The user model includes a `suspended` field (Int, Default: 0):
- **Values**: `0` = active, `1` = suspended
- **Permission Impact**: 
  - **Suspended users are completely blocked from system access**
  - Suspended users cannot:
    - Log in (login endpoint returns error: "[004] Account suspended by admin.")
    - Access any endpoints (all requests return 401/403)
    - Use API keys (if suspended, API key access is denied)
  - **Effect**: Immediate - user is logged out and cannot authenticate until unsuspended

To suspend a user, call `POST /v1/admin/users/:id` with `{ suspended: 1 }`. Suspended users in AnythingLLM cannot log in or use any API keys, and all their requests are rejected. This mirrors Keystone's deactivation, ensuring no orphaned access. The integration should generate an audit log entry for such actions as well. (If complete deletion is required, `DELETE /v1/admin/users/:id` could be invoked, but usually suspension is safer for audit traceability.)

### Client Service Abstraction

Throughout these steps, the `AnythingLLMClientService` abstracts the HTTP calls for simplicity and reliability. It automatically handles:

- Injecting the bearer token (OIDC ID token)
- Setting the `Content-Type: application/json` header
- Adding a unique `X-Request-Id` header to each request
- Including `X-Client-Service: keystone` header for service identification
- Caching the OIDC token internally and reusing it until expiration (usually ~55 minutes)
- Implementing "fail-closed" behavior: if the token cannot be obtained or is invalid, the client will not call AnythingLLM at all

The unique request ID is critical for tracing and appears in logs on both sides, enabling cross-system correlation of actions. The client also caches the OIDC token internally and reuses it until expiration, meaning most calls won't incur a token minting overhead. If the token is expired or close to expiring, a fresh one is obtained from GCP on the next request. This ensures efficient yet secure operation.

## Role Mapping and Permissions

Keystone can assign any role to AnythingLLM users during onboarding via the S2S admin API. Since S2S is a trusted authentication medium, role assignments from Keystone are accepted for **admin**, **manager**, and **default** roles.

### Role Mapping from Keystone

When creating a user via `POST /v1/admin/users/new`, Keystone can specify the role directly:

```json
{
  "username": "john.doe",
  "password": "SecurePassword123!",
  "role": "admin",
  "externalId": "keystone-user-uuid",
  "externalProvider": "keystone"
}
```

**Role Mapping Strategy:**

| Keystone Role | AnythingLLM Role | Description |
|---------------|------------------|-------------|
| `admin` | `admin` | Full system access, can manage all users and settings |
| `manager` | `manager` | Can manage workspaces, documents, and users (but not other admins) |
| `user` / `default` | `default` | Standard user with access to assigned workspaces only |

**Highest Privilege Wins:** If a user has multiple roles in Keystone (e.g., `["admin", "manager"]`), the highest privilege role is assigned (`admin`).

### Role Immutability for External Users

> **CRITICAL**: Once a role is assigned to an external user during creation, it **cannot be changed** through AnythingLLM.

When `externalId` and `externalProvider` are set:
- The user is treated as externally managed (from Keystone)
- Role update attempts are blocked with error: *"Role cannot be changed for externally managed users"*
- To change a user's role, the user must be deleted and recreated from Keystone with the new role

This ensures:
1. Keystone remains the source of truth for user roles
2. No privilege escalation attacks via AnythingLLM
3. Clear audit trail - role is set once at onboarding

### Role Permissions

**Admin Role:**
- ✅ Full system access, all endpoints
- ✅ Manage all users and settings
- ✅ Exempt from daily message limits
- ✅ Access all workspaces automatically

**Manager Role:**
- ✅ Manage workspaces, documents, and users (except admins)
- ✅ Access all workspaces automatically
- ✅ Update some system settings (vectors, LLM preferences)
- ❌ Cannot manage admin users or security settings

**Default Role:**
- ✅ Access assigned workspaces only
- ✅ Profile management, threads, chat
- ❌ Cannot create/delete workspaces
- ❌ Subject to daily message limits

### External User Restrictions

**Key Constraint**: When `externalId` and `externalProvider` are set:

1. **Role is immutable** - Cannot be changed after creation
2. **External identity is immutable** - `externalId` and `externalProvider` cannot be modified
3. **Other fields are mutable** - `suspended`, `dailyMessageLimit`, `bio` can still be updated

### Daily Message Limits

Default users are subject to daily message limits if set by an admin/manager:

- **`dailyMessageLimit`** (Int?, Nullable): Chat message quota per 24-hour period
- **Values**: `null` = no limit, or positive integer (minimum 1)
- **Enforcement**: 
  - Checked before each chat message via `User.canSendChat(user)`
  - Counts successful chat messages in last 24 hours
  - System-wide limit (not per-workspace)
  - When limit reached, user receives error: "You have met your maximum 24 hour chat quota"
- **Admin Exemption**: Admin users ignore this limit (always return `true` from `canSendChat()`)

If Keystone wants to set message limits for users, it can do so via `POST /v1/admin/users/:id` with the `dailyMessageLimit` field. However, by default, new users are created with `null` (unlimited) unless explicitly set.

## Security Architecture

### Defense-in-Depth Components

The security architecture is built on multiple layers of defense:

#### 1. OIDC Token Minting & Verification

Using Google-issued OIDC tokens ensures strong identity verification between services. The token minting process uses Google's IAM, meaning the private key material is managed by Google and never hard-coded in our system. Tokens are short-lived and scoped to the AnythingLLM audience, preventing reuse elsewhere. The caching of tokens (for ~55 minutes) strikes a balance between security and performance, reducing frequent re-authentication while still rotating credentials regularly.

On AnythingLLM's side, the `ServiceIdentityGuard` performs audience matching and rejects any token that isn't exactly targeted for it. It also explicitly rejects any attempt to use a normal user JWT on admin routes, which prevents an attacker from using a stolen user token to call privileged APIs. The benefit is a defense-in-depth: even if an external attacker obtained a user's credentials, they could not invoke these internal APIs without the Google-signed service token, and those tokens can only be obtained by the Keystone service's GCP identity. This approach significantly reduces the attack surface for admin operations.

#### 2. AnythingLLMClientService (Secure API Client)

The client service in Keystone automates correct usage of the service identity. It ensures every request has a unique ID (for traceability) and includes the proper headers. By centralizing this, we avoid mistakes like missing authentication on a request. It also implements "fail-closed" behavior: if for some reason the token cannot be obtained or is invalid, the client will not call AnythingLLM at all. This prevents accidental unauthenticated requests. The inclusion of the `X-Client-Service: keystone` header is a helpful identifier on the AnythingLLM side to know which service is calling (especially useful if in the future multiple services use the admin API). The security context of this component is that it guarantees all inter-service calls are properly authenticated and logged, without developers needing to remember to add auth each time - reducing human error.

#### 3. Admin Endpoint Protection (Request Validation)

All user creation and workspace assignment calls go through AnythingLLM's protected admin endpoints, which require the service identity guard. This means that within AnythingLLM, before any user is created or modified, the request is authenticated as coming from Keystone. There's also an authorization layer: the service account in GCP can be considered a "service actor" with its own role. According to the audit docs, the token is mapped to a system actor on AnythingLLM (likely an internal representation of the Keystone service). This mapping can be used to attribute actions; for example, audit logs might show "Service Actor: Keystone-Doc-Processing" did X.

The benefit of the request validation is that it prevents any direct external access to these critical endpoints. Even if an attacker discovered the endpoint URL, they could not use it without a valid token from our GCP service account. This is a significant security boundary: the AnythingLLM admin API is effectively closed off from the internet, accessible only to Keystone (or other authorized service accounts), satisfying HIPAA's requirement to safeguard any administrative access.

#### 4. Role & Workspace Mapping (Permissions)

By enforcing that Keystone-provisioned users are always "default" role on AnythingLLM, we reduce the risk of excessive privileges. A default user in AnythingLLM cannot create new workspaces, cannot invite other users, and generally cannot access anything unless permitted. This fits the least privilege model. The explicit workspace assignment ensures the user only has access to the data they should. If a user shouldn't see certain data, simply don't add them to that workspace – and the system will enforce that they can't access it.

In multi-tenant scenarios, this separation is crucial for HIPAA (to prevent data leakage between tenants). The mapping also means if a user's role in Keystone changes or they lose access to a project, the integration can remove them from the corresponding workspace (or suspend them entirely), and they immediately lose access to those chats and documents. This dynamic permission alignment across systems upholds the HIPAA "minimum necessary" principle by not granting a user more access on the LLM side than they require.

#### 5. Suspended User Handling

As mentioned, synchronizing suspensions is important. When an account is suspended in AnythingLLM, that user is completely blocked – they cannot log in or use any API, and even any active sessions/tokens are invalidated. This is an effective kill-switch for compromised accounts or users who should no longer have access. By integrating Keystone's user status with AnythingLLM, we ensure that disabling a user in one place disables them everywhere.

The security context here is account lifecycle management: ensuring revocation of access propagates to all systems in a timely way, a key part of HIPAA compliance (e.g., terminating an employee's access on all systems when they leave). The benefit is containment – it prevents a scenario where a user is removed from Keystone but could still possibly use leftover credentials on AnythingLLM. Our design avoids that by either not issuing separate credentials to external users at all, or by programmatically suspending them.

It's also worth noting that the service actor account (the service account itself) can be suspended on AnythingLLM if needed – the audit doc shows a 403 error case "Service actor account is suspended". This indicates the system even allows suspension of a misbehaving service, adding another safety lever (though normally we wouldn't suspend our Keystone service account unless we detected misuse).

#### 6. Comprehensive Logging & Auditing

Logging every action with appropriate detail provides a deterrent and a means to detect improper use. Since logs include request IDs and timestamps, we can reconstruct events easily and prove compliance (e.g., showing an auditor the log of every user provisioned and by whom). By not logging sensitive data, we also ensure we aren't inadvertently creating a new source of PHI leakage.

The system's logging is designed to be HIPAA-compliant by default, as evidenced by the implementation notes that no tokens or PHI are ever written to logs. This means developers and ops teams don't have to remember to sanitize logs – it's built in. The benefit is twofold: we maintain patient privacy (no health data in logs), and we fulfill security monitoring requirements. In case of an incident, these logs serve as an immutable record for forensic analysis.

**Audit Log Fields (HIPAA-Compliant):**
- User ID (not email or name)
- Provider (e.g., "keystone")
- Event type (e.g., "user_created", "workspace_assigned", "user_suspended")
- Timestamp
- Request ID (for cross-system correlation)
- Service actor identity (which service made the call)

**Never Logged:**
- Raw tokens (ID tokens, refresh tokens, access tokens)
- PHI (patient health information)
- Passwords or password hashes
- Email addresses or personal identifiers that could be considered PHI

## User Model Structure in AnythingLLM

Understanding the AnythingLLM user model is essential for implementing the integration correctly. The following fields are particularly relevant:

### Database Schema

```prisma
model users {
  id                          Int                           @id @default(autoincrement())
  username                    String?                       @unique
  password                    String
  externalId                  String? 
  externalProvider            String? 
  pfpFilename                 String?
  role                        String                        @default("default")
  suspended                   Int                           @default(0)
  seen_recovery_codes         Boolean?                      @default(false)
  createdAt                   DateTime                      @default(now())
  lastUpdatedAt               DateTime                      @default(now())
  dailyMessageLimit           Int?
  bio                         String?                       @default("")
  
  // Relationships
  workspace_users             workspace_users[]  // Many-to-many with workspaces
  workspace_chats             workspace_chats[]
  // ... other relationships

  @@index([externalId, externalProvider])
}
```

### Key Fields for Integration

| Field | Type | Purpose | Integration Notes |
|-------|------|---------|-------------------|
| `username` | String? | Login identifier | Must match Keystone username (validated: 2-100 chars, lowercase alphanumeric) |
| `password` | String | Hashed password | Generate secure random string (user won't log in directly) |
| `externalId` | String? | External user ID | Set to Keystone user UUID |
| `externalProvider` | String? | External provider name | Set to `"keystone"` |
| `role` | String | Permission level | Always `"default"` for Keystone users |
| `suspended` | Int | Account status | `0` = active, `1` = suspended (sync from Keystone) |
| `dailyMessageLimit` | Int? | Chat quota | Optional: set if Keystone wants to enforce limits |

### Permission Enforcement Points

The user model fields are checked at various points in the authentication and authorization flow:

1. **Login** (`/request-token`): Checks `username`, `password`, and `suspended` field
2. **Request Validation** (`validatedRequest` middleware): Fetches user, checks `suspended` field
3. **Role-Based Access** (`flexUserRoleValid`, `strictMultiUserRoleValid`): Reads `user.role` to enforce endpoint access
4. **Chat Limits** (`User.canSendChat()`): Checks `dailyMessageLimit` before allowing chat messages
5. **Workspace Access**: Checks `workspace_users` relationship to determine if user can access a workspace

## Error Handling and Edge Cases

### Duplicate User Creation

If a user already exists in AnythingLLM (detected by duplicate username error), the integration should:

1. Log the conflict
2. Look up the existing user by `externalId` + `externalProvider` if possible
3. Proceed with workspace assignment (this will update/add workspace memberships)
4. Optionally sync other fields (e.g., `suspended` status)

### Network Failures

If the AnythingLLM API call fails due to network issues:

1. Log the error with request ID
2. Retry with exponential backoff (with reasonable max retries)
3. If all retries fail, emit an alert/event for manual intervention
4. Consider implementing a queue/retry mechanism for failed user provisioning

### Token Expiration During Request

The `AnythingLLMClientService` should handle token expiration gracefully:

1. Detect expired or expiring token before making request
2. Automatically refresh token from GCP
3. Retry the request with new token
4. Cache the new token for future requests

### Workspace Not Found

If a workspace slug/ID doesn't exist in AnythingLLM:

1. Log the error
2. Return error to Keystone
3. Keystone should handle this appropriately (e.g., create workspace first, or skip assignment)

## Implementation Checklist

When implementing this integration, ensure the following:

- [ ] **Service-to-Service Auth**: Keystone can mint OIDC tokens with correct audience
- [ ] **Client Service**: `AnythingLLMClientService` implemented with token caching and retry logic
- [ ] **User Creation Endpoint**: Calls `POST /v1/admin/users/new` with correct payload
- [ ] **External Identity Mapping**: Sets `externalId` and `externalProvider` fields correctly
- [ ] **Workspace Assignment**: Calls `POST /v1/admin/workspaces/:slug/manage-users` for each workspace
- [ ] **Error Handling**: Handles duplicate users, network failures, and API errors gracefully
- [ ] **Idempotency**: Process can be safely rerun without creating duplicates
- [ ] **Suspension Sync**: Syncs user suspension status from Keystone to AnythingLLM
- [ ] **Audit Logging**: Logs all operations with request IDs (no PHI, no tokens)
- [ ] **Rate Limiting**: Consider rate limiting on AnythingLLM API calls
- [ ] **Monitoring**: Add metrics/alerting for failed user provisioning

## Next Steps

Implementing this design will involve coordinating updates in Keystone (to trigger the API calls and handle responses) and ensuring AnythingLLM's admin endpoints support the required operations. The outcome will be a seamless onboarding experience: whenever a user is added to Keystone, they are ready to go on AnythingLLM with proper permissions in seconds, without manual intervention, and with full traceability.

**Recommended Implementation Order:**

1. **Set up AnythingLLMClientService** in Keystone with OIDC token minting and caching
2. **Implement user creation hook** in Keystone that calls `POST /v1/admin/users/new`
3. **Implement workspace assignment logic** that maps Keystone projects/groups to AnythingLLM workspaces
4. **Add error handling and idempotency** to handle edge cases
5. **Implement suspension sync** for user deactivation scenarios
6. **Add comprehensive audit logging** for all operations
7. **Test end-to-end** with various scenarios (new user, existing user, network failure, etc.)

**Example Implementation Hook (Pseudocode):**

```javascript
// In Keystone user service
async createUser(userData) {
  // 1. Create user in Keystone database
  const keystoneUser = await this.userRepository.create(userData);
  
  // 2. Trigger AnythingLLM provisioning (async/queue recommended)
  await this.anythingllmService.provisionUser({
    keystoneUserId: keystoneUser.id,
    username: keystoneUser.username,
    workspaces: userData.workspaces, // Map from Keystone projects/groups
    suspended: userData.suspended || false
  });
  
  return keystoneUser;
}
```

Ready to implement? Start by setting up the `AnythingLLMClientService` in Keystone to handle OIDC token minting and API calls, then add the user creation hook that triggers the provisioning workflow.
