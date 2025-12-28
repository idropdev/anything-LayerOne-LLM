# Admin Endpoints Audit

**Audit Date:** 2025-12-28  
**Status:** ✅ All endpoints properly secured

## Authentication Requirements

All `/v1/admin/*` endpoints require **service identity authentication** via `validateKeystoneServiceCaller` middleware. End-user JWTs are explicitly rejected.

---

## Endpoints Reference

### GET `/v1/admin/is-multi-user-mode`

Check if instance is in multi-user mode.

**Response 200:**
```json
{
  "isMultiUser": true
}
```

---

### GET `/v1/admin/users`

List all users in the system.

**Response 200:**
```json
{
  "users": [
    {
      "id": 1,
      "username": "admin",
      "role": "admin",
      "suspended": 0
    },
    {
      "id": 2,
      "username": "user1",
      "role": "default",
      "suspended": 0
    }
  ]
}
```

**Response 401:** Instance not in multi-user mode.

---

### POST `/v1/admin/users/new`

Create a new user.

**Request Payload:**
```json
{
  "username": "new-user",
  "password": "securepassword123",
  "role": "default"
}
```

**Response 200:**
```json
{
  "user": {
    "id": 3,
    "username": "new-user",
    "role": "default"
  },
  "error": null
}
```

**Response 400:**
```json
{
  "user": null,
  "error": "Username already exists"
}
```

---

### POST `/v1/admin/users/:id`

Update an existing user.

**Request Payload:**
```json
{
  "username": "updated-name",
  "role": "admin",
  "suspended": 0
}
```

**Response 200:**
```json
{
  "success": true,
  "error": null
}
```

---

### DELETE `/v1/admin/users/:id`

Delete a user by ID.

**Response 200:**
```json
{
  "success": true,
  "error": null
}
```

---

### GET `/v1/admin/invites`

List all invitations.

**Response 200:**
```json
{
  "invites": [
    {
      "id": 1,
      "status": "pending",
      "code": "abc-123",
      "claimedBy": null
    }
  ]
}
```

---

### POST `/v1/admin/invite/new`

Create a new invite code.

**Request Payload:**
```json
{
  "workspaceIds": [1, 2, 3]
}
```

**Response 200:**
```json
{
  "invite": {
    "id": 2,
    "status": "pending",
    "code": "xyz-789"
  },
  "error": null
}
```

---

### DELETE `/v1/admin/invite/:id`

Deactivate an invite.

**Response 200:**
```json
{
  "success": true,
  "error": null
}
```

---

### GET `/v1/admin/workspaces/:workspaceId/users`

List users with access to a workspace.

**Response 200:**
```json
{
  "users": [
    { "userId": 1, "role": "admin" },
    { "userId": 2, "role": "member" }
  ]
}
```

---

### POST `/v1/admin/workspaces/:workspaceId/update-users`

*Deprecated.* Overwrite workspace user permissions.

**Request Payload:**
```json
{
  "userIds": [1, 2, 4, 12]
}
```

**Response 200:**
```json
{
  "success": true,
  "error": null
}
```

---

### POST `/v1/admin/workspaces/:workspaceSlug/manage-users`

Add or reset workspace users by slug.

**Request Payload:**
```json
{
  "userIds": [1, 2, 4],
  "reset": false
}
```

**Response 200:**
```json
{
  "success": true,
  "error": null,
  "users": [
    { "userId": 1, "username": "admin", "role": "admin" },
    { "userId": 2, "username": "user1", "role": "default" }
  ]
}
```

---

### POST `/v1/admin/workspace-chats`

Get all workspace chats (paginated).

**Request Payload:**
```json
{
  "offset": 0
}
```

**Response 200:**
```json
{
  "chats": [...],
  "hasPages": true
}
```

---

### POST `/v1/admin/preferences`

Update system preferences.

**Request Payload:**
```json
{
  "support_email": "support@example.com"
}
```

**Response 200:**
```json
{
  "success": true,
  "error": null
}
```

---

## Related Service-Protected Endpoints

### POST `/v1/workspace/new`

Create a new workspace. Uses `requireServiceOrAdmin` middleware.

**Request Payload:**
```json
{
  "name": "My Workspace",
  "similarityThreshold": 0.7,
  "openAiTemp": 0.7,
  "chatMode": "chat"
}
```

**Response 200:**
```json
{
  "workspace": {
    "id": 1,
    "name": "My Workspace",
    "slug": "my-workspace",
    "createdAt": "2025-01-01 00:00:00"
  },
  "message": "Workspace created"
}
```

---

## Error Responses

| Status | JSON Response | Condition |
|--------|---------------|-----------|
| 401 | `{"error": "Missing service identity token"}` | No Authorization header |
| 401 | `{"error": "Invalid service identity token"}` | Token verification failed |
| 403 | `{"error": "Service actor account is suspended"}` | Service actor suspended |
| 500 | `{"error": "Service identity verification failed"}` | User sync failure |

---

## Security Model

- **Fail-closed**: All verification errors result in rejection
- **No end-user fallback**: Admin routes reject end-user JWTs
- **Service actor mapping**: Verified service identity maps to system actor user

See [SERVICE_TO_SERVICE_AUTHENTICATION.md](./SERVICE_TO_SERVICE_AUTHENTICATION.md) for implementation details.
