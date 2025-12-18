# OCR Testing Suite Documentation

## Overview

This directory contains comprehensive integration tests for OCR (Optical Character Recognition) functionality on the `/api/v1/document/upload` endpoint.

## Test Files

### Integration Tests

**Phase 1: OCR Field Processing**
- **`integration/ocr.integration.test.js`** - Main OCR test suite (10 tests)
- **`integration/ocr.simple.test.js`** - Simple upload validation test (1 test)

**Phase 2: Embedding Integration**
- **`integration/ocr.embeddings.test.js`** - Embedding and vector search tests (4 tests)

### Test Fixtures

Located in `fixtures/`:

**Phase 1 Fixtures:**
- **`ocr-fields-valid.json`** - Valid high-confidence medical OCR fields
- **`ocr-fields-low-confidence.json`** - Low confidence OCR for edge case testing
- **`ocr-fields-invalid.json`** - Malformed OCR data for error handling
- **`sample-medical-record.txt`** - Sample medical document for uploads

**Phase 2 Fixtures** (`ocr-medical-records/`):
- **`diabetes-diagnosis.txt`** + **`diabetes-ocr.json`** - Diabetes patient record
- **`hypertension-diagnosis.txt`** + **`hypertension-ocr.json`** - Hypertension patient record
- **`asthma-diagnosis.txt`** + **`asthma-ocr.json`** - Asthma patient record

### Helper Utilities

- **`utils/ocr.helpers.js`** - OCR testing utilities and helpers
  - Phase 1: OCR field generation, validation, and document management
  - Phase 2: Workspace operations, embedding verification, vector search

## Quick Start

### 1. Setup Environment

```bash
# Copy test configuration
cp .env.test.example .env.test

# Edit .env.test with your credentials
TEST_ADMIN_USERNAME=your-admin
TEST_ADMIN_PASSWORD=your-password
JWT_SECRET=<copy-from-main-env>

# Phase 2 only: Add embedding configuration
TEST_OCR_CONFIDENCE_THRESHOLD=0.7
TEST_WORKSPACE_SLUG=test-ocr-workspace
TEST_EMBEDDING_WAIT_MS=30000
```

### 2. Create Test Workspace (Phase 2 Only)

```bash
# Create workspace via API or UI
curl -X POST http://localhost:3001/api/v1/workspace/new \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-ocr-workspace"}'
```

### 3. Start Server

```bash
# Make sure server is running in production mode
NODE_ENV=production node index.js &

# Or development mode
npm run dev
```

### 4. Run Tests

```bash
# Run Phase 1 tests only
npm run test:ocr

# Run Phase 2 tests only
npm run test:ocr:embeddings

# Run all OCR tests (Phase 1 + Phase 2)
npm run test:ocr:all

# Run with verbose output
npx jest __tests__/integration/ocr --verbose

# Run specific test
npx jest __tests__/integration/ocr.integration.test.js -t "Valid OCR fields"
```

## Test Coverage

### Authentication & Authorization ✅

- [x] Admin JWT can upload documents with OCR fields
- [x] Default user JWT can upload documents with OCR fields
- [x] API keys are rejected on `/v1/document/upload`
- [x] Invalid JWTs are properly rejected

### OCR Field Processing ✅

- [x] Valid OCR fields parsed and stored correctly
- [x] Confidence levels tracked and preserved
- [x] Malformed OCR data handled gracefully
- [x] OCR data structure validation

### Edge Cases ✅

- [x] Low confidence OCR detection and flagging
- [x] Image-based document metadata creation
- [x] Confidence statistics calculation

### Document Updates ✅

- [x] OCR structure creation
- [x] google_raw text combination
- [x] Field structuring

## Test Architecture

### Data Flow

```
Test File Upload
    ↓
Multer Middleware (saves to collector/hotdir)
    ↓
Collector API (processes document)
    ↓
Document JSON Created (storage/documents/)
    ↓
OCR Fields Added (if provided)
    ↓
Test Verification
    ↓
Automatic Cleanup
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

## Helper Functions

### `generateOcrFields(options)`

Generate test OCR fields with varying confidence levels.

```javascript
const ocrFields = generateOcrFields({
  count: 5,
  minConfidence: 0.7,
  maxConfidence: 0.95,
  type: "medical" // or "general"
});
```

### `verifyOcrStructure(documentData)`

Validate OCR data structure in document JSON.

```javascript
const validation = verifyOcrStructure(docData);
// Returns: { valid: true/false, errors: [], ocr: {...} }
```

### `calculateConfidenceStats(ocrFields)`

Calculate confidence level statistics.

```javascript
const stats = calculateConfidenceStats(ocrFields);
// Returns: { count, average, min, max, lowConfidenceCount, highConfidenceCount }
```

### `createImageBasedMetadata(ocrFields)`

Create metadata for image-based documents.

```javascript
const metadata = createImageBasedMetadata(ocrFields);
// Returns: { sourceType, requiresManualReview, averageConfidence, ... }
```

### `waitForDocument(location, maxWaitMs)`

Wait for document to be processed and available.

```javascript
const exists = await waitForDocument(docLocation, 5000);
```

### `readDocumentJson(location)`

Read and parse document JSON from storage.

```javascript
const docData = await readDocumentJson(docLocation);
```

### `cleanupTestDocuments(locations)`

Clean up test documents from storage.

```javascript
cleanupTestDocuments(uploadedDocuments);
```

## Environment Configuration

### Required Variables

```bash
# Server
TEST_SERVER_URL=http://localhost:3001

# Authentication
TEST_ADMIN_USERNAME=admin
TEST_ADMIN_PASSWORD=secret12345

# OCR Configuration
TEST_OCR_CONFIDENCE_THRESHOLD=0.7
TEST_WORKSPACE_SLUG=test-ocr-workspace

# JWT (must match main .env)
JWT_SECRET='your-jwt-secret'
```

### Prerequisites

- Server running (development or production mode)
- Collector service running on port 8888
- Admin user created
- Multi-user mode enabled

---
## Troubleshooting

### "File does not exist in upload directory"

**Cause**: Collector service not running or file upload middleware issue

**Fix**: 
1. Verify collector is running: `curl http://localhost:8888/api/v1/status`
2. Check server logs for upload errors
3. Ensure file permissions are correct

### "Document not found" / Timeout Errors

**Cause**: Document processing taking longer than expected

**Fix**: 
1. Increase `waitForDocument` timeout in tests
2. Check collector logs for processing errors
3. Verify document was created in storage directory

### Tests Pass But Documents Not Cleaned Up

**Cause**: Cleanup function not running

**Fix**: Verify `afterAll()` hook is executing and check file permissions

### Collector Not Running

**Cause**: Collector service not started

**Fix**: 
```bash
cd collector
npm run dev
```

Verify with: `curl http://localhost:8888/api/v1/status`

---
## Performance Benchmarks

Based on current test results:

| Metric | Target | Actual | Status |
|--------|--------|--------|--------|
| Avg Response Time | <100ms | 22.78ms | ✅ Excellent |
| P95 Response Time | <200ms | 35.35ms | ✅ Excellent |
| Success Rate | 100% | 100% | ✅ Perfect |
| Cleanup Success | 100% | 100% | ✅ Perfect |

## Phase 2: Embedding Integration ✅ COMPLETE

### Completed Tests

- [x] Test embedding generation with OCR text
- [x] Test vector search with OCR content  
- [x] Test workspace integration
- [x] **Test OCR embedding updates (in-place modification)**
- [x] Performance benchmarking

**Results**: 5/5 tests passing | 6 OpenAI API calls | ~$0.01 per run | ~220s total time

See **[OCR_EMBEDDING_UPDATE_TEST_REPORT.md](./OCR_EMBEDDING_UPDATE_TEST_REPORT.md)** for detailed results.

### Key Features

✅ **Fixed Wait Time for Embeddings**: Uses predictable wait time instead of unreliable polling  
✅ **Vector Search Validation**: Confirms OCR content is searchable  
✅ **OCR Update Workflow**: In-place document modification + re-embedding  
✅ **Vector Cache Management**: Automatic cache purging for fresh embeddings  
✅ **Performance Metrics**: Tracks embedding generation (35s) and search times (4.1s avg)  
✅ **Cost Efficiency**: Minimal OpenAI API usage

### OCR Update Workflow

**How to update OCR fields on an existing document:**

1. **Modify the document JSON file** with updated OCR fields
   ```javascript
   await updateDocumentJSONFile(docLocation, newOCRFields);
   ```

2. **Trigger re-embedding** by calling `/update-embeddings` with the SAME path in both arrays
   ```javascript
   await updateWorkspaceEmbeddings(
     workspaceSlug,
     [docLocation],  // adds
     [docLocation]   // deletes (same path!)
   );
   ```

3. **System processes the update:**
   - Removes document from workspace (deletes old embeddings)
   - Purges vector cache (ensures fresh embeddings)
   - Re-reads the updated JSON file
   - Generates new embeddings from updated content
   - Adds document back to workspace

4. **Result**: Updated OCR content is now searchable!

**Key Implementation Detail**: The `Document.removeDocuments()` function now calls `purgeVectorCache()` to clear cached embeddings, ensuring that re-adding the document generates fresh embeddings from the updated file.

### Design Decision: Embedding Wait Time

**Why we use a fixed wait time instead of polling:**

The workspace API does not reliably expose embedding generation status. Rather than implementing complex polling logic that may not work consistently, we use a fixed wait time based on observed embedding generation duration (30-40 seconds for a few documents).

**Benefits:**
- Simpler and more predictable
- Reduces API calls during testing
- Consistent with actual embedding generation times
- Configurable via `TEST_EMBEDDING_WAIT_MS`

## Future Enhancements (Phase 3)

### Advanced Embedding Tests

- [ ] Test confidence filtering in search results
- [ ] Test embedding metadata inspection
- [ ] Test batch OCR updates (10+ documents)
- [ ] Test concurrent OCR updates

### Performance Tests

- [ ] Large document uploads (>10MB)
- [ ] Concurrent uploads with OCR
- [ ] Stress testing (100+ documents)
- [ ] Memory usage profiling

### Real-World Tests

- [ ] Actual medical records (redacted)
- [ ] Various PDF formats
- [ ] Scanned documents
- [ ] Multi-page documents

## Contributing

When adding new OCR tests:

1. Add test fixtures to `fixtures/` directory
2. Use existing helper functions when possible
3. Track uploaded documents for cleanup
4. Add performance metrics tracking
5. Document any new edge cases found
6. Update this README with new test coverage

## Related Documentation

- **[OCR_TEST_RESULTS.md](./OCR_TEST_RESULTS.md)** - Phase 1 test results and findings
- **[OCR_PHASE2_TEST_RESULTS.md](./OCR_PHASE2_TEST_RESULTS.md)** - Phase 2 embedding integration results
- **[integration/OCR_README.md](./integration/OCR_README.md)** - Integration test specific docs
- **[EXTERNAL_AUTH_ARCHITECTURE.md](./EXTERNAL_AUTH_ARCHITECTURE.md)** - Authentication architecture

## Support

For issues or questions:

1. Check troubleshooting section above
2. Review test results documentation
3. Check server logs for errors
4. Verify environment configuration

---

**Last Updated**: December 17, 2024  
**Test Suite Version**: 2.1.0 (Phase 1 + Phase 2 with OCR Updates)  
**Status**: ✅ All Tests Passing (15/15 total: 10 Phase 1 + 5 Phase 2)
