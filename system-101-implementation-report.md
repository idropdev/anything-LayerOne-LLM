# System-101: Document-Scoped Stream Chat

## Summary

Adds **per-request document scoping** to the chat API, allowing users to limit a conversation to specific documents without modifying workspace-level pinned document settings.

## Changes

### New Parameter: `documentPaths`

Optional `string[]` parameter added to all chat endpoints. When provided (and not containing `"*"`), chat uses ONLY the specified documents and skips vector search.

### Files Modified

- `server/utils/DocumentManager/index.js` - Added `docsFromPaths()` method with security validations
- `server/utils/chats/apiChatHandler.js` - Scope detection logic and audit logging
- `server/endpoints/api/workspace/index.js` - Added param to `/chat` & `/stream-chat`
- `server/endpoints/api/workspaceThread/index.js` - Added param to thread endpoints

## Endpoints Updated

- [x] `POST /v1/workspace/:slug/chat`
- [x] `POST /v1/workspace/:slug/stream-chat`
- [x] `POST /v1/workspace/:slug/thread/:threadSlug/chat`
- [x] `POST /v1/workspace/:slug/thread/:threadSlug/stream-chat`

---

## Usage Examples & Expected Results

### Example 1: Defined Scope - Single Document

```json
{
  "message": "What condition does the patient have?",
  "mode": "chat",
  "documentPaths": ["custom-documents/doc1.pdf-UUID.json"]
}
```

| Parameter | Effect |
|-----------|--------|
| `documentPaths` with 1 doc | Only that document is used |
| Vector search | **Skipped** |
| Pinned docs | **Ignored** |

**Expected Result:** Response `sources` array contains ONLY `doc1.pdf`. LLM answers based solely on that document's content.

---

### Example 2: Defined Scope - Multiple Documents

```json
{
  "message": "Compare conditions between patients",
  "mode": "chat",
  "documentPaths": [
    "custom-documents/doc1.pdf-UUID.json",
    "custom-documents/doc2.pdf-UUID.json"
  ]
}
```

**Expected Result:** Response `sources` contains both doc1 and doc2. LLM can compare information across both documents.

---

### Example 3: Full Scope - Default (No documentPaths)

```json
{
  "message": "What patients are in the system?",
  "mode": "chat"
}
```

| Behavior |
|----------|
| Pinned documents loaded first |
| Vector search runs to find relevant chunks |
| Pinned docs excluded from vector results (deduplication) |

**Expected Result:** Sources include pinned docs + semantically relevant vector search results.

---

### Example 4: Full Scope - Wildcard

```json
{
  "message": "What patients are in the system?",
  "documentPaths": ["*"]
}
```

**Expected Result:** Same as Example 3. The `"*"` wildcard explicitly triggers Full Scope.

---

### Example 5: Full Scope - Empty Array

```json
{
  "message": "What patients are in the system?",
  "documentPaths": []
}
```

**Expected Result:** Same as Example 3. Empty array treated as Full Scope.

---

### Example 6: Query Mode with documentPaths

```json
{
  "message": "What is the diagnosis?",
  "mode": "query",
  "documentPaths": ["custom-documents/doc1.pdf-UUID.json"]
}
```

**Expected Result:** Query mode works normally with the specified document. Does NOT return "insufficient context" error even if workspace has no embeddings.

---

### Example 7: Thread-Based Chat with documentPaths

```json
POST /v1/workspace/:slug/thread/:threadSlug/stream-chat

{
  "message": "What condition does the patient have?",
  "documentPaths": ["custom-documents/doc1.pdf-UUID.json"]
}
```

**Expected Result:** Same scoping behavior as workspace endpoints. Thread history is preserved while document scope is applied.

---

## Parameter Reference

| `documentPaths` Value | Scope Mode | Pinned Docs | Vector Search |
|-----------------------|------------|-------------|---------------|
| `null` / not provided | Full | ✅ Used | ✅ Runs |
| `[]` (empty array) | Full | ✅ Used | ✅ Runs |
| `["*"]` | Full | ✅ Used | ✅ Runs |
| `["doc1.json"]` | Defined | ❌ Ignored | ❌ Skipped |
| `["doc1.json", "doc2.json"]` | Defined | ❌ Ignored | ❌ Skipped |

---

## Testing

| Test | Result |
|------|--------|
| Defined scope returns only specified docs | ✅ Pass |
| Full scope (wildcard) returns pinned + vector | ✅ Pass |
| Query mode with documentPaths works | ✅ Pass |
| Thread endpoints support documentPaths | ✅ Pass |

## Security

### Security Fixes Implemented (2026-01-21)

#### 1. Path Traversal Protection
**File:** `server/utils/DocumentManager/index.js`

Prevents attackers from reading arbitrary files via `documentPaths` like `../../../etc/passwd`. Uses existing `isWithin()` and `normalizePath()` utilities from `server/utils/files/index.js`.

```javascript
const normalizedPath = normalizePath(docPath);
const filePath = path.resolve(this.documentStoragePath, normalizedPath);

if (!isWithin(this.documentStoragePath, filePath)) {
  this.log(`Security: Blocked path traversal attempt - ${docPath}`);
  continue;
}
```

#### 2. Workspace-Level Document Validation
**File:** `server/utils/DocumentManager/index.js`

Prevents cross-workspace document access. Users can only read documents that belong to their workspace.

```javascript
const workspaceDocs = await Document.where({
  workspaceId: Number(this.workspace.id),
  docpath: { in: docPaths },
});
allowedPaths = new Set(workspaceDocs.map((doc) => doc.docpath));
```

#### 3. Input Validation & DoS Protection
**File:** `server/utils/DocumentManager/index.js`

- **Type validation:** All `documentPaths` must be strings
- **DoS protection:** Maximum 100 document paths per request

```javascript
// Type validation
if (!docPaths.every((p) => typeof p === "string")) {
  this.log("Security: Invalid documentPaths - all items must be strings");
  return [];
}

// DoS protection
const MAX_DOCUMENT_PATHS = 100;
if (docPaths.length > MAX_DOCUMENT_PATHS) {
  docPaths = docPaths.slice(0, MAX_DOCUMENT_PATHS);
}
```

#### 4. Document Existence Validation
**File:** `server/utils/DocumentManager/index.js`

Validates that document files exist before attempting to read them, preventing errors and information disclosure about filesystem structure.

```javascript
if (!fs.existsSync(filePath)) {
  this.log(`Skipping document - File not found: ${docPath}`);
  continue;
}
```

#### 5. Audit Logging
**File:** `server/utils/chats/apiChatHandler.js`

All document-scoped chat access is logged to the `event_logs` table for compliance and security monitoring. This is critical for HIPAA compliance and security auditing.

**Implementation:**
- Logs are created in both `chatSync()` and `streamChat()` functions
- Logged after documents are successfully loaded (includes both requested and loaded counts)
- Uses existing `EventLogs.logEvent()` infrastructure

```javascript
await EventLogs.logEvent(
  "document_scoped_chat",
  {
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    workspaceSlug: workspace.slug,
    requestedDocumentPaths: documentPaths,
    loadedDocumentCount: scopedDocs.length,
    mode: chatMode,
    timestamp: new Date().toISOString(),
  },
  user?.id || null
);
```

**Logged Information:**
- Event type: `"document_scoped_chat"`
- Workspace: ID, name, and slug
- Document access: Requested paths and successfully loaded count
- Context: Chat mode (chat/query) and timestamp
- User: User ID (or null for system calls)

**Compliance Benefits:**
- ✅ HIPAA audit trail requirements
- ✅ Security incident investigation
- ✅ Access pattern analysis
- ✅ Compliance reporting

#### 6. Workspace Access Control
**Handled by:** Keystone via delegated JWT tokens

Workspace access control (ensuring users can only access their assigned workspaces) is enforced upstream by Keystone when creating the delegated JWT token. AnythingLLM trusts the `act.sub` claim in the token.

### Protected Endpoints

| Endpoint | Protections |
|----------|-------------|
| `POST /v1/workspace/:slug/chat` | Path traversal, document validation, type/DoS limits |
| `POST /v1/workspace/:slug/stream-chat` | Path traversal, document validation, type/DoS limits |
| `POST /v1/workspace/:slug/thread/:threadSlug/chat` | Path traversal, document validation, type/DoS limits |
| `POST /v1/workspace/:slug/thread/:threadSlug/stream-chat` | Path traversal, document validation, type/DoS limits |

### Attack Vectors Mitigated

| Attack | Status | Implementation |
|--------|--------|----------------|
| Path traversal (`../../../etc/passwd`) | ✅ Blocked | `isWithin()` + `normalizePath()` |
| Cross-workspace document access | ✅ Blocked | `Document.where()` batch validation |
| Type confusion (non-string paths) | ✅ Blocked | `typeof` check returns empty |
| DoS via large array (>100 paths) | ✅ Truncated | Limit to 100 items |
| Unauthorized workspace access | ✅ Blocked | Keystone delegated JWT |
| Missing audit trail | ✅ Logged | `EventLogs.logEvent()` for all document-scoped access |
