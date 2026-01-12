# Final Implementation Plan: OCR-Aware Enrichment (One-Time Process)

## Core Principle: Enrich Once, Use Forever

**Key Insight:** Enrichment happens **ONCE** during initial embedding. After that, hybrid search uses the already-enriched vectors stored in Zilliz. No re-processing needed.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    ONE-TIME PROCESS                         │
│              (During Initial Embedding)                     │
├─────────────────────────────────────────────────────────────┤
│  1. Document Upload (from Keystone or direct)               │
│  2. OCR Merge: user_corrected > google_raw > anything_raw   │
│  3. Build canonical pageContent                              │
│  4. Split into raw chunks                                    │
│  5. ✨ Enrich chunks (ONE TIME)                             │
│  6. Embed enriched chunks → dense vectors                   │
│  7. Store in Zilliz:                                        │
│     - vector: dense embedding (from enriched chunk)         │
│     - vector_sparse: BM25 sparse (from raw chunk)          │
│     - text: raw chunk (for BM25 retrieval)                  │
│     - metadata.text: enriched chunk (for reference)         │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    ONGOING OPERATIONS                       │
│              (No Re-processing Needed)                      │
├─────────────────────────────────────────────────────────────┤
│  Hybrid Search:                                             │
│  - Uses existing dense vectors (already enriched)           │
│  - Uses existing sparse vectors (from raw chunks)           │
│  - Combines results efficiently                             │
│  - NO enrichment step needed                                 │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Strategy

### Phase 1: Core Enrichment Module (One-Time Processing)

**File:** `server/utils/documentEnrichment.js`

**Purpose:** Handle OCR merging + chunk enrichment during embedding only.

**Key Functions:**

1. **`buildCanonicalPageContent(document)`** - Merge OCR sources once
2. **`enrichChunks(chunks, metadata, config)`** - Enrich chunks once before embedding
3. **`getEnrichmentConfig()`** - Load config from system settings

**Design Principles:**
- ✅ Fast and efficient (runs once per document)
- ✅ Minimal token overhead (compact format)
- ✅ Backward compatible (works without OCR)
- ✅ Configurable (can be disabled)

### Phase 2: Integration Point (Vector DB Providers)

**Location:** `server/utils/vectorDbProviders/zilliz/index.js` (and others)

**Flow:**
1. Load document → merge OCR → build canonical text
2. Split → enrich chunks (ONE TIME)
3. Embed enriched chunks → store vectors
4. Store raw chunks separately for BM25

**Key Point:** Enrichment happens in `addDocumentToNamespace()` - the one-time embedding function. Not in search/retrieval.

### Phase 3: Hybrid Search (No Enrichment)

**Location:** Existing search/retrieval code

**Behavior:**
- Uses already-stored vectors (already enriched)
- Uses already-stored sparse vectors (from raw chunks)
- No enrichment step needed
- Efficient hybrid search

## Detailed Implementation

### 1. Document Enrichment Module

**File:** `server/utils/documentEnrichment.js`

```javascript
/**
 * Document Enrichment Utility
 * 
 * Handles OCR merging and chunk enrichment during ONE-TIME embedding process.
 * After embedding, hybrid search uses stored vectors - no re-processing needed.
 */

const { SystemSettings } = require("../../models/systemSettings");

/**
 * Default enrichment configuration
 */
const DEFAULT_ENRICHMENT_CONFIG = {
  enabled: true,
  includeDocumentContext: true,
  includePositionInfo: true,
  includeAuthor: false, // Disabled by default to save tokens
  includeDescription: false, // Disabled by default to save tokens
  format: "minimal", // Compact format, not XML
  maxEnrichmentLength: 80, // Keep it short
};

/**
 * Get enrichment configuration from system settings
 */
async function getEnrichmentConfig() {
  const config = { ...DEFAULT_ENRICHMENT_CONFIG };
  
  try {
    config.enabled = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_enabled" },
      DEFAULT_ENRICHMENT_CONFIG.enabled
    );
    
    config.includeDocumentContext = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_include_context" },
      DEFAULT_ENRICHMENT_CONFIG.includeDocumentContext
    );
    
    config.includePositionInfo = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_include_position" },
      DEFAULT_ENRICHMENT_CONFIG.includePositionInfo
    );
    
    config.format = await SystemSettings.getValueOrFallback(
      { label: "document_enrichment_format" },
      DEFAULT_ENRICHMENT_CONFIG.format
    );
  } catch (error) {
    // Use defaults if settings unavailable
    console.warn("[Enrichment] Using default config:", error.message);
  }
  
  return config;
}

/**
 * Build canonical pageContent from OCR sources
 * Priority: user_corrected > google_raw > anything_raw > pageContent
 * 
 * This runs ONCE during document processing.
 */
function buildCanonicalPageContent(document) {
  const ocr = document.ocr || {};
  
  // Priority 1: User corrections (highest priority)
  if (ocr.user_corrected?.trim()) {
    return ocr.user_corrected.trim();
  }
  
  // Priority 2: Google OCR (from Keystone)
  const googleRaw = ocr.google_raw?.trim();
  const anythingRaw = ocr.anything_raw?.trim();
  
  if (googleRaw && !anythingRaw) return googleRaw;
  if (!googleRaw && anythingRaw) return anythingRaw;
  
  // Priority 3: Merge if both exist
  if (googleRaw && anythingRaw) {
    return mergeOcrSources(googleRaw, anythingRaw);
  }
  
  // Priority 4: Fallback to existing pageContent (backward compatibility)
  return document.pageContent || "";
}

/**
 * Merge multiple OCR sources intelligently
 * Simple merge for now - can be enhanced later with deduplication
 */
function mergeOcrSources(googleRaw, anythingRaw) {
  if (!googleRaw && !anythingRaw) return "";
  if (googleRaw && !anythingRaw) return googleRaw;
  if (!googleRaw && anythingRaw) return anythingRaw;
  
  // Simple similarity check - if very similar, prefer Google
  const similarity = calculateSimpleSimilarity(googleRaw, anythingRaw);
  if (similarity > 0.9) {
    // Very similar - use Google (higher quality)
    return googleRaw;
  }
  
  // Different enough - merge both
  // TODO: Future enhancement - deduplication, alignment, confidence scoring
  return `${googleRaw}\n\n--- Additional OCR Content ---\n\n${anythingRaw}`;
}

/**
 * Calculate simple word overlap similarity (0-1)
 * Used to determine if OCR sources are duplicates
 */
function calculateSimpleSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Build contextual information for a chunk
 */
function buildChunkContext(metadata, chunkIndex, totalChunks) {
  const context = {
    document: {},
    position: {},
  };

  // Document-level context (only if enabled)
  if (metadata?.title) {
    context.document.title = metadata.title;
  }

  // Position context
  context.position.chunkNumber = chunkIndex + 1;
  context.position.totalChunks = totalChunks;
  context.position.percentage = Math.round(((chunkIndex + 1) / totalChunks) * 100);
  
  // Relative position
  if (chunkIndex === 0) {
    context.position.relative = "start";
  } else if (chunkIndex === totalChunks - 1) {
    context.position.relative = "end";
  } else {
    const third = Math.floor(totalChunks / 3);
    if (chunkIndex < third) {
      context.position.relative = "start";
    } else if (chunkIndex >= totalChunks - third) {
      context.position.relative = "end";
    } else {
      context.position.relative = "mid";
    }
  }

  return context;
}

/**
 * Format enrichment header in minimal format
 * Kept very short to minimize token usage
 */
function formatEnrichmentHeader(context, config) {
  const parts = [];
  
  // Position info (if enabled)
  if (config.includePositionInfo) {
    parts.push(`[${context.position.chunkNumber}/${context.position.totalChunks}]`);
  }
  
  // Document context (if enabled)
  if (config.includeDocumentContext && context.document.title) {
    // Truncate title if too long
    const title = context.document.title.length > 40 
      ? context.document.title.substring(0, 40) + "..."
      : context.document.title;
    parts.push(title);
  }
  
  if (parts.length === 0) return "";
  
  // Minimal format: [2/10] Document Title\n\n[chunk text]
  return `${parts.join(" ")}\n\n`;
}

/**
 * Enrich a single chunk with contextual information
 * This runs ONCE per chunk during embedding
 */
function enrichChunk(chunk, metadata, chunkIndex, totalChunks, config) {
  if (!config.enabled) {
    return chunk; // Return unchanged if enrichment disabled
  }

  const context = buildChunkContext(metadata, chunkIndex, totalChunks);
  const header = formatEnrichmentHeader(context, config);
  
  if (!header || header.trim().length === 0) {
    return chunk; // Return unchanged if no enrichment
  }

  // Prepend minimal header to chunk
  return `${header}${chunk}`;
}

/**
 * Enrich multiple chunks with contextual information
 * This runs ONCE during document embedding
 * 
 * @param {string[]} chunks - Raw chunks from TextSplitter
 * @param {object} metadata - Document metadata
 * @param {object} config - Enrichment configuration (optional, will load if not provided)
 * @returns {Promise<string[]>} Enriched chunks
 */
async function enrichChunks(chunks, metadata, config = null) {
  // Load config if not provided
  const enrichmentConfig = config || await getEnrichmentConfig();
  
  if (!enrichmentConfig.enabled || !chunks || chunks.length === 0) {
    return chunks; // Return unchanged if disabled or empty
  }

  // Enrich each chunk (one-time process)
  return chunks.map((chunk, index) => 
    enrichChunk(chunk, metadata, index, chunks.length, enrichmentConfig)
  );
}

module.exports = {
  buildCanonicalPageContent,
  mergeOcrSources,
  enrichChunks,
  enrichChunk,
  buildChunkContext,
  formatEnrichmentHeader,
  getEnrichmentConfig,
  DEFAULT_ENRICHMENT_CONFIG,
};
```

### 2. Zilliz Integration (One-Time Enrichment)

**File:** `server/utils/vectorDbProviders/zilliz/index.js`

**Key Changes in `addDocumentToNamespace()`:**

```javascript
// Around line 224-298, modify the embedding flow:

const { buildCanonicalPageContent, enrichChunks } = require("../../documentEnrichment");

// 1. Build canonical text from OCR sources (ONE TIME)
const pageContentCanonical = buildCanonicalPageContent({
  ...documentData,
  pageContent: pageContent, // fallback if no OCR
});

// 2. Split canonical text
const textSplitter = new TextSplitter({
  chunkSize: TextSplitter.determineMaxChunkSize(
    await SystemSettings.getValueOrFallback({
      label: "text_splitter_chunk_size",
    }),
    EmbedderEngine?.embeddingMaxChunkLength
  ),
  chunkOverlap: await SystemSettings.getValueOrFallback(
    { label: "text_splitter_chunk_overlap" },
    20
  ),
  chunkHeaderMeta: TextSplitter.buildHeaderMeta(metadata),
});

const rawChunks = await textSplitter.splitText(pageContentCanonical);

console.log("Chunks created from document:", rawChunks.length);

// 3. Enrich chunks ONCE before embedding
const enrichedChunks = await enrichChunks(rawChunks, metadata);

// 4. Embed enriched chunks (ONE TIME)
const vectorValues = await EmbedderEngine.embedChunks(enrichedChunks);
const isHybridMode = EmbedderEngine?.supportsSparseVectors === true;

// 5. Store in Zilliz
if (!!vectorValues && vectorValues.length > 0) {
  for (const [i, vector] of vectorValues.entries()) {
    const denseVector = isHybridMode ? vector.dense : vector;
    const sparseVector = isHybridMode ? vector.sparse : null;

    const vectorRecord = {
      id: uuidv4(),
      values: denseVector,
      sparseValues: sparseVector,
      // Store RAW chunk in text field for BM25 (no enrichment)
      text: rawChunks[i],
      // Store enriched chunk in metadata for reference
      metadata: { 
        ...metadata, 
        text: enrichedChunks[i], // For LangChain compatibility
        text_raw: rawChunks[i], // Explicit raw text reference
      },
    };

    vectors.push(vectorRecord);
    documentVectors.push({ docId, vectorId: vectorRecord.id });
  }
}

// ... rest of storage logic remains the same ...
```

### 3. TextSplitter Header Extension (Option C)

**File:** `server/utils/TextSplitter/index.js`

**Extend `buildHeaderMeta()` to include description (minimal):**

```javascript
static buildHeaderMeta(metadata = {}) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  
  const PLUCK_MAP = {
    title: {
      as: "sourceDocument",
      pluck: (metadata) => metadata?.title || null,
    },
    published: {
      as: "published",
      pluck: (metadata) => metadata?.published || null,
    },
    chunkSource: {
      as: "source",
      pluck: (metadata) => {
        const validPrefixes = ["link://", "youtube://"];
        if (
          !metadata?.chunkSource ||
          !metadata?.chunkSource.length ||
          typeof metadata.chunkSource !== "string" ||
          !validPrefixes.some((prefix) => metadata.chunkSource.startsWith(prefix))
        )
          return null;

        let source = null;
        for (const prefix of validPrefixes) {
          source = metadata.chunkSource.split(prefix)?.[1] || null;
          if (source) break;
        }
        return source;
      },
    },
    // NEW: Add description (only if meaningful)
    description: {
      as: "description",
      pluck: (metadata) => {
        const desc = metadata?.description;
        if (!desc || 
            desc === "no description found" || 
            desc === "Unknown" ||
            desc.length < 10) return null;
        // Truncate to keep header small
        return desc.length > 80 ? desc.substring(0, 80) + "..." : desc;
      },
    },
  };

  const pluckedData = {};
  Object.entries(PLUCK_MAP).forEach(([key, value]) => {
    if (!(key in metadata)) return;
    const pluckedValue = value.pluck(metadata);
    if (!pluckedValue) return;
    pluckedData[value.as] = pluckedValue;
  });

  return pluckedData;
}
```

### 4. Hybrid Search (No Enrichment Needed)

**Existing search code uses stored vectors - no changes needed!**

The hybrid search already:
- Uses stored dense vectors (already enriched from initial embedding)
- Uses stored sparse vectors (from raw chunks)
- Combines results efficiently

**No enrichment step in search/retrieval - it's already done!**

## Efficiency Optimizations

### 1. Minimal Enrichment Format
- **Format:** `[2/10] Document Title\n\n[chunk text]`
- **Token overhead:** ~10-20 tokens per chunk
- **Total impact:** Minimal, only during embedding

### 2. One-Time Processing
- Enrichment happens **only** in `addDocumentToNamespace()`
- Not in search, not in retrieval, not in updates
- Cached vectors include enrichment (no re-processing)

### 3. Configurable Overhead
- Can disable enrichment entirely
- Can disable position info
- Can disable document context
- Minimal by default

### 4. Smart OCR Merging
- Simple similarity check prevents duplicate content
- Prefers higher quality source (Google > AnythingLLM)
- Can be enhanced later without breaking changes

## Implementation Checklist

### Phase 1: Core Module ✅
- [ ] Create `server/utils/documentEnrichment.js`
- [ ] Implement `buildCanonicalPageContent()`
- [ ] Implement `mergeOcrSources()`
- [ ] Implement `enrichChunks()`
- [ ] Implement `getEnrichmentConfig()`

### Phase 2: TextSplitter Extension ✅
- [ ] Extend `TextSplitter.buildHeaderMeta()` with description
- [ ] Test header generation

### Phase 3: Zilliz Integration ✅
- [ ] Integrate OCR merging in `addDocumentToNamespace()`
- [ ] Integrate chunk enrichment before embedding
- [ ] Store raw chunks in `text` field
- [ ] Store enriched chunks in metadata
- [ ] Test with sample documents

### Phase 4: Other Providers ✅
- [ ] Apply same pattern to other vector DB providers
- [ ] Ensure backward compatibility

### Phase 5: Testing ✅
- [ ] Test OCR merging (Google + AnythingLLM)
- [ ] Test enrichment with/without OCR
- [ ] Test backward compatibility (no OCR)
- [ ] Test hybrid search (uses stored vectors)
- [ ] Performance testing (one-time overhead)

## Success Criteria

1. ✅ **One-Time Processing**: Enrichment happens only during embedding
2. ✅ **Efficient**: Minimal token overhead (~10-20 tokens per chunk)
3. ✅ **OCR-Aware**: Merges OCR sources correctly
4. ✅ **Hybrid Search**: Uses stored enriched vectors (no re-processing)
5. ✅ **Backward Compatible**: Works without OCR, without enrichment
6. ✅ **Configurable**: Can be disabled or customized
7. ✅ **Performance**: < 5% overhead during embedding

## Key Design Decisions

### ✅ Minimal Format (Not XML)
- Saves tokens
- Easier to parse
- More efficient

### ✅ Disabled by Default (Author/Description)
- Saves tokens
- Can be enabled if needed
- Position + title provide enough context

### ✅ Raw Chunks for BM25
- Clean lexical search
- No markup pollution
- Better BM25 performance

### ✅ Enriched Chunks for Dense Embeddings
- Better semantic understanding
- Context helps embeddings
- One-time cost

### ✅ Smart OCR Merging
- Prevents duplicates
- Prefers quality sources
- Can be enhanced later

## Notes

1. **Cache Compatibility**: Vector cache includes enrichment - cached documents will have enrichment
2. **Re-embedding**: If you re-embed a document, enrichment will be re-applied (one-time cost)
3. **Search Performance**: No impact - uses stored vectors
4. **Token Limits**: Enrichment adds ~10-20 tokens - ensure chunk size accounts for this
5. **Future Enhancements**: OCR merging can be enhanced with deduplication, alignment, confidence scoring

## Summary

**This implementation:**
- ✅ Enriches chunks **ONCE** during initial embedding
- ✅ Stores enriched vectors for efficient hybrid search
- ✅ Uses minimal format to save tokens
- ✅ Merges OCR sources intelligently
- ✅ Maintains backward compatibility
- ✅ Is configurable and efficient

**After embedding:**
- Hybrid search uses stored vectors (no re-processing)
- No enrichment overhead in search/retrieval
- Efficient and fast

