# Multi-User Mode Permissions Guide

This document outlines what users can and cannot do when multi-user mode is enabled in AnythingLLM.

## Overview

When multi-user mode is enabled, the system enforces role-based access control (RBAC) with three distinct roles:

1. **Admin** - Highest privilege level
2. **Manager** - Intermediate privilege level  
3. **Default** - Basic user privilege level

## User Model Structure

The user model (`users` table) is the core entity that defines user identity and permissions. Understanding its structure is essential for understanding how permissions work.

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
  workspace_chats             workspace_chats[]
  workspace_users             workspace_users[]
  embed_configs               embed_configs[]
  embed_chats                 embed_chats[]
  threads                     workspace_threads[]
  recovery_codes              recovery_codes[]
  password_reset_tokens       password_reset_tokens[]
  workspace_agent_invocations workspace_agent_invocations[]
  slash_command_presets       slash_command_presets[]
  browser_extension_api_keys  browser_extension_api_keys[]
  temporary_auth_tokens       temporary_auth_tokens[]
  system_prompt_variables     system_prompt_variables[]
  prompt_history              prompt_history[]

  @@index([externalId, externalProvider])
}
```

### User Model Fields and Permission Implications

#### Core Identity Fields

**`id`** (Int, Primary Key)
- Unique identifier for the user
- Used throughout the system to associate user actions, workspace access, chats, etc.
- **Permission Impact**: Used in all permission checks to identify the requesting user

**`username`** (String?, Unique)
- User's login identifier
- Must be unique across the system
- **Validation Rules**:
  - 2-100 characters in length
  - Only lowercase letters, numbers, periods, underscores, and hyphens
  - No spaces allowed
- **Permission Impact**: Used for authentication; does not affect permissions directly

**`password`** (String)
- Hashed password using bcrypt (10 rounds)
- **Password Complexity**: Configurable via environment variables:
  - `PASSWORDMINCHAR` (default: 8)
  - `PASSWORDMAXCHAR` (default: 250)
  - `PASSWORDLOWERCASE`, `PASSWORDUPPERCASE`, `PASSWORDNUMERIC`, `PASSWORDSYMBOL` (default: 0)
  - `PASSWORDREQUIREMENTS` (default: 0)
- **Permission Impact**: Required for authentication; does not affect permissions

#### External Authentication Fields

**`externalId`** (String?, Nullable)
- User ID from external authentication provider (e.g., Keystone Core API)
- Used with `externalProvider` to identify externally authenticated users
- **Permission Impact**: 
  - External users are always assigned `default` role
  - External users must be explicitly added to workspaces
  - Indexed with `externalProvider` for fast lookups

**`externalProvider`** (String?, Nullable)
- Identifier for the external authentication provider (e.g., "keystone")
- Used with `externalId` to uniquely identify external users
- **Permission Impact**: 
  - When set, user is treated as externally authenticated
  - External users cannot change their role (always `default`)
  - External users follow same permission rules as internal `default` users

#### Profile Fields

**`pfpFilename`** (String?, Nullable)
- Profile picture filename
- **Permission Impact**: No permission implications; all users can update their own profile picture

**`bio`** (String?, Default: "")
- User biography/description
- **Validation**: Maximum 1,000 characters
- **Permission Impact**: No permission implications; all users can update their own bio

#### Permission Control Fields

**`role`** (String, Default: "default")
- **Primary permission control field**
- **Valid Values**: `"admin"`, `"manager"`, `"default"`
- **Permission Impact**: 
  - **Directly determines all system permissions**
  - Used by middleware (`strictMultiUserRoleValid`, `flexUserRoleValid`) to enforce access control
  - Cannot be changed by users themselves (only admins/managers can change roles)
  - **Role Hierarchy**:
    - `admin` > `manager` > `default`
    - Users can only create/modify users with roles at or below their own level

**`suspended`** (Int, Default: 0)
- **Account suspension status**
- **Values**: `0` = active, `1` = suspended
- **Permission Impact**: 
  - **Suspended users are completely blocked from system access**
  - Checked in authentication middleware (`validatedRequest`, `requireAdmin`)
  - Suspended users cannot:
    - Log in (login endpoint returns error: "[004] Account suspended by admin.")
    - Access any endpoints (all requests return 401/403)
    - Use API keys (if suspended, API key access is denied)
  - **Who can suspend**: Only admins can suspend/unsuspend users
  - **Effect**: Immediate - user is logged out and cannot authenticate until unsuspended

**`dailyMessageLimit`** (Int?, Nullable)
- **Chat message quota per 24-hour period**
- **Values**: `null` = no limit, or positive integer (minimum 1)
- **Permission Impact**:
  - **Admins are exempt**: Admin users ignore this limit (always return `true` from `canSendChat()`)
  - **Managers and Default users**: Subject to limit if set
  - **Enforcement**: 
    - Checked before each chat message via `User.canSendChat(user)`
    - Counts successful chat messages in last 24 hours
    - System-wide limit (not per-workspace)
    - When limit reached, user receives error: "You have met your maximum 24 hour chat quota"
  - **Who can set**: Admins and managers can set limits for other users

#### Metadata Fields

**`seen_recovery_codes`** (Boolean?, Default: false)
- Tracks whether user has viewed their MFA recovery codes
- **Permission Impact**: No direct permission impact; used for MFA flow

**`createdAt`** (DateTime)
- Account creation timestamp
- **Permission Impact**: No permission implications

**`lastUpdatedAt`** (DateTime)
- Last profile update timestamp
- **Permission Impact**: No permission implications

### User Model Relationships

The user model has relationships to many other entities that affect permissions:

1. **`workspace_users`**: Many-to-many relationship defining which workspaces a user can access
   - **Permission Impact**: Default users can only access workspaces they are explicitly added to
   - Admins and managers have implicit access to all workspaces

2. **`workspace_chats`**: All chat messages sent by the user
   - **Permission Impact**: Used to count messages for `dailyMessageLimit` enforcement

3. **`browser_extension_api_keys`**: API keys created by the user for browser extension
   - **Permission Impact**: Only admins and managers can create browser extension API keys

4. **`embed_configs`**: Embed chat widget configurations created by the user
   - **Permission Impact**: Only admins can create embed configurations

5. **`system_prompt_variables`**: System prompt variables created by the user
   - **Permission Impact**: Only admins can create system prompt variables

### User Model Methods and Permission Checks

#### `User.canSendChat(user)`
- **Purpose**: Check if user can send a chat message
- **Logic**:
  - Returns `true` if user is admin
  - Returns `true` if `dailyMessageLimit` is `null` (no limit)
  - Otherwise, counts messages in last 24 hours and compares to limit
- **Permission Impact**: Enforced in chat endpoints before processing messages

#### `User.filterFields(user)`
- **Purpose**: Remove sensitive fields (password) before returning user data
- **Permission Impact**: Ensures passwords are never exposed in API responses

#### `User.checkPasswordComplexity(password)`
- **Purpose**: Validate password meets complexity requirements
- **Permission Impact**: Enforced during user creation and password updates

### How User Fields Affect Permissions

#### Authentication Flow

1. **Login** (`/request-token`):
   - Checks `username` and `password` match
   - **Checks `suspended` field**: If `suspended === 1`, login is denied
   - Creates JWT token with `{ id, username, role }`

2. **Request Validation** (`validatedRequest` middleware):
   - Decodes JWT to get user `id`
   - Fetches user from database
   - **Checks `suspended` field**: If `suspended === 1`, returns 401 error
   - Attaches user to `response.locals.user`

3. **Role-Based Access** (`flexUserRoleValid`, `strictMultiUserRoleValid`):
   - Reads `user.role` from authenticated user
   - Compares against allowed roles for the endpoint
   - Returns 401 if role doesn't match

#### Permission Enforcement Points

| Field | Checked Where | Effect if Invalid |
|-------|---------------|-------------------|
| `role` | All protected endpoints | 401 Unauthorized |
| `suspended` | Login, all authenticated endpoints | 401/403 Forbidden |
| `dailyMessageLimit` | Chat endpoints | Error message, chat blocked |
| `externalId` + `externalProvider` | External auth flow | Determines if user is external (always `default` role) |

### User Model Writable Fields

Only these fields can be updated via the user update API:

- `username` (with validation)
- `password` (with complexity check)
- `pfpFilename`
- `role` (with permission checks)
- `suspended` (admin only)
- `dailyMessageLimit` (admin/manager only)
- `bio` (with length validation)

**Security Note**: The `password` field is always filtered out when returning user data to prevent exposure.

## User Model and Permissions

The user model is the foundation of the permission system. Every permission check ultimately relies on user model fields, particularly the `role` and `suspended` fields.

### Key Permission Fields

**`role`** - The primary permission control mechanism
- Determines what endpoints, features, and data a user can access
- Three valid values: `"admin"`, `"manager"`, `"default"`
- Set during user creation and can be modified by admins/managers (with restrictions)
- Checked by middleware on every protected endpoint

**`suspended`** - Complete access block
- When `suspended === 1`, user cannot:
  - Log in (login endpoint rejects with error message)
  - Access any authenticated endpoints (returns 401/403)
  - Use API keys (even if key is valid, suspended user is denied)
- Only admins can suspend/unsuspend users
- Effect is immediate - user is logged out and cannot re-authenticate

**`dailyMessageLimit`** - Chat quota enforcement
- `null` = unlimited (default for new users)
- Positive integer = maximum chats per 24-hour rolling window
- Admins are always exempt (limit is ignored for admin role)
- Enforced at chat endpoint level before processing messages

**`externalId` + `externalProvider`** - External authentication
- When set, user is externally authenticated (e.g., via Keystone Core API)
- External users are always assigned `default` role (cannot be changed)
- External users must be explicitly added to workspaces
- Follow same permission rules as internal `default` users

### Permission Check Flow

```
1. User authenticates → JWT created with { id, username, role }
2. Request arrives → validatedRequest middleware:
   - Decodes JWT to get user.id
   - Fetches user from database
   - Checks user.suspended → if 1, return 401
   - Attaches user to response.locals.user
3. Endpoint middleware → flexUserRoleValid/strictMultiUserRoleValid:
   - Reads user.role from response.locals.user
   - Compares against allowedRoles array
   - If role matches → allow, else → return 401
4. Business logic → Additional checks:
   - User.canSendChat(user) → checks dailyMessageLimit
   - Workspace access → checks workspace_users relationship
   - Resource ownership → checks user.id matches resource owner
```

### User Model Validation Rules

The user model enforces strict validation on permission-related fields:

- **Username**: 2-100 chars, lowercase alphanumeric with periods/underscores/hyphens only
- **Password**: Configurable complexity (min 8 chars by default)
- **Role**: Must be one of `["admin", "manager", "default"]`
- **Daily Message Limit**: Must be `null` or integer >= 1
- **Bio**: Maximum 1,000 characters

These validations prevent invalid data that could compromise the permission system.

## Role Definitions

### Admin Role

**Can Do:**
- ✅ **Full System Access**: Can see and do everything across the system
- ✅ **User Management**: 
  - Create, update, delete any users (admin, manager, or default)
  - Suspend/unsuspend users
  - Set daily message limits for users
  - Reset user passwords
- ✅ **Workspace Management**:
  - Create, view, update, and delete any workspace
  - Modify workspace settings (LLM, embeddings, vector DB, etc.)
  - Add/remove users from workspaces
- ✅ **System Settings**:
  - Modify all system settings including:
    - LLM provider and model configuration
    - Vector database settings
    - Embedding engine settings
    - System-wide agent skills
    - Custom app name and branding
    - Interface customization
    - Chat settings
    - Privacy and data settings
    - Feature flags
- ✅ **API Keys**: Create, view, and manage API keys
- ✅ **Event Logs**: View system event logs
- ✅ **Embed Chat Widgets**: Create and manage embed configurations
- ✅ **System Prompt Variables**: Manage system-wide prompt variables
- ✅ **Browser Extension**: Configure browser extension settings
- ✅ **Community Hub**: Import/export from community hub
- ✅ **Agent Flows**: Create and manage agent flows
- ✅ **MCP Servers**: Configure MCP servers
- ✅ **Extensions**: Manage system extensions
- ✅ **Documents**: Upload and manage documents system-wide
- ✅ **No Daily Message Limits**: Admins are exempt from daily message limits

**Cannot Do:**
- ❌ Cannot remove the last admin (system prevents this to avoid lockout)

### Manager Role

**Can Do:**
- ✅ **Workspace Management**:
  - View, create, and delete any workspaces
  - Modify workspace-specific settings (prompts, temperature, chat mode, etc.)
  - Add/remove users from workspaces
  - Upload documents to workspaces
- ✅ **User Management**:
  - Create, update, and invite new users
  - Can only create users with `manager` or `default` roles (cannot create admins)
  - Can only modify users with `manager` or `default` roles (cannot modify admins)
  - Set daily message limits for users
- ✅ **System Settings (Limited)**:
  - Modify interface customization settings
  - Modify branding settings
  - Modify chat settings
  - Configure browser extension settings
  - View workspace chats
  - Manage invitations
- ✅ **Workspace Access**: Can access all workspaces (not restricted to assigned workspaces)
- ✅ **Chat**: Can send chats in any workspace they have access to
- ✅ **Daily Message Limits**: Subject to daily message limits if set by admin

**Cannot Do:**
- ❌ **System Infrastructure Settings**:
  - Cannot modify LLM provider/connection settings
  - Cannot modify vector database connection settings
  - Cannot modify embedding engine settings
  - Cannot modify system-wide agent skills
  - Cannot access event logs
  - Cannot manage API keys
  - Cannot manage embed chat widgets
  - Cannot manage system prompt variables
  - Cannot access community hub
  - Cannot manage agent flows
  - Cannot configure MCP servers
  - Cannot manage extensions
- ❌ **User Management Restrictions**:
  - Cannot create or modify admin users
  - Cannot delete users (only admins can delete)
- ❌ **Workspace Restrictions**:
  - Cannot modify workspace LLM/vector DB/embedding connections (only workspace-specific settings)

### Default Role

**Can Do:**
- ✅ **Workspace Access (Limited)**:
  - Can only access workspaces they are explicitly added to by admin or manager
  - Can view workspace details for assigned workspaces
  - Can send chats in assigned workspaces (subject to daily message limits)
  - Can view chat history in assigned workspaces
- ✅ **Profile Management**:
  - Can update their own profile (username, password, profile picture, bio)
- ✅ **Workspace Threads**: Can create and manage threads in assigned workspaces
- ✅ **Chat**: Can send chat messages in assigned workspaces (if within daily limit)

**Cannot Do:**
- ❌ **Workspace Management**:
  - Cannot create workspaces
  - Cannot delete workspaces
  - Cannot modify workspace settings
  - Cannot add/remove users from workspaces
  - Cannot upload documents to workspaces
  - Cannot reorder workspaces (drag-and-drop disabled in UI)
- ❌ **System Settings**: Cannot modify any settings at all
- ❌ **User Management**: Cannot view or manage other users
- ❌ **Admin Features**: Cannot access any admin-only features:
  - No access to settings pages
  - No access to user management
  - No access to API keys
  - No access to event logs
  - No access to system configuration
- ❌ **Workspace Access**: Cannot access workspaces they are not assigned to
- ❌ **Daily Message Limits**: Subject to daily message limits set by admin/manager

## Workspace Access Rules

### How Workspace Access Works

1. **Admin & Manager**: Have access to ALL workspaces automatically
2. **Default Users**: Must be explicitly added to workspaces via the `workspace_users` relationship
3. **Workspace Assignment**: Only admins and managers can add/remove users from workspaces

### Workspace Operations by Role

| Operation | Admin | Manager | Default |
|-----------|-------|---------|---------|
| Create workspace | ✅ | ✅ | ❌ |
| Delete workspace | ✅ | ✅ | ❌ |
| View all workspaces | ✅ | ✅ | ❌ (only assigned) |
| Modify workspace settings | ✅ | ✅ (limited) | ❌ |
| Add users to workspace | ✅ | ✅ | ❌ |
| Remove users from workspace | ✅ | ✅ | ❌ |
| Upload documents | ✅ | ✅ | ❌ |
| Send chats | ✅ | ✅ | ✅ (in assigned only) |
| View chat history | ✅ | ✅ | ✅ (in assigned only) |
| Reorder workspaces (UI) | ✅ | ✅ | ❌ |

## Daily Message Limits

- **Admin**: No limits (exempt from daily message limits)
- **Manager**: Subject to limits if set by admin
- **Default**: Subject to limits if set by admin/manager

**How it works:**
- Admins/managers can set a `dailyMessageLimit` for any user (except admins)
- The limit counts successful chat messages within a 24-hour rolling window
- When a user reaches their limit, they cannot send more chats until the 24-hour window rolls over
- The limit is system-wide, not per-workspace

## API Endpoint Access

### Endpoints Requiring Admin Role
- `/admin/*` - All admin endpoints
- `/system/*` - Most system endpoints (with exceptions)
- `/v1/admin/*` - All admin API endpoints
- Agent flows, MCP servers, extensions management
- Community hub import/export
- Embed chat widget management

### Endpoints Requiring Manager or Admin Role
- `/workspace/new` - Create workspace
- `/workspace/:slug/update` - Update workspace
- `/workspace/:slug/delete` - Delete workspace
- `/document/*` - Document management
- `/system/workspace-preferences` - Workspace preferences
- Browser extension configuration

### Endpoints Accessible to All Roles (when in assigned workspace)
- `/workspace/:slug/chat` - Send chat messages
- `/workspace/:slug` - View workspace
- `/workspace/:slug/threads/*` - Thread management
- `/workspace/:slug/history` - View chat history

## Frontend Route Protection

The frontend uses route guards to enforce permissions:

- **`AdminRoute`**: Only accessible to admins (or all users in single-user mode)
- **`ManagerRoute`**: Accessible to admins and managers (or all users in single-user mode)
- **`PrivateRoute`**: Accessible to all authenticated users

### Settings Pages Access

| Page | Admin | Manager | Default |
|------|-------|---------|---------|
| General Settings | ✅ | ❌ | ❌ |
| LLM Settings | ✅ | ❌ | ❌ |
| Vector Database | ✅ | ❌ | ❌ |
| Embedding Engine | ✅ | ❌ | ❌ |
| Interface Settings | ✅ | ✅ | ❌ |
| Branding | ✅ | ✅ | ❌ |
| Chat Settings | ✅ | ✅ | ❌ |
| Users | ✅ | ✅ | ❌ |
| Invitations | ✅ | ✅ | ❌ |
| API Keys | ✅ | ❌ | ❌ |
| Event Logs | ✅ | ❌ | ❌ |
| Embed Chat Widgets | ✅ | ❌ | ❌ |
| System Prompt Variables | ✅ | ❌ | ❌ |
| Browser Extension | ✅ | ✅ | ❌ |
| Workspace Chats | ✅ | ✅ | ❌ |
| Privacy & Data | ✅ | ❌ | ❌ |
| Beta Features | ✅ | ❌ | ❌ |

## Role Hierarchy and Restrictions

### Role Assignment Rules

1. **Admins** can:
   - Create users with any role (admin, manager, default)
   - Modify users with any role
   - Change any user's role

2. **Managers** can:
   - Create users with `manager` or `default` roles only
   - Modify users with `manager` or `default` roles only
   - Cannot create or modify admin users

3. **Default users**:
   - Cannot create or modify any users

### Safety Mechanisms

- **Last Admin Protection**: The system prevents removing the last admin user to avoid lockout
- **Role Validation**: When creating/updating users, the system validates that the current user has permission to assign the requested role

## External Authentication Integration

When external authentication (e.g., Keystone Core API) is enabled:
- External users are always assigned the `default` role
- External users must be explicitly added to workspaces by admins/managers
- External users follow the same permission rules as internal default users

## Summary Table

| Capability | Admin | Manager | Default |
|------------|-------|---------|---------|
| **User Management** |
| Create users | ✅ (all roles) | ✅ (manager/default only) | ❌ |
| Modify users | ✅ (all roles) | ✅ (manager/default only) | ❌ (self only) |
| Delete users | ✅ | ❌ | ❌ |
| **Workspace Management** |
| Create workspaces | ✅ | ✅ | ❌ |
| Delete workspaces | ✅ | ✅ | ❌ |
| Modify workspace settings | ✅ | ✅ (limited) | ❌ |
| Access all workspaces | ✅ | ✅ | ❌ |
| Access assigned workspaces | ✅ | ✅ | ✅ |
| **System Settings** |
| LLM/VectorDB/Embedding config | ✅ | ❌ | ❌ |
| Interface/Branding/Chat settings | ✅ | ✅ | ❌ |
| API Keys | ✅ | ❌ | ❌ |
| Event Logs | ✅ | ❌ | ❌ |
| **Documents** |
| Upload documents | ✅ | ✅ | ❌ |
| Manage documents | ✅ | ✅ | ❌ |
| **Chat** |
| Send chats | ✅ (unlimited) | ✅ (if within limit) | ✅ (assigned only, if within limit) |
| View chat history | ✅ | ✅ | ✅ (assigned only) |
| **Daily Message Limits** |
| Subject to limits | ❌ | ✅ (if set) | ✅ (if set) |

## Notes

1. **Single-User Mode**: When multi-user mode is disabled, all permission checks are bypassed and all users have full access.

2. **Workspace Assignment**: Default users must be explicitly added to workspaces. They cannot see or access workspaces they are not assigned to.

3. **UI Restrictions**: The frontend hides UI elements based on role. For example:
   - Default users cannot see the settings button
   - Default users cannot drag-and-drop to reorder workspaces
   - Default users cannot see workspace management options

4. **API vs UI**: Some restrictions are enforced at the API level (middleware), while others are enforced at the UI level (route guards, conditional rendering).

5. **Flexible vs Strict Middleware**:
   - `flexUserRoleValid`: Only enforces permissions if multi-user mode is enabled (allows single-user mode to work)
   - `strictMultiUserRoleValid`: Always requires multi-user mode and appropriate role

