# Implementation Plan: Chunk-Level Document Enrichment (Option 2)

## Overview

Implement chunk-level text enrichment that adds contextual information to each text chunk after splitting but before embedding. This improves embedding quality by providing chunk-specific context (section titles, position, surrounding context) that helps the embedding model better understand each chunk's role and meaning.

## Goals

1. **Enrich each chunk** with contextual information before embedding
2. **Maintain backward compatibility** - existing documents work without re-embedding
3. **Centralized enrichment logic** - reusable across all vector DB providers
4. **Configurable** - can be enabled/disabled and customized
5. **Performance conscious** - minimal overhead to embedding process

## Architecture

```
Document Processing Flow:
1. Load document (pageContent + metadata)
2. Split pageContent into chunks (existing TextSplitter)
3. ✨ NEW: Enrich each chunk with contextual information
4. Embed enriched chunks
5. Store vectors with metadata
```

## Implementation Steps

### Phase 1: Create Enrichment Utility Module

**File:** `server/utils/documentEnrichment.js`

**Purpose:** Centralized chunk enrichment logic

**Functions to Implement:**

1. `enrichChunk(chunk, metadata, chunkIndex, totalChunks, options)`
   - Main enrichment function
   - Takes a single chunk and enriches it with context
   - Returns enriched chunk text

2. `enrichChunks(chunks, metadata, options)`
   - Batch enrichment function
   - Processes all chunks with their context
   - Returns array of enriched chunks

3. `buildChunkContext(metadata, chunkIndex, totalChunks)`
   - Builds contextual information for a chunk
   - Returns context object with:
     - Position info (e.g., "Part 2 of 5")
     - Document-level context (title, author, description)
     - Chunk-specific metadata

4. `formatEnrichmentHeader(context, options)`
   - Formats enrichment as header text
   - Configurable format (XML tags, plain text, etc.)

**Enrichment Fields to Include:**

- **Document Context:**
  - Title (if not already in header)
  - Author (if available)
  - Description (if available and meaningful)
  - Category/Type (if available)
  - Tags/Keywords (if available)

- **Chunk Position:**
  - Chunk number (e.g., "Chunk 2 of 10")
  - Relative position (e.g., "Beginning", "Middle", "End")
  - Percentage through document

- **Section Context (Future Enhancement):**
  - Section title/heading (if we can detect it)
  - Previous section summary
  - Next section preview

**Configuration Options:**
- `enabled`: boolean - Enable/disable enrichment
- `includeDocumentContext`: boolean - Include doc-level info
- `includePositionInfo`: boolean - Include chunk position
- `includeAuthor`: boolean - Include author info
- `includeDescription`: boolean - Include description
- `format`: string - "xml" | "plain" | "minimal"
- `maxEnrichmentLength`: number - Limit enrichment text length

### Phase 2: Integrate into TextSplitter (Optional Enhancement)

**File:** `server/utils/TextSplitter/index.js`

**Changes:**
- Add optional `enrichmentConfig` parameter to constructor
- Store enrichment config for later use
- OR: Keep enrichment separate (recommended for now)

**Decision:** Keep enrichment separate from TextSplitter to maintain separation of concerns. TextSplitter handles splitting, enrichment module handles enrichment.

### Phase 3: Integrate into Vector DB Providers

**Files to Modify:**
- `server/utils/vectorDbProviders/pinecone/index.js`
- `server/utils/vectorDbProviders/qdrant/index.js`
- `server/utils/vectorDbProviders/chroma/index.js`
- `server/utils/vectorDbProviders/weaviate/index.js`
- `server/utils/vectorDbProviders/zilliz/index.js`
- `server/utils/vectorDbProviders/milvus/index.js`
- `server/utils/vectorDbProviders/pgvector/index.js`
- `server/utils/vectorDbProviders/lance/index.js`
- `server/utils/vectorDbProviders/astra/index.js`

**Integration Point:**
After `textSplitter.splitText(pageContent)` and before `EmbedderEngine.embedChunks(textChunks)`

**Pattern:**
```javascript
const textChunks = await textSplitter.splitText(pageContent);

// ✨ NEW: Enrich chunks
const { enrichChunks } = require("../../documentEnrichment");
const enrichmentOptions = await getEnrichmentOptions(); // From system settings
const enrichedChunks = enrichChunks(textChunks, metadata, enrichmentOptions);

const vectorValues = await EmbedderEngine.embedChunks(enrichedChunks);
```

**Location in Code:**
Each provider's `addDocumentToNamespace` method, around line 150-160 (varies by provider)

### Phase 4: Add System Settings

**File:** `server/models/systemSettings.js` (if settings are stored here)

**Settings to Add:**
- `document_enrichment_enabled` (default: `true`)
- `document_enrichment_include_author` (default: `true`)
- `document_enrichment_include_description` (default: `true`)
- `document_enrichment_include_position` (default: `true`)
- `document_enrichment_format` (default: `"xml"`)
- `document_enrichment_max_length` (default: `200`)

**Alternative:** Use environment variables or config file

### Phase 5: Update Document Metadata Structure (Optional)

**Files:**
- `collector/processRawText/index.js`
- `collector/processSingleFile/convert/*.js`

**Purpose:** Ensure metadata includes fields that can be used for enrichment:
- `category` - Document category/type
- `tags` - Array of tags/keywords
- `summary` - Brief document summary (if available)

**Note:** This is optional - enrichment should work with existing metadata fields too.

## Detailed Implementation

### Step 1: Create `server/utils/documentEnrichment.js`

```javascript
/**
 * Document Chunk Enrichment Utility
 * 
 * Enriches text chunks with contextual information before embedding
 * to improve embedding quality and semantic understanding.
 */

const { SystemSettings } = require("../../models/systemSettings");

/**
 * Default enrichment configuration
 */
const DEFAULT_ENRICHMENT_CONFIG = {
  enabled: true,
  includeDocumentContext: true,
  includePositionInfo: true,
  includeAuthor: true,
  includeDescription: true,
  includeCategory: true,
  includeTags: true,
  format: "xml", // "xml" | "plain" | "minimal"
  maxEnrichmentLength: 200,
};

/**
 * Get enrichment configuration from system settings
 */
async function getEnrichmentConfig() {
  const config = { ...DEFAULT_ENRICHMENT_CONFIG };
  
  // Load from system settings if available
  // TODO: Implement system settings loading
  
  return config;
}

/**
 * Build contextual information for a chunk
 */
function buildChunkContext(metadata, chunkIndex, totalChunks) {
  const context = {
    document: {},
    position: {},
  };

  // Document-level context
  if (metadata?.title) {
    context.document.title = metadata.title;
  }
  if (metadata?.docAuthor && metadata.docAuthor !== "no author specified") {
    context.document.author = metadata.docAuthor;
  }
  if (metadata?.description && metadata.description !== "no description found") {
    context.document.description = metadata.description;
  }
  if (metadata?.category) {
    context.document.category = metadata.category;
  }
  if (metadata?.tags && Array.isArray(metadata.tags)) {
    context.document.tags = metadata.tags;
  }

  // Position context
  context.position.chunkNumber = chunkIndex + 1;
  context.position.totalChunks = totalChunks;
  context.position.percentage = Math.round(((chunkIndex + 1) / totalChunks) * 100);
  
  // Relative position
  if (chunkIndex === 0) {
    context.position.relative = "beginning";
  } else if (chunkIndex === totalChunks - 1) {
    context.position.relative = "end";
  } else {
    const third = Math.floor(totalChunks / 3);
    if (chunkIndex < third) {
      context.position.relative = "beginning";
    } else if (chunkIndex >= totalChunks - third) {
      context.position.relative = "end";
    } else {
      context.position.relative = "middle";
    }
  }

  return context;
}

/**
 * Format enrichment header based on format type
 */
function formatEnrichmentHeader(context, config) {
  if (config.format === "xml") {
    return formatXMLHeader(context, config);
  } else if (config.format === "plain") {
    return formatPlainHeader(context, config);
  } else {
    return formatMinimalHeader(context, config);
  }
}

function formatXMLHeader(context, config) {
  const parts = [];
  
  parts.push("<chunk_context>");
  
  if (config.includePositionInfo) {
    parts.push(`  <position>Chunk ${context.position.chunkNumber} of ${context.position.totalChunks} (${context.position.percentage}% through document, ${context.position.relative} section)</position>`);
  }
  
  if (config.includeDocumentContext) {
    if (context.document.title) {
      parts.push(`  <document_title>${context.document.title}</document_title>`);
    }
    if (config.includeAuthor && context.document.author) {
      parts.push(`  <author>${context.document.author}</author>`);
    }
    if (config.includeDescription && context.document.description) {
      // Truncate description if too long
      let desc = context.document.description;
      if (desc.length > config.maxEnrichmentLength) {
        desc = desc.substring(0, config.maxEnrichmentLength) + "...";
      }
      parts.push(`  <description>${desc}</description>`);
    }
    if (config.includeCategory && context.document.category) {
      parts.push(`  <category>${context.document.category}</category>`);
    }
    if (config.includeTags && context.document.tags?.length > 0) {
      parts.push(`  <tags>${context.document.tags.join(", ")}</tags>`);
    }
  }
  
  parts.push("</chunk_context>");
  
  return parts.join("\n");
}

function formatPlainHeader(context, config) {
  const parts = [];
  
  if (config.includePositionInfo) {
    parts.push(`[Chunk ${context.position.chunkNumber} of ${context.position.totalChunks}]`);
  }
  
  if (config.includeDocumentContext) {
    if (context.document.title) {
      parts.push(`Document: ${context.document.title}`);
    }
    if (config.includeAuthor && context.document.author) {
      parts.push(`Author: ${context.document.author}`);
    }
    if (config.includeDescription && context.document.description) {
      let desc = context.document.description;
      if (desc.length > config.maxEnrichmentLength) {
        desc = desc.substring(0, config.maxEnrichmentLength) + "...";
      }
      parts.push(`Description: ${desc}`);
    }
  }
  
  return parts.join(" | ");
}

function formatMinimalHeader(context, config) {
  const parts = [];
  
  if (config.includePositionInfo) {
    parts.push(`[${context.position.chunkNumber}/${context.position.totalChunks}]`);
  }
  
  if (config.includeDocumentContext && context.document.title) {
    parts.push(context.document.title);
  }
  
  return parts.join(" - ");
}

/**
 * Enrich a single chunk with contextual information
 */
function enrichChunk(chunk, metadata, chunkIndex, totalChunks, config = {}) {
  const finalConfig = { ...DEFAULT_ENRICHMENT_CONFIG, ...config };
  
  if (!finalConfig.enabled) {
    return chunk; // Return unchanged if enrichment disabled
  }

  const context = buildChunkContext(metadata, chunkIndex, totalChunks);
  const header = formatEnrichmentHeader(context, finalConfig);
  
  if (!header || header.trim().length === 0) {
    return chunk; // Return unchanged if no enrichment
  }

  return `${header}\n\n${chunk}`;
}

/**
 * Enrich multiple chunks with contextual information
 */
async function enrichChunks(chunks, metadata, config = {}) {
  const finalConfig = config.enabled !== undefined 
    ? { ...DEFAULT_ENRICHMENT_CONFIG, ...config }
    : await getEnrichmentConfig();
  
  if (!finalConfig.enabled || !chunks || chunks.length === 0) {
    return chunks; // Return unchanged if disabled or empty
  }

  return chunks.map((chunk, index) => 
    enrichChunk(chunk, metadata, index, chunks.length, finalConfig)
  );
}

module.exports = {
  enrichChunk,
  enrichChunks,
  buildChunkContext,
  formatEnrichmentHeader,
  DEFAULT_ENRICHMENT_CONFIG,
};
```

### Step 2: Integrate into Vector DB Providers

**Example for Pinecone** (`server/utils/vectorDbProviders/pinecone/index.js`):

**Find this section (around line 151):**
```javascript
const textChunks = await textSplitter.splitText(pageContent);

console.log("Chunks created from document:", textChunks.length);
const documentVectors = [];
const vectors = [];
const vectorValues = await EmbedderEngine.embedChunks(textChunks);
```

**Replace with:**
```javascript
const textChunks = await textSplitter.splitText(pageContent);

console.log("Chunks created from document:", textChunks.length);

// Enrich chunks with contextual information
const { enrichChunks } = require("../../documentEnrichment");
const enrichedChunks = await enrichChunks(textChunks, metadata);

const documentVectors = [];
const vectors = [];
const vectorValues = await EmbedderEngine.embedChunks(enrichedChunks);
```

**Repeat for all other vector DB providers** in the same location.

### Step 3: Add System Settings Integration (Optional)

**File:** `server/utils/documentEnrichment.js`

**Update `getEnrichmentConfig()` function:**
```javascript
async function getEnrichmentConfig() {
  const config = { ...DEFAULT_ENRICHMENT_CONFIG };
  
  try {
    const SystemSettings = require("../../models/systemSettings");
    
    config.enabled = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_enabled" },
      DEFAULT_ENRICHMENT_CONFIG.enabled
    );
    
    config.includeAuthor = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_include_author" },
      DEFAULT_ENRICHMENT_CONFIG.includeAuthor
    );
    
    config.includeDescription = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_include_description" },
      DEFAULT_ENRICHMENT_CONFIG.includeDescription
    );
    
    config.includePositionInfo = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_include_position" },
      DEFAULT_ENRICHMENT_CONFIG.includePositionInfo
    );
    
    config.format = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_format" },
      DEFAULT_ENRICHMENT_CONFIG.format
    );
    
    config.maxEnrichmentLength = Number(
      await SystemSettings.getValueOrFallback(
        { label: "document_enrichment_max_length" },
        DEFAULT_ENRICHMENT_CONFIG.maxEnrichmentLength
      )
    );
  } catch (error) {
    console.warn("Could not load enrichment config from system settings, using defaults:", error.message);
  }
  
  return config;
}
```

## Testing Plan

### Unit Tests
1. **Test `enrichChunk()` function:**
   - Test with various metadata combinations
   - Test with disabled enrichment
   - Test with different formats (XML, plain, minimal)
   - Test position calculations (beginning, middle, end)

2. **Test `enrichChunks()` function:**
   - Test with empty chunks array
   - Test with single chunk
   - Test with multiple chunks
   - Test with missing metadata fields

3. **Test `buildChunkContext()` function:**
   - Test position calculations
   - Test relative position detection
   - Test with minimal metadata

### Integration Tests
1. **Test with actual document embedding:**
   - Embed a test document with enrichment enabled
   - Verify chunks are enriched correctly
   - Verify embeddings are created successfully
   - Compare embedding quality (optional - manual review)

2. **Test across all vector DB providers:**
   - Verify enrichment works with Pinecone
   - Verify enrichment works with QDrant
   - Verify enrichment works with Chroma
   - (Test all providers)

3. **Test backward compatibility:**
   - Verify existing documents still embed correctly
   - Verify enrichment doesn't break when disabled

### Performance Tests
1. **Measure enrichment overhead:**
   - Time enrichment process
   - Compare with/without enrichment
   - Ensure overhead is minimal (< 5% of embedding time)

## Rollout Strategy

### Phase 1: Development & Testing
- ✅ Create enrichment utility module
- ✅ Integrate into one vector DB provider (Pinecone as test)
- ✅ Unit tests
- ✅ Manual testing with sample documents

### Phase 2: Full Integration
- ✅ Integrate into all vector DB providers
- ✅ Integration tests
- ✅ Performance validation

### Phase 3: System Settings (Optional)
- ✅ Add system settings for configuration
- ✅ Add UI controls (if needed)
- ✅ Documentation

### Phase 4: Production Deployment
- ✅ Deploy with enrichment **disabled by default** (or minimal config)
- ✅ Monitor embedding quality and performance
- ✅ Gradually enable for new documents
- ✅ Consider re-embedding existing documents (optional, expensive)

## Configuration Options

### Recommended Default Configuration
```javascript
{
  enabled: true,                    // Enable enrichment
  includeDocumentContext: true,      // Include doc-level info
  includePositionInfo: true,         // Include chunk position
  includeAuthor: true,               // Include author
  includeDescription: true,          // Include description
  includeCategory: true,             // Include category (if available)
  includeTags: true,                // Include tags (if available)
  format: "xml",                     // XML format (structured)
  maxEnrichmentLength: 200,         // Max description length
}
```

### Minimal Configuration (Less overhead)
```javascript
{
  enabled: true,
  includeDocumentContext: true,
  includePositionInfo: true,
  includeAuthor: false,
  includeDescription: false,
  includeCategory: false,
  includeTags: false,
  format: "minimal",
  maxEnrichmentLength: 100,
}
```

## Future Enhancements

1. **Section Detection:**
   - Detect section headings in chunks
   - Add section title to enrichment
   - Add previous/next section context

2. **Semantic Enrichment:**
   - Use LLM to generate chunk summaries
   - Add key concepts extracted from chunk
   - Add related topics

3. **Custom Enrichment Hooks:**
   - Allow plugins/extensions to add custom enrichment
   - Support workspace-specific enrichment rules

4. **Enrichment Analytics:**
   - Track which enrichments improve search quality
   - A/B testing different enrichment strategies

## Files Summary

### New Files:
- `server/utils/documentEnrichment.js` - Main enrichment module

### Modified Files:
- `server/utils/vectorDbProviders/pinecone/index.js`
- `server/utils/vectorDbProviders/qdrant/index.js`
- `server/utils/vectorDbProviders/chroma/index.js`
- `server/utils/vectorDbProviders/weaviate/index.js`
- `server/utils/vectorDbProviders/zilliz/index.js`
- `server/utils/vectorDbProviders/milvus/index.js`
- `server/utils/vectorDbProviders/pgvector/index.js`
- `server/utils/vectorDbProviders/lance/index.js`
- `server/utils/vectorDbProviders/astra/index.js`

### Optional Files:
- `server/models/systemSettings.js` - Add enrichment settings (if using system settings)

## Success Criteria

1. ✅ Chunks are enriched with contextual information before embedding
2. ✅ Enrichment is configurable and can be disabled
3. ✅ All vector DB providers support enrichment
4. ✅ Backward compatible - existing documents work without changes
5. ✅ Performance impact is minimal (< 5% overhead)
6. ✅ Code is maintainable and follows existing patterns
7. ✅ Enrichment improves embedding quality (verified through testing)

## Notes

- **Token Limits:** Be mindful that enrichment adds tokens. Ensure chunk size accounts for enrichment text.
- **Backward Compatibility:** Existing documents will work fine. Only new documents will have enrichment.
- **Re-embedding:** If you want existing documents enriched, they need to be re-embedded (expensive operation).
- **Testing:** Start with one provider (Pinecone), validate, then roll out to others.

