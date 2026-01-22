# Document Embedding Enrichment Analysis

## Current Embedding Flow

### 1. Document Processing & Storage
Documents are processed and stored as JSON files in `server/storage/documents/` with the following structure:

```json
{
  "id": "uuid",
  "url": "file:// or web://",
  "title": "document title",
  "docAuthor": "author name",
  "description": "document description",
  "docSource": "source description",
  "chunkSource": "link:// or youtube://",
  "published": "ISO date string",
  "wordCount": 1234,
  "pageContent": "the actual text content to embed",
  "token_count_estimate": 5678
}
```

**Key Files:**
- `collector/processRawText/index.js` - Creates document structure
- `collector/processSingleFile/convert/*.js` - Converts various file types
- `server/utils/files/index.js` - Handles document file operations

### 2. Text Splitting & Header Metadata
The `TextSplitter` class (`server/utils/TextSplitter/index.js`) handles chunking:

**Current Behavior:**
- Splits `pageContent` into chunks based on `chunkSize` and `chunkOverlap`
- Optionally prepends metadata headers to each chunk via `chunkHeaderMeta`
- Currently supports: `title` (as `sourceDocument`), `published`, and `chunkSource` (as `source`)

**Header Format:**
```xml
<document_metadata>
sourceDocument: document-title
published: 2024-01-01
source: https://example.com
</document_metadata>

[actual chunk text here]
```

**Key Code Location:**
```70:124:server/utils/TextSplitter/index.js
  static buildHeaderMeta(metadata = {}) {
    if (!metadata || Object.keys(metadata).length === 0) return null;
    const PLUCK_MAP = {
      title: {
        as: "sourceDocument",
        pluck: (metadata) => {
          return metadata?.title || null;
        },
      },
      published: {
        as: "published",
        pluck: (metadata) => {
          return metadata?.published || null;
        },
      },
      chunkSource: {
        as: "source",
        pluck: (metadata) => {
          const validPrefixes = ["link://", "youtube://"];
          // If the chunkSource is a link or youtube link, we can add the URL
          // as its source in the metadata so the LLM can use it for context.
          // eg prompt: Where did you get this information? -> answer: "from https://example.com"
          if (
            !metadata?.chunkSource || // Exists
            !metadata?.chunkSource.length || // Is not empty
            typeof metadata.chunkSource !== "string" || // Is a string
            !validPrefixes.some(
              (prefix) => metadata.chunkSource.startsWith(prefix) // Has a valid prefix we respect
            )
          )
            return null;

          // We know a prefix is present, so we can split on it and return the rest.
          // If nothing is found, return null and it will not be added to the metadata.
          let source = null;
          for (const prefix of validPrefixes) {
            source = metadata.chunkSource.split(prefix)?.[1] || null;
            if (source) break;
          }

          return source;
        },
      },
    };

    const pluckedData = {};
    Object.entries(PLUCK_MAP).forEach(([key, value]) => {
      if (!(key in metadata)) return; // Skip if the metadata key is not present.
      const pluckedValue = value.pluck(metadata);
      if (!pluckedValue) return; // Skip if the plucked value is null/empty.
      pluckedData[value.as] = pluckedValue;
    });

    return pluckedData;
  }
```

### 3. Embedding Process
Each vector DB provider follows this pattern:

1. Load document data (includes `pageContent` and `metadata`)
2. Create `TextSplitter` with `chunkHeaderMeta` from metadata
3. Split `pageContent` into chunks (with headers prepended)
4. Call `EmbedderEngine.embedChunks(textChunks)` - **This is where the text gets embedded**
5. Store vectors with metadata (metadata is stored separately, not embedded)

**Key Code Location (Pinecone example):**
```138:156:server/utils/vectorDbProviders/pinecone/index.js
      const EmbedderEngine = getEmbeddingEngineSelection();
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
      const textChunks = await textSplitter.splitText(pageContent);

      console.log("Chunks created from document:", textChunks.length);
      const documentVectors = [];
      const vectors = [];
      const vectorValues = await EmbedderEngine.embedChunks(textChunks);
```

## Where to Add Text Enrichments

### Option 1: Enrich Before Splitting (Recommended for Global Context)
**Location:** Before `textSplitter.splitText(pageContent)` is called

**Approach:** Modify `pageContent` to include enrichment text before splitting

**Pros:**
- Enrichment applies to entire document
- Can add document-level context (summary, keywords, category, etc.)
- Simple to implement

**Cons:**
- Same enrichment text repeated in every chunk
- May waste embedding tokens if enrichment is long

**Implementation Example:**
```javascript
// In vector DB provider's addDocumentToNamespace method
const enrichedPageContent = enrichDocumentContent(pageContent, metadata);
const textChunks = await textSplitter.splitText(enrichedPageContent);
```

### Option 2: Enrich During Splitting (Recommended for Chunk-Specific Context)
**Location:** In `TextSplitter.splitText()` or after splitting but before embedding

**Approach:** Modify each chunk individually with chunk-specific enrichments

**Pros:**
- Can add chunk-specific context (section title, position in document, etc.)
- More granular control
- Can vary enrichment per chunk

**Cons:**
- More complex implementation
- Need to track chunk position/context

**Implementation Example:**
```javascript
// After splitting
const enrichedChunks = textChunks.map((chunk, index) => {
  return enrichChunkContent(chunk, {
    ...metadata,
    chunkIndex: index,
    totalChunks: textChunks.length
  });
});
const vectorValues = await EmbedderEngine.embedChunks(enrichedChunks);
```

### Option 3: Expand Header Metadata (Current Pattern)
**Location:** `TextSplitter.buildHeaderMeta()` method

**Approach:** Add more fields to `chunkHeaderMeta` that get prepended to chunks

**Pros:**
- Follows existing pattern
- Easy to extend
- Metadata is already being prepended to chunks

**Cons:**
- Limited to structured metadata fields
- Less flexible for complex enrichments

**Implementation Example:**
```javascript
// In TextSplitter.buildHeaderMeta()
const PLUCK_MAP = {
  // ... existing fields ...
  description: {
    as: "description",
    pluck: (metadata) => metadata?.description || null,
  },
  docAuthor: {
    as: "author",
    pluck: (metadata) => metadata?.docAuthor || null,
  },
  // Add custom enrichment fields
  category: {
    as: "category",
    pluck: (metadata) => metadata?.category || null,
  },
  tags: {
    as: "tags",
    pluck: (metadata) => metadata?.tags?.join(", ") || null,
  },
};
```

## Recommended Enrichment Fields

### Document-Level Enrichments (Option 1)
These would be added to the entire document before splitting:

1. **Document Summary/Abstract**
   - Brief overview of document content
   - Helps embedding understand document purpose

2. **Keywords/Tags**
   - Important terms or topics
   - Improves semantic search quality

3. **Category/Type**
   - Document classification (e.g., "technical documentation", "research paper", "tutorial")
   - Provides context for embedding

4. **Domain/Subject**
   - Subject area (e.g., "machine learning", "web development")
   - Helps with domain-specific embeddings

### Chunk-Level Enrichments (Option 2)
These would be added to individual chunks:

1. **Section Title/Heading**
   - The heading that contains this chunk
   - Provides local context

2. **Chunk Position**
   - "Part 1 of 5", "Introduction section", etc.
   - Helps understand document structure

3. **Surrounding Context**
   - Brief summary of previous/next sections
   - Improves continuity understanding

### Header Metadata Enrichments (Option 3)
These would be added via `chunkHeaderMeta`:

1. **Description** - Already in metadata, just needs to be added to header
2. **Author** - Already in metadata, just needs to be added to header
3. **Category** - If added to document metadata
4. **Tags** - If added to document metadata

## Implementation Strategy

### Phase 1: Extend Header Metadata (Easiest)
1. Modify `TextSplitter.buildHeaderMeta()` to include:
   - `description`
   - `docAuthor`
   - Any other existing metadata fields that would help

### Phase 2: Add Document-Level Enrichment Function
1. Create `server/utils/documentEnrichment.js`
2. Function: `enrichDocumentContent(pageContent, metadata)`
3. Add enrichment text before `pageContent`
4. Integrate into vector DB providers

### Phase 3: Add Chunk-Level Enrichment
1. Extend enrichment function to support chunk-level
2. Track chunk position and context
3. Add chunk-specific enrichments

## Code Locations to Modify

### Primary Files:
1. **`server/utils/TextSplitter/index.js`**
   - Extend `buildHeaderMeta()` to include more fields
   - Modify `splitText()` to support enrichment hooks

2. **Vector DB Providers** (all in `server/utils/vectorDbProviders/*/index.js`):
   - `pinecone/index.js`
   - `qdrant/index.js`
   - `chroma/index.js`
   - `weaviate/index.js`
   - `zilliz/index.js`
   - `milvus/index.js`
   - `pgvector/index.js`
   - `lance/index.js`
   - `astra/index.js`
   
   All have similar `addDocumentToNamespace` methods where enrichment can be added

3. **Document Processing** (optional, for adding enrichment fields to metadata):
   - `collector/processRawText/index.js`
   - `collector/processSingleFile/convert/*.js`

### New File to Create:
- `server/utils/documentEnrichment.js` - Centralized enrichment logic

## Example Enrichment Implementation

### Simple Header Extension:
```javascript
// In TextSplitter.buildHeaderMeta()
description: {
  as: "description",
  pluck: (metadata) => {
    const desc = metadata?.description;
    if (!desc || desc === "no description found") return null;
    return desc;
  },
},
docAuthor: {
  as: "author",
  pluck: (metadata) => {
    const author = metadata?.docAuthor;
    if (!author || author === "no author specified") return null;
    return author;
  },
},
```

### Document-Level Enrichment:
```javascript
// server/utils/documentEnrichment.js
function enrichDocumentContent(pageContent, metadata) {
  const enrichments = [];
  
  if (metadata?.description && metadata.description !== "no description found") {
    enrichments.push(`Document Description: ${metadata.description}`);
  }
  
  if (metadata?.docAuthor && metadata.docAuthor !== "no author specified") {
    enrichments.push(`Author: ${metadata.docAuthor}`);
  }
  
  if (metadata?.category) {
    enrichments.push(`Category: ${metadata.category}`);
  }
  
  if (metadata?.tags && Array.isArray(metadata.tags)) {
    enrichments.push(`Tags: ${metadata.tags.join(", ")}`);
  }
  
  if (enrichments.length > 0) {
    return `[Document Context]\n${enrichments.join("\n")}\n\n[Content]\n${pageContent}`;
  }
  
  return pageContent;
}
```

## Notes

1. **Metadata vs Embedded Text**: Currently, metadata is stored separately in vector DB but NOT included in the embedding. Only the text chunks (with optional headers) are embedded. To improve embedding quality, enrichments must be added to the text that gets embedded.

2. **Token Limits**: Be mindful of embedding model token limits. Adding too much enrichment text may cause chunks to exceed limits or reduce the amount of actual content per chunk.

3. **Consistency**: All vector DB providers follow the same pattern, so enrichment logic should be centralized and reusable.

4. **Backward Compatibility**: Existing documents won't have enrichments. Consider:
   - Re-embedding existing documents (expensive)
   - Making enrichments optional/configurable
   - Only applying to new documents

5. **Performance**: Enrichment adds processing time. Consider caching or making it configurable.

