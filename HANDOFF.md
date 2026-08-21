# anything-LayerOne-LLM — Handoff

> Onboarding doc for a fresh AI agent context window. Harness-agnostic.

## 1. Purpose

This is **LayerOne / HealthAtlas's private fork of [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)**, a full-stack "chat with your documents" application (RAG chatbot + AI agents, multi-user, multi-LLM, multi-vector-DB). Upstream repo: `Mintplex-Labs/anything-llm` (configured as the `upstream` git remote). This fork forked from upstream at commit `4eb951d4` (2025-06-06) and has since diverged with client-specific work for a healthcare deployment ("LayerONE/HealthAtlas", HIPAA-oriented — see README section "LayerONE / HealthAtlas Production Configuration").

The three headline divergences from upstream are:
1. **External (Keystone) authentication** — a separate JWT/introspection auth flow for non-admin users, layered alongside AnythingLLM's native admin auth, with strict endpoint segregation (`/admin/*` vs `/v1/*` and `/system/*`).
2. **Hybrid search** — dense + sparse (BM25) vector search, primarily tuned for Zilliz/Milvus, replacing/augmenting AnythingLLM's default dense-only vector search.
3. **Document enrichment pipeline** — chunk enrichment with external OCR field merging, run once at embedding time.

Who it's for: internal engineers at LayerOne/dropdevco maintaining a client (HealthAtlas) deployment of AnythingLLM. Not intended to be a general-purpose upstream contribution target — it carries deployment-specific assumptions (Zilliz preferred, Keystone external auth).

## 2. Status

**Active.** Most recent commit: `b5f4655b`, dated **2025-12-16** ("Merge pull request #5 from idropdev/authorization-split"). Current branch: **`master`**. The repo also periodically syncs commits from upstream `Mintplex-Labs/anything-llm` (interleaved merge/rebase commits like "sync with HEAD ...", "force rebase origin/master"), so `master` is a mix of upstream updates and fork-specific feature branches merged in via PRs from the `idropdev` fork. Code looks complete and deployable (Dockerfile, docker-compose, cloud deployment templates, Prisma migrations all present and current).

## 3. Stack

Multi-package Yarn workspace-style repo (no formal Yarn/NPM workspaces — each package is `cd`-into'd manually). Versions below are read directly from each `package.json`.

**Root** (`package.json`, `"packageManager": "yarn@1.22.22"`)
- Node engine: `>=18` (root), `>=18.12.1` (server/frontend/collector) — `.nvmrc` pins **`v18.18.0`**
- `jest ^29.7.0`, `concurrently ^9.1.2`, `wink-bm25-text-search ^3.1.2` (fork addition for BM25)

**server/** (`anything-llm-server`, v0.2.0) — Node/Express backend
- `express ^4.18.2`, `prisma 5.3.1` / `@prisma/client 5.3.1` (SQLite by default), `jsonwebtoken ^9.0.0`, `bcrypt ^5.1.0`
- LLM SDKs: `@anthropic-ai/sdk ^0.39.0`, `openai 4.95.1`, `langchain 0.1.36`, `@langchain/anthropic 0.1.16`, `@langchain/openai 0.0.28`, `ollama ^0.5.10`, `cohere-ai ^7.9.5`, `@aws-sdk/client-bedrock-runtime ^3.775.0`
- Vector DB clients: `@zilliz/milvus2-sdk-node ^2.6.4` (primary for this fork), `chromadb ^2.0.1`, `@lancedb/lancedb 0.15.0`, `@qdrant/js-client-rest ^1.9.0`, `@pinecone-database/pinecone ^2.0.1`, `weaviate-ts-client ^1.4.0`, `@datastax/astra-db-ts ^0.1.3`, `pg ^8.11.5` (pgvector)
- Fork additions: `wink-bm25-text-search ^3.1.2`, `wink-nlp ^1.14.3`, `wink-eng-lite-web-model ^1.8.1` (BM25/sparse search)
- `@modelcontextprotocol/sdk ^1.11.0` (MCP tool support), `@xenova/transformers ^2.14.0` (local embeddings)

**frontend/** (`anything-llm-frontend`) — React SPA
- `react ^18.2.0`, `react-dom ^18.2.0`, `vite ^4.3.0`, `tailwindcss ^3.3.1`, `react-router-dom ^6.3.0`, `i18next ^23.11.3`

**collector/** (`anything-llm-document-collector`, v0.2.0) — document ingestion service
- `express ^4.18.2`, `puppeteer ~21.5.2`, `tesseract.js ^6.0.0` (OCR), `mammoth ^1.6.0`, `pdf-parse ^1.1.1`, `officeparser ^4.0.5`, `sharp ^0.33.5`

**Submodules** (`.gitmodules`, both point at upstream Mintplex-Labs repos, not forked):
- `browser-extension/` → `Mintplex-Labs/anythingllm-extension`
- `embed/` → `Mintplex-Labs/anythingllm-embed`

## 4. Setup & Commands

Run all commands from the repo root unless noted. Package manager is **Yarn** (root `package.json` pins `yarn@1.22.22`); Node **18.18.0** per `.nvmrc`.

```bash
# One-time setup: installs server/collector/frontend deps, copies .env files, runs Prisma
yarn setup

# Or manually:
yarn setup:envs        # copies frontend/.env.example, server/.env.example -> server/.env.development,
                        # collector/.env.example, docker/.env.example
yarn prisma:generate    # cd server && npx prisma generate
yarn prisma:migrate     # cd server && npx prisma migrate dev --name init
yarn prisma:seed        # cd server && npx prisma db seed
# (yarn prisma:setup runs generate+migrate+seed together)

# Dev servers — run each in its own terminal, or all at once:
yarn dev:server         # cd server && yarn dev   (nodemon, port from server/.env)
yarn dev:collector      # cd collector && yarn dev
yarn dev:frontend       # cd frontend && yarn dev  (vite, --host=0.0.0.0)
yarn dev:all            # runs all three concurrently via `concurrently`

# Production build/run
yarn prod:server        # cd server && yarn start  (NODE_ENV=production)
yarn prod:frontend      # cd frontend && yarn build

# Lint (root fans out to each package)
yarn lint                # cd server/frontend/collector && yarn lint (prettier --write, per-package)

# Tests
yarn test                # root: `jest` (root has no dedicated test files of its own; see server tests below)
cd server && yarn test           # jest --runInBand --detectOpenHandles (server/__tests__/**)
cd server && yarn test:auth      # jest __tests__/integration/auth --runInBand (fork's external-auth suite)
cd server && yarn test:performance  # jest __tests__/performance --runInBand
# frontend/ and collector/ have NO test script defined.
```

Docker is the other supported path: `docker/docker-compose.yml` + `docker/Dockerfile` + `docker/.env.example`. See `docker/HOW_TO_USE_DOCKER.md` and `BARE_METAL.md` at repo root for a non-Docker install walkthrough.

## 5. Architecture Map

| Path | Responsibility |
|---|---|
| `server/` | Express backend: auth, LLM orchestration, vector DB adapters, chat/agent logic, Prisma/SQLite persistence. The core of the app. |
| `server/endpoints/` | HTTP route handlers. `admin.js`/`api/admin/` = admin-only (API-key auth); `api/` = versioned public API (`/v1/*`); `system.js`/`api/system/` = shared system endpoints. |
| `server/utils/middleware/` | Auth middleware: `requireAdmin.js`, `requireAdminJWT.js` (native admin), `validatedRequest.js`, `validateExternalUserToken.js` (fork's Keystone JWT introspection). |
| `server/utils/auth/` | `config.js` (external auth config/env parsing), `syncExternalUser.js` (maps Keystone identity → local user). Fork-specific. |
| `server/utils/AiProviders/` | One subfolder per LLM provider (openai, anthropic, azure, ollama, bedrock, cohere, etc.) implementing a common interface. |
| `server/utils/vectorDbProviders/` | One subfolder per vector DB (zilliz, milvus, chroma, lancedb, pinecone, qdrant, weaviate, astra, pgvector). `zilliz/` and `milvus/` are the fork's primary/production target. |
| `server/utils/EmbeddingEngines/` | Embedding backends, incl. fork additions `bm25/` (sparse/lexical index via `wink-bm25-text-search`) and `hybrid/` (combines dense + BM25 sparse for hybrid search). |
| `server/utils/documentEnrichment.js`, `server/utils/ocrFieldParser.js` | Fork's one-time chunk enrichment pipeline (merges external OCR output into chunks at embed time). |
| `server/utils/chats/` | Chat/streaming orchestration (`stream.js`, `apiChatHandler.js`, `embed.js`, `openaiCompatible.js`). |
| `server/utils/agents/` | Agent framework ("aibitat") — no-code agent flows, tool use. |
| `server/models/` | Prisma-backed data models (documents, workspaces, systemSettings, users, etc.). |
| `server/prisma/` | Prisma schema + migrations (SQLite by default). Migration `20251121211519_add_external_auth_fields` is fork-specific. |
| `server/storage/` | Runtime data: SQLite DB, vector cache, uploaded docs, models. Not source. |
| `server/__tests__/` | Jest tests, incl. fork-specific `integration/auth`, `performance/auth`, and docs `EXTERNAL_AUTH_ARCHITECTURE.md`, `TEST_RESULTS.md`. |
| `frontend/` | React + Vite SPA (chat UI, workspace/admin settings, onboarding). `src/pages`, `src/components`, `src/models` (API client wrappers), `src/hooks`. |
| `collector/` | Standalone document-ingestion microservice: parses PDFs/DOCX/links/YouTube/etc. into chunks. `processSingleFile/`, `processLink/`, `processRawText/`, `extensions/`, `hotdir/` (drop-folder watch). |
| `embed/` | Git submodule — embeddable chat widget (upstream Mintplex-Labs repo, not modified by this fork). |
| `browser-extension/` | Git submodule — browser extension (upstream, not modified by this fork). |
| `docker/` | Dockerfile, docker-compose, `.env.example`, entrypoint/healthcheck scripts. |
| `cloud-deployments/` | IaC/templates for AWS CloudFormation, GCP, DigitalOcean, Helm, K8s, HuggingFace Spaces. |
| `extras/` | Misc scripts/support tooling (not part of the running app). |
| `locales/` | i18n translation files + verification scripts. |
| `graphify-out/` | Pre-built code knowledge graph for this repo (see Section 10). Not app code. |

## 6. Entry Points — Read These First

1. `README.md` (root) — upstream AnythingLLM product overview + the fork's "LayerONE / HealthAtlas Production Configuration" section (Zilliz + hybrid search requirement).
2. `server/utils/auth/config.js` — defines the fork's entire external-auth env-var surface (`EXTERNAL_AUTH_*`) in one place.
3. `server/utils/middleware/validateExternalUserToken.js` + `server/utils/middleware/requireAdminJWT.js` — the two auth code paths (external/Keystone vs native admin) and how endpoints are segregated.
4. `server/utils/EmbeddingEngines/hybrid/index.js` and `server/utils/EmbeddingEngines/bm25/index.js` — the fork's hybrid dense+sparse search implementation.
5. `server/utils/documentEnrichment.js` — the OCR-enrichment pipeline that runs once at embed time.
6. `server/utils/vectorDbProviders/zilliz/index.js` (and `milvus/index.js`) — production vector DB integration these hybrid features are built for.
7. `PULL_REQUEST.md` (root) — write-up of the most recent major fork feature (auth flow separation), useful as a design-intent reference even though it documents a merged PR rather than open work.

## 7. Conventions & Gotchas

- **Two independent auth systems coexist.** Native AnythingLLM admin auth (JWT + API key, `requireAdmin`/`requireAdminJWT`) is untouched and gates `/admin/*`. A second, fork-added external auth path (`EXTERNAL_AUTH_*` env vars, Keystone Core API token introspection) gates `/v1/*` and shared/system endpoints for non-admin users. Someone used to stock AnythingLLM will be surprised that a JWT valid on one path is deliberately rejected on the other — this is intentional (see `PULL_REQUEST.md`).
- **Zilliz/hybrid search is the fork's recommended production config**, not AnythingLLM's default (which is plain dense vector search across many DB choices). Expect hybrid-search code paths (`bm25/`, `hybrid/`) to be exercised only when Zilliz/Milvus is selected.
- **`embed/` and `browser-extension/` are git submodules pointing at upstream, unmodified.** Don't expect fork-specific auth/search changes to appear there.
- Root `package.json` has **no formal Yarn/NPM workspaces config** — `server/`, `frontend/`, `collector/` are separate installs (`yarn setup` cd's into each). Running `yarn` at root alone will not install app dependencies.
- `documentEnrichment.js` explicitly enriches chunks **once, at embed time** — re-embedding is required to pick up enrichment/OCR changes; it's not applied dynamically at query time.
- A `.env` file exists at repo root **on disk only — it is NOT tracked by git** (ignored via `.gitignore:2`; verified with `git ls-files --error-unmatch .env`, which errors). Only `*.env.example` files are committed (`collector/`, `docker/`, `frontend/`, `server/`). So nothing is exposed in the repo, but a fresh clone will have no `.env` — copy one from the relevant `.env.example`. Never copy real values into docs or code reviews (see Section 8).
- `git log` shows repeated "sync with upstream" / "force rebase" / revert commits (e.g. `25a72f71` "Revert commit ... broken auth") — history is not fully linear; use `git blame`/`git log -p <file>` rather than assuming recency implies correctness for auth-adjacent files.

## 8. External Dependencies & Environment

**LLM providers** (select via `LLM_PROVIDER` in `server/.env`, one block of vars each — see `server/.env.example` for the full list): OpenAI, Azure OpenAI, Anthropic, Gemini, AWS Bedrock, Cohere, Ollama, LM Studio, LocalAI, TogetherAI, Fireworks, Perplexity, DeepSeek, OpenRouter, Mistral, HuggingFace, Groq, KoboldCPP, TextGenWebUI, generic OpenAI-compatible, LiteLLM, Novita, and more.

**Vector databases**: Zilliz (production default for this fork), Milvus, Chroma, LanceDB, Pinecone, Qdrant, Weaviate, Astra DB, PGVector.

**Fork-specific external auth (Keystone Core API)** — env vars from `server/utils/auth/config.js`:
- `EXTERNAL_AUTH_ENABLED`
- `EXTERNAL_AUTH_MODE` (default `"introspect"`)
- `EXTERNAL_AUTH_API_URL` (Keystone base URL)
- `EXTERNAL_AUTH_ISSUER`
- `EXTERNAL_AUTH_AUDIENCE`
- `EXTERNAL_API_SERVICE_KEY`
- `EXTERNAL_AUTH_INTROSPECTION_CACHE_TTL` (default `30`)
- `EXTERNAL_AUTH_REQUIRE_HTTPS` (forced true in production unless explicitly `"false"`)

**Core server env vars** (`server/.env.example`): `SERVER_PORT`, `JWT_SECRET`, `SIG_KEY`, `SIG_SALT`, plus one block per LLM/vector-DB provider (e.g. `OPEN_AI_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_KEY`, vector-DB connection vars) — see the file directly for the complete, current list rather than duplicating it here, as it is large and provider-specific.

**Other env surfaces**: `frontend/.env.example`, `collector/.env.example`, `docker/.env.example` — each copied from its `.example` by `yarn setup:envs`.

No secret values are reproduced in this document — only variable names.

## 9. Known Issues & TODOs

Real `TODO`/`FIXME` comments found in fork-relevant code:
- `server/utils/vectorDbProviders/milvus/index.js:175` — `// TODO: Re-implement cache handling if necessary, ensuring it maps to the new schema.`
- `server/utils/documentEnrichment.js:100` — `// TODO: Future enhancement - deduplication, alignment, confidence scoring`

Other `TODO`/`FIXME` markers also exist in unmodified upstream code (`server/utils/helpers/chat/responses.js`, `server/utils/files/index.js`, `server/utils/agents/aibitat/index.js`, `server/utils/TextSplitter/index.js`, provider files under `server/utils/AiProviders/`, and `server/endpoints/{system,agentFlows,admin}.js`, `server/endpoints/api/openai/index.js`) — these predate the fork and are inherited from upstream, not fork-introduced.

From `PULL_REQUEST.md` (documented, not necessarily fixed): the external-auth login endpoint (`POST /api/request-token`) degrades under concurrent load (P95 ~1.9s at 50+ concurrent requests, attributed to bcrypt cost + DB connection handling); recommended mitigations (rate limiting, connection pooling) were suggested but should be verified as actually implemented before relying on them.

## 10. Fast Orientation for a New Agent

**This repo is too large to read exhaustively (~5,900 graph nodes, ~296k words of code) — do not attempt to open most files directly. Use the pre-built `graphify-out/` knowledge graph as your primary navigation tool.**

```bash
export PATH="$HOME/.local/bin:$PATH"   # graphify.EXE lives in ~/.local/bin
graphify query "<your question>"       # scoped subgraph for a specific question
graphify god-nodes --top 20            # most-connected/architecturally central symbols
cat graphify-out/GRAPH_REPORT.md       # graph metadata; run `git rev-parse HEAD` and compare
                                        # to the report's "Built from commit" line to check staleness
```

The single most useful first query for this repo: **`graphify query "How does the external Keystone auth flow interact with AnythingLLM's native admin auth?"`** — this is the fork's most architecturally significant and least upstream-documented change, and understanding it correctly is a prerequisite for touching any endpoint or middleware code safely.

Second-most useful: `graphify query "How does hybrid search work in this fork (Zilliz/Milvus dense+sparse + BM25)?"` for the other major fork feature.

If the graph looks stale relative to `git rev-parse HEAD`, run `graphify update .` (no API cost) before relying on it further.
