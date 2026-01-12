# OCR-Aware Enrichment Feature Usage Guide

## Overview

The OCR-aware enrichment pipeline automatically merges OCR sources and enriches chunks during document embedding. This feature is **automatically enabled** and runs whenever documents are embedded into a workspace.

## Bug Fix Applied

✅ **Fixed cache logic bug** in `server/utils/vectorDbProviders/zilliz/index.js`:
- Changed `if (skipCache)` to `if (!skipCache)` on line 187
- Now correctly checks cache when `skipCache=false` (default behavior)
- Matches the pattern used in other vector DB providers

## How OCR Enrichment Works

The enrichment pipeline runs automatically during embedding and:

1. **Merges OCR sources** in priority order:
   - `user_corrected` (highest priority)
   - `google_raw` (from Keystone/Google OCR)
   - `anything_raw` (from AnythingLLM OCR)
   - `pageContent` (fallback)

2. **Enriches chunks** with minimal headers:
   - Position info: `[2/10]`
   - Document title (truncated to 40 chars)
   - Format: `[2/10] Document Title\n\n[chunk text]`

3. **Stores in Zilliz**:
   - `text` = raw chunk (for BM25/sparse search)
   - `metadata.text` = enriched chunk (for LangChain compatibility)
   - `metadata.text_raw` = raw chunk (explicit reference)
   - `values` = dense vector (from enriched chunk)

## Document JSON Structure

OCR data must be included in the **document JSON file** itself. Documents are stored as JSON files in `server/storage/documents/` with the following structure:

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "url": "file:///path/to/document.pdf",
  "title": "My Document",
  "docAuthor": "Author Name",
  "description": "Document description",
  "docSource": "pdf file uploaded by the user.",
  "chunkSource": "",
  "published": "1/16/2024, 3:07:00 PM",
  "wordCount": 1000,
  "pageContent": "Fallback text content if no OCR available",
  "token_count_estimate": 1200,
  "ocr": {
    "user_corrected": "User-corrected OCR text (highest priority)",
    "google_raw": "Google OCR extracted text",
    "anything_raw": "AnythingLLM OCR extracted text"
  }
}
```

### OCR Field Priority

The `buildCanonicalPageContent()` function uses this priority:

1. **`ocr.user_corrected`** - Highest priority (user corrections)
2. **`ocr.google_raw`** - Google OCR results
3. **`ocr.anything_raw`** - AnythingLLM OCR results
4. **`pageContent`** - Fallback if no OCR fields exist

If both `google_raw` and `anything_raw` exist, they are merged intelligently (similarity check to avoid duplicates).

## How to Use OCR Enrichment

### Method 1: Add OCR Data to Document JSON File

After a document is uploaded and processed, you can manually edit the JSON file to add OCR data:

1. **Locate the document JSON file**:
   ```
   server/storage/documents/custom-documents/your-document-hash.json
   ```

2. **Add OCR fields** to the JSON:
   ```json
   {
     "pageContent": "existing content",
     "ocr": {
       "user_corrected": "Your corrected OCR text here",
       "google_raw": "Google OCR text here",
       "anything_raw": "AnythingLLM OCR text here"
     }
   }
   ```

3. **Re-embed the document** to trigger enrichment:
   - Use `/workspace/:slug/update-embeddings` endpoint
   - Or delete and re-add the document to the workspace

### Method 2: Programmatically Update Document JSON

You can update the document JSON file programmatically using the file system:

```javascript
const fs = require('fs');
const path = require('path');

// Path to document JSON
const docPath = path.resolve(
  'server/storage/documents/custom-documents/your-document-hash.json'
);

// Read existing document
const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));

// Add OCR data
doc.ocr = {
  user_corrected: "Your corrected text",
  google_raw: "Google OCR text",
  anything_raw: "AnythingLLM OCR text"
};

// Write back
fs.writeFileSync(docPath, JSON.stringify(doc, null, 2), 'utf8');
```

### Method 3: Update via API (Future Enhancement)

Currently, there's no direct API endpoint to update OCR fields. You would need to:

1. Update the document JSON file (as shown above)
2. Call the update-embeddings endpoint to re-embed:
   ```bash
   POST /v1/workspace/:slug/update-embeddings
   {
     "adds": ["custom-documents/your-document-hash.json"],
     "deletes": []
   }
   ```

## Configuration

Enrichment can be configured via System Settings (stored in `system_settings` table):

- `document_enrichment_enabled` - Enable/disable enrichment (default: `true`)
- `document_enrichment_include_context` - Include document context in headers (default: `true`)
- `document_enrichment_include_position` - Include position info like `[2/10]` (default: `true`)
- `document_enrichment_format` - Format type (default: `"minimal"`)

## When Enrichment Runs

The enrichment pipeline runs automatically when:

1. ✅ **Initial document upload** - When documents are first embedded
2. ✅ **Manual embedding updates** - Via `/workspace/:slug/update-embeddings` endpoint
3. ✅ **Watched document re-syncs** - Background job updates watched documents
4. ❌ **Cached embeddings** - Bypassed if cached vectors exist (unless `skipCache=true`)

## Example: Complete Workflow

1. **Upload document** via API:
   ```bash
   POST /v1/document/upload
   Content-Type: multipart/form-data
   
   file: document.pdf
   addToWorkspaces: my-workspace
   ```

2. **Document is processed** and JSON file created at:
   ```
   server/storage/documents/custom-documents/document.pdf-{hash}.json
   ```

3. **Add OCR data** to the JSON file:
   ```json
   {
     "pageContent": "original text",
     "ocr": {
       "google_raw": "Google OCR extracted text here..."
     }
   }
   ```

4. **Re-embed document** to trigger enrichment:
   ```bash
   POST /v1/workspace/my-workspace/update-embeddings
   {
     "adds": ["custom-documents/document.pdf-{hash}.json"],
     "deletes": []
   }
   ```

5. **Enrichment runs automatically**:
   - OCR sources merged (google_raw used)
   - Chunks enriched with headers
   - Vectors stored with both raw and enriched text

## Notes

- **No API payload field**: OCR data is **not** passed as an API parameter. It must be in the document JSON file.
- **One-time process**: Enrichment happens during embedding, not at query time.
- **Backward compatible**: Documents without OCR fields work normally (uses `pageContent`).
- **Cache behavior**: Cached embeddings bypass enrichment. Delete cache or use `skipCache=true` to force re-enrichment.





































