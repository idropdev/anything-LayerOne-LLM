# Proposed Architecture: Admin vs User Authentication Separation

## Your Proposal

### Admin Operations (AnythingLLM-Managed API Keys)
- **Scope**: Administrative/system operations
- **Authentication**: Local API keys stored in AnythingLLM database
- **Examples**:
  - Create/manage workspaces
  - Assign users to workspaces
  - View all users
  - Create/delete API keys
  - System configuration
- **Endpoints**: `/v1/admin/*`
- **Control**: AnythingLLM has full control over API key lifecycle

### User Operations (Keystone JWT Tokens)
- **Scope**: User-facing operations
- **Authentication**: Keystone JWT tokens (via introspection)
- **Examples**:
  - Access assigned workspaces
  - View own profile
  - Chat/document interactions
  - View own threads
- **Endpoints**: Regular user endpoints (not `/v1/admin/*`)
- **Control**: Keystone manages user authentication

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    AnythingLLM API                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Admin Endpoints (/v1/admin/*)                              │
│  └─ Authentication: AnythingLLM API Keys                    │
│     └─ Managed by: AnythingLLM (local database)             │
│     └─ Operations:                                          │
│        • Create workspaces                                   │
│        • Assign users to workspaces                          │
│        • View all users                                      │
│        • Manage API keys                                     │
│        • System configuration                                │
│                                                               │
│  User Endpoints (regular endpoints)                         │
│  └─ Authentication: Keystone JWT Tokens                     │
│     └─ Managed by: Keystone Core API                        │
│     └─ Operations:                                          │
│        • Access assigned workspaces                          │
│        • View own data                                       │
│        • Chat/interactions                                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Benefits

### 1. Clear Separation of Concerns
- **Admin operations** = Internal/system management (API keys)
- **User operations** = External authentication (Keystone JWT)
- No confusion about which auth method to use

### 2. HIPAA Compliance
- ✅ **Audit Trail**: Clear separation between admin actions (API keys) and user actions (JWT)
- ✅ **Access Control**: Admin operations are explicitly controlled by AnythingLLM
- ✅ **User Privacy**: Users authenticated via Keystone (no PHI in AnythingLLM auth system)
- ✅ **Principle of Least Privilege**: API keys only for admin operations, not user operations

### 3. Operational Simplicity
- API keys are only for administrative/system operations
- Users always use Keystone (consistent experience)
- No confusion about which token to use when

### 4. Security
- API keys are long-lived credentials for system operations (appropriate for admin)
- JWT tokens are short-lived user credentials (appropriate for users)
- Clear revocation paths (revoke API key = revoke admin access, revoke JWT = revoke user session)

## HIPAA Compliance Analysis

### ✅ Compliant Aspects

1. **Clear Audit Boundaries**
   - Admin actions (API keys) are clearly logged separately from user actions (JWT)
   - Easier to audit who did what and when

2. **Access Control**
   - Admin operations require explicit API key creation (auditable)
   - User operations authenticated via Keystone (centralized auth)

3. **Least Privilege**
   - API keys only grant admin capabilities
   - Users can't escalate to admin via JWT tokens
   - Clear role separation

4. **User Privacy**
   - User authentication data stays in Keystone
   - AnythingLLM doesn't store user passwords
   - Only stores identity mapping (externalId, externalProvider)

### ⚠️ Considerations

1. **API Key Management**
   - Must ensure API keys are properly secured
   - Audit API key creation/deletion
   - Consider key rotation policies

2. **Admin Access Control**
   - Ensure only authorized personnel can create API keys
   - Consider additional authorization layers (IP whitelist, etc.)

3. **Audit Logging**
   - Log all API key operations
   - Log all admin operations with API key ID
   - Log all user operations with user ID

## Implementation Changes Needed

### 1. Revert `validApiKey` to Only Accept API Keys

The current implementation accepts both JWT and API keys. For your architecture, it should only accept API keys:

```javascript
// validApiKey should ONLY check for API keys
// No JWT token validation here
```

### 2. Ensure User Endpoints Use `validatedRequest`

User endpoints should use `validatedRequest` which:
- Checks for external auth (Keystone JWT) if enabled
- Falls back to internal auth if external auth disabled

### 3. Clear Documentation

Document which endpoints require what:
- `/v1/admin/*` → Requires API key (admin operations)
- Other endpoints → Requires JWT token (user operations)

## Recommended Architecture

### Admin Endpoints (`/v1/admin/*`)
```
Middleware: validApiKey
  └─ Only accepts AnythingLLM API keys
  └─ No JWT token support
  └─ For admin/system operations only
```

### User Endpoints (all others)
```
Middleware: validatedRequest
  └─ If EXTERNAL_AUTH_ENABLED=true → validateExternalToken (Keystone JWT)
  └─ Otherwise → internal auth (multi-user JWT or AUTH_TOKEN)
```

## Answer to Your Question

**YES, this architecture is:**
- ✅ HIPAA compliant (clear audit boundaries, access control, least privilege)
- ✅ Simple and well-defined (clear separation of admin vs user auth)
- ✅ Maintainable (each auth method has clear purpose)

This is actually **better** than the hybrid approach because:
1. Clearer separation of concerns
2. Easier to audit (admin actions vs user actions)
3. Simpler mental model (API keys = admin, JWT = users)
4. No confusion about which token to use

## Next Steps

1. Revert `validApiKey` to only accept API keys (remove JWT support)
2. Ensure `/v1/admin/*` endpoints use `validApiKey` only
3. Ensure user endpoints use `validatedRequest` (which supports Keystone JWT)
4. Document this architecture clearly
5. Add audit logging for API key operations


