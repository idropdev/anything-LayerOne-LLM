# Update README with HealthAtlas Branding and ECP-HRAG Documentation

## Overview

This PR updates the README to reflect HealthAtlas's internal deployment configuration, adding branding, infrastructure-specific documentation, and comprehensive ECP-HRAG implementation details.

## Changes Made

### 🎨 Branding Updates
- Added HealthAtlas logo alongside AnythingLLM logo in header
- Updated tagline to "AnythingLLM powered by HealthAtlas"
- Refocused description on healthcare document intelligence
- Added HIPAA-aligned infrastructure messaging

### 🏗️ Infrastructure Restrictions
- **Vector Databases**: Restricted to Milvus/Zilliz only (removed LanceDB, PGVector, Astra DB, Pinecone, Chroma, Weaviate, Qdrant)
- **Embedder Models**: Updated to highlight Custom Hybrid Embedder as default (removed other embedder options)
- **Hosting Platforms**: Restricted to GCP only (removed AWS, Docker, Digital Ocean, Render, Railway, RepoCloud, Elestio)
- Added notes explaining the infrastructure focus

### 📚 Documentation Additions
- **New Section**: Added comprehensive "ECP-HRAG Implementation" section with:
  - Architecture overview and pipeline diagram
  - Detailed explanation of 4-stage pipeline (Ingestion, Parallel Processing, Storage, Query)
  - Dense and Sparse path descriptions
  - Key benefits and implementation details
  - Marked as "HealthAtlas Internal Documentation - Confidential ONLY"
- **Enhanced Section**: Expanded "LayerONE / HealthAtlas Production Configuration" with:
  - GCP-only hosting requirement
  - Detailed hybrid embedder configuration
  - ECP HRAG technique descriptions
  - HIPAA-aligned infrastructure details

### 🖼️ Assets Added
- `docs/ECPHRAG.png` - Pipeline architecture diagram
- `docs/HealthAtlasLogo.svg` - HealthAtlas logo for branding

## Technical Details

### ECP-HRAG (Enriched Canonicalization Pipeline for Hybrid RAG)
- Multi-engine OCR with canonicalization for superior text extraction
- Semantic chunking by topic boundaries (not fixed tokens)
- Dual-path processing: Dense (semantic) + Sparse (BM25 keyword)
- Hybrid search with Reciprocal Rank Fusion (RRF)
- Sub-100ms query performance with zero preprocessing overhead
- Scalable to billions of vectors on Milvus/Zilliz

### Infrastructure Stack
- **Hosting**: Google Cloud Platform (GCP) only
- **Vector Database**: Milvus or Zilliz with hybrid index
- **Embedding Engine**: Custom hybrid embedder (`EMBEDDING_ENGINE=hybrid`)
  - Dense: snowflake-arctic-embed-m-v2.0
  - Sparse: wink-bm25 algorithm
- **Compliance**: HIPAA-aligned infrastructure

## Impact

### ✅ Benefits
- Clear documentation of HealthAtlas-specific deployment
- Comprehensive ECP-HRAG architecture documentation
- Accurate representation of actual infrastructure stack
- Proper branding alignment

### ⚠️ Breaking Changes
- README now reflects HealthAtlas internal configuration only
- Removed references to other vector databases, embedders, and hosting platforms
- This README is no longer suitable as a general-purpose AnythingLLM README

## Testing

- [x] Verified all image references work correctly
- [x] Confirmed markdown formatting renders properly
- [x] Checked that all links are valid
- [x] Validated that confidential section is clearly marked

## Notes

- This README is configured specifically for HealthAtlas deployments
- The ECP-HRAG section contains proprietary implementation details
- All changes maintain the existing README structure and formatting
- Future updates should preserve the HealthAtlas-specific configuration
















