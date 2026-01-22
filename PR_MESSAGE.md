# Document Enrichment Pipeline Enhancement

## Overview
This PR introduces an enhanced document processing pipeline that improves embedding quality through contextual enrichment and external OCR integration capabilities.

## Key Features

### Document Enrichment
- Implements a one-time enrichment process that adds contextual metadata to document chunks during embedding
- Enriches chunks with position information and document context to improve retrieval accuracy
- Configurable enrichment settings via system configuration

### External OCR Integration
- Adds API support for ingesting OCR data from external sources
- Supports structured OCR field data with flexible field mapping
- Maintains backward compatibility with existing document processing workflows

### Enhanced Error Handling
- Improves error handling and validation throughout the vectorization pipeline
- Adds comprehensive error logging for better debugging
- Fixes cache logic bug in Zilliz provider

### TextSplitter Enhancements
- Extends metadata support to include additional document fields
- Maintains existing functionality while adding new capabilities

## Technical Details

### New Modules
- `server/utils/documentEnrichment.js` - Core enrichment logic
- `server/utils/ocrFieldParser.js` - OCR field parsing utilities

### Modified Components
- Document upload endpoints now accept external OCR data
- Zilliz vector provider enhanced with enrichment pipeline integration
- TextSplitter extended with additional metadata fields
- Improved error handling across document processing flow

## API Changes
- `POST /v1/document/upload` and `POST /v1/document/upload/:folderName` now accept optional `externalOCRFields` parameter

## Testing
- Verified with existing document processing workflows
- Tested error handling and edge cases
- Validated backward compatibility

## Notes
- This enhancement is designed to work seamlessly with existing document processing
- No breaking changes to existing APIs
- Enrichment can be configured or disabled via system settings



































