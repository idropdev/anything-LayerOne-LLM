# OCR Integration Tests

## Overview

Comprehensive test suite for OCR functionality on the `/api/v1/document/upload` endpoint. Tests verify OCR field processing from multiple sources (Google Document AI, Google Vision API, user edits), storage, confidence tracking, entity merging, and edge case handling.

## OCR Field Format (Updated)

The API now supports three separate OCR field types:

### 1. `documentFields` - Google Document AI Output

JSON string containing Document AI OCR output:

```json
{
  "text": "Patient Name: John Anderson...",
  "entities": [
    {
      "type": "patient_name",
      "mentionText": "John Anderson",
      "confidence": 0.94,
      "startOffset": 14,
      "endOffset": 27
    }
  ],
  "outputRef": "doc-ref-123",
  "pageCount": 1,
  "confidence": 0.93,
  "fullResponse": { /* Complete Document AI response */ }
}
```

### 2. `visionFields` - Google Vision API Output

JSON string containing Vision API OCR output (same structure as documentFields):

```json
{
  "text": "Patient Name: John Anderson...",
  "entities": [
    {
      "type": "patient_name",
      "mentionText": "John Anderson",
      "confidence": 0.92,
      "startOffset": 14,
      "endOffset": 27
    }
  ],
  "outputRef": "vision-ref-456",
  "pageCount": 1,
  "confidence": 0.91,
  "fullResponse": {
    "fullTextAnnotation": { /* Complete Vision API response */ }
  }
}
```

### 3. `userEditField` - User-Corrected OCR Data

JSON string with user corrections (same structure, highest priority):

```json
{
  "text": "Patient Name: John Anderson (corrected)...",
  "entities": [
    {
      "type": "patient_name",
      "mentionText": "John Anderson",
      "confidence": 0.99,
      "startOffset": 14,
      "endOffset": 27
    }
  ],
  "outputRef": "user-edit-789",
  "pageCount": 1,
  "confidence": 0.99
}
```

## Merging Priority

When multiple OCR sources are provided:

1. **`userEditField`** - Highest priority (user corrections always win)
2. **`documentFields`** - Second priority (Document AI preferred over Vision)
3. **`visionFields`** - Lowest priority (used if not in document or userEdit)

Entities are merged and deduplicated. Higher confidence values indicate better quality.

## What Gets Tested

### ✅ Authentication & Authorization
- Admin JWT can upload documents with OCR fields
- API keys are rejected on `/v1/document/upload` (JWT-only endpoint)
- Invalid tokens are properly rejected

### ✅ OCR Field Processing
- Valid OCR fields are parsed and stored correctly
- Confidence levels are tracked and preserved
- Malformed OCR data is handled gracefully
- OCR data structure validation

### ✅ Edge Cases
- Low confidence OCR detection and flagging
- Image-based document marking for benchmarking
- Confidence statistics calculation

### ✅ Performance Metrics
- Response times (avg, min, max, P50, P95, P99)
- Success rates
- Error tracking

## Setup

### 1. Copy Test Configuration

```bash
cp .env.test.example .env.test
```

### 2. Fill in Credentials

Edit `.env.test`:

```bash
# REQUIRED: Admin credentials
TEST_ADMIN_USERNAME=your-admin-username
TEST_ADMIN_PASSWORD=your-admin-password

# OPTIONAL: OCR configuration
TEST_OCR_CONFIDENCE_THRESHOLD=0.7
TEST_WORKSPACE_SLUG=test-ocr-workspace
```

### 3. Start Server

```bash
npm run dev
```

### 4. Run Tests

```bash
# Run OCR integration tests
npm run test:ocr

# Or run with Jest directly
npx jest __tests__/integration/ocr.integration.test.js --verbose
```

## Test Structure

### Test Fixtures

Located in `__tests__/fixtures/ocr-medical-records/`:

- `diabetes-document-output.json` - Google Document AI OCR output
- `diabetes-vision-output.json` - Google Vision API OCR output  
- `diabetes-diagnosis.txt` - Sample document for upload testing
- `sample-medical-record.txt` - Simple test document

### Helper Utilities

Located in `__tests__/utils/ocr.helpers.js`:

- `generateOcrFields()` - Generate test OCR fields (legacy format)
- `verifyOcrStructure()` - Validate OCR data structure in document JSON
- `calculateConfidenceStats()` - Calculate confidence level statistics
- `createImageBasedMetadata()` - Create metadata for image-based documents
- `waitForDocument()` - Wait for document processing to complete
- `readDocumentJson()` - Read and parse document JSON from storage
- `cleanupTestDocuments()` - Clean up test documents after tests
- `updateDocumentJSONFile()` - Update document with new OCR (supports both old and new formats)

## Test Flow

### Phase 1: Authentication
1. Login with admin credentials → receive JWT
2. Attempt upload with API key → verify rejection
3. Attempt upload with invalid JWT → verify rejection

### Phase 2: OCR Field Processing
4. Upload document with valid OCR fields
5. Verify OCR data stored correctly in document JSON
6. Verify confidence levels preserved
7. Test malformed OCR data handling

### Phase 3: Edge Cases
8. Upload with low confidence OCR fields
9. Verify low confidence flagging
10. Test image-based document metadata creation

### Phase 4: Document Updates
11. Upload document with OCR fields
12. Verify complete OCR structure created
13. Verify google_raw contains combined text

## Expected Output

```
OCR Integration Tests

  Authentication & Authorization
    ✓ Admin JWT can upload document with OCR fields (250ms)
    ✓ API key should be REJECTED on /v1/document/upload (35ms)
    ✓ Invalid JWT should be rejected (25ms)

  OCR Field Processing
    ✓ Valid OCR fields are parsed and stored correctly (180ms)
    ✓ Confidence levels are tracked correctly (150ms)
    ✓ Malformed OCR data is handled gracefully (140ms)

  Edge Cases - Image-Based PDFs
    ✓ Low confidence OCR is flagged appropriately (160ms)
    ✓ Image-based documents can be marked for benchmarking (145ms)

  OCR with Document Updates
    ✓ Document upload with OCR creates proper structure (170ms)

================================================================================
📊 OCR PERFORMANCE METRICS
================================================================================
Total Requests:    9
Success Rate:      100.00% (9/9)
Avg Response Time: 150.56ms
Min Response Time: 25.00ms
Max Response Time: 250.00ms
P50 (Median):      150.00ms
P95:               250.00ms
P99:               250.00ms
================================================================================
```

## What's Tested

These tests verify:
- ✅ OCR field parsing and storage
- ✅ Confidence level tracking
- ✅ Authentication boundaries (JWT only, no API keys)
- ✅ Error handling for malformed data
- ✅ Low confidence detection
- ✅ Image-based document marking
- ✅ Performance metrics

## What's NOT Tested

These tests do NOT:
- Test actual OCR extraction (that's Keystone's responsibility)
- Test embedding generation (requires embedding provider setup)
- Test workspace integration (requires workspace setup)
- Modify existing documents (read-only where possible)

## Troubleshooting

### Tests Fail with 401 Errors
- Check that your admin credentials in `.env.test` are correct
- Verify the server is running on the correct URL
- Ensure multi-user mode is enabled

### Document Not Found Errors
- Verify the collector service is running
- Check that `STORAGE_DIR` is configured correctly
- Ensure sufficient disk space for document storage

### Server Connection Errors
- Verify server is running: `npm run dev`
- Check `TEST_SERVER_URL` in `.env.test` matches your server

## Architecture Notes

### OCR Data Flow

```
External Client (Keystone/User)
    ↓
  Performs OCR on PDF
    ↓
  POST /api/v1/document/upload
    - file: <PDF>
    - externalOCRFields: <JSON array>
    ↓
AnythingLLM
    ↓
  Stores OCR fields in document JSON
  Creates embeddings with OCR text
```

### OCR Data Structure

```json
{
  "ocr": {
    "google_raw": "Combined text from all OCR fields",
    "fields": {
      "patient_name": "Jane Smith",
      "diagnosis": "Type 2 Diabetes"
    },
    "rawFields": [
      {
        "fieldKey": "patient_name",
        "fieldValue": "Jane Smith",
        "fieldType": "string",
        "confidence": 0.95
      }
    ]
  }
}
```

## Next Steps

After tests pass:
1. Review performance metrics
2. Test with real medical documents (redacted/test data)
3. Integrate with workspace embedding tests
4. Document results in test report
