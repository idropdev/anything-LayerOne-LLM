# Production RAG Pipeline Provisioning Guide
## Medical Applications with HIPAA Compliance

> **Version:** 1.0  
> **Last Updated:** January 2026  
> **Classification:** Internal Technical Documentation

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Infrastructure Provisioning](#infrastructure-provisioning)
5. [Security Configuration](#security-configuration)
6. [AnythingLLM Configuration](#anythingllm-configuration)
7. [Keystone Integration](#keystone-integration)
8. [Document Processing Pipeline](#document-processing-pipeline)
9. [OCR & Enrichment Configuration](#ocr--enrichment-configuration)
10. [Monitoring & Observability](#monitoring--observability)
11. [Disaster Recovery](#disaster-recovery)
12. [Compliance Checklist](#compliance-checklist)
13. [Runbook](#runbook)

---

## Overview

This guide provisions a production-grade RAG (Retrieval-Augmented Generation) pipeline optimized for medical document processing. The system is designed to handle PHI (Protected Health Information) in compliance with HIPAA regulations.

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **Document Ingestion** | Medical records, lab results, clinical notes, imaging reports |
| **OCR Processing** | Google Document AI + Vision AI for handwritten/scanned documents |
| **Semantic Search** | Vector-based similarity search with medical terminology awareness |
| **LLM Integration** | Configurable LLM providers with PHI-safe prompting |
| **Access Control** | Role-based access via Keystone delegated authentication |
| **Audit Logging** | Complete audit trail for all data access (no PHI in logs) |

---

## Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        A[HealthAtlas App] --> B[Keystone Core API]
    end
    
    subgraph "Authentication Layer"
        B --> C[Delegated JWT Token]
        C --> D[AnythingLLM Service]
    end
    
    subgraph "AnythingLLM Instance"
        D --> E[validatedRequest Middleware]
        E --> F[validateExternalUserToken]
        F --> G[User Sync / Local DB]
        G --> H[Workspace / Thread Management]
        H --> I[Vector DB - LanceDB/Pinecone]
        H --> J[Document Processor]
    end
    
    subgraph "Document Processing"
        J --> K[Collector Service]
        K --> L[OCR Enrichment]
        L --> M[Google Document AI]
        L --> N[Google Vision AI]
    end
    
    subgraph "External Services"
        H --> O[LLM Provider]
        O --> P[OpenAI / Anthropic / GCP Vertex AI]
    end
    
    subgraph "Storage Layer"
        I --> Q[(Vector Store)]
        G --> R[(SQLite/PostgreSQL)]
        J --> S[(Document Storage)]
    end
```

---

## Prerequisites

### Infrastructure Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| **CPU** | 4 cores | 8+ cores |
| **RAM** | 8 GB | 16+ GB |
| **Storage** | 100 GB SSD | 500 GB+ NVMe |
| **Network** | 100 Mbps | 1 Gbps |

### Software Requirements

```bash
# Node.js (LTS version)
node --version  # v18.x or v20.x

# Docker (for containerized deployment)
docker --version  # 24.x+

# Prisma CLI
npx prisma --version

# Yarn package manager
yarn --version
```

### GCP Services (if using Cloud deployment)

- **Cloud Run** or **GKE** for container hosting
- **Cloud SQL** (PostgreSQL) for production database
- **Cloud Storage** for document persistence
- **Document AI** API enabled
- **Vision AI** API enabled
- **Secret Manager** for credentials
- **Cloud Armor** for DDoS protection

---

## Infrastructure Provisioning

### Option A: GCP Cloud Run (Recommended for HIPAA)

```bash
# 1. Create GCP project with HIPAA BAA
gcloud projects create medical-rag-prod --name="Medical RAG Production"
gcloud config set project medical-rag-prod

# 2. Enable required APIs
gcloud services enable \
    run.googleapis.com \
    sqladmin.googleapis.com \
    documentai.googleapis.com \
    vision.googleapis.com \
    secretmanager.googleapis.com \
    cloudkms.googleapis.com

# 3. Create service account
gcloud iam service-accounts create anythingllm-service \
    --display-name="AnythingLLM Service Account"

# 4. Grant required roles
gcloud projects add-iam-policy-binding medical-rag-prod \
    --member="serviceAccount:anythingllm-service@medical-rag-prod.iam.gserviceaccount.com" \
    --role="roles/documentai.apiUser"

gcloud projects add-iam-policy-binding medical-rag-prod \
    --member="serviceAccount:anythingllm-service@medical-rag-prod.iam.gserviceaccount.com" \
    --role="roles/cloudsql.client"

# 5. Create Cloud SQL instance (PostgreSQL)
gcloud sql instances create anythingllm-db \
    --database-version=POSTGRES_15 \
    --tier=db-custom-4-16384 \
    --region=us-central1 \
    --storage-size=100GB \
    --storage-type=SSD \
    --storage-auto-increase \
    --backup-start-time=02:00 \
    --enable-bin-log \
    --require-ssl

# 6. Create database
gcloud sql databases create anythingllm --instance=anythingllm-db
```

### Option B: Self-Hosted (On-Premises)

```bash
# 1. Clone repository
git clone <repository-url> /opt/anythingllm
cd /opt/anythingllm

# 2. Copy environment template
cp server/.env.example server/.env.production

# 3. Generate secure secrets
openssl rand -base64 32  # JWT_SECRET
openssl rand -base64 32  # AUTH_TOKEN
openssl rand -hex 16     # KEYSTONE_DELEGATED_JWT_SECRET (if HS256)

# 4. Initialize database
cd server
yarn install --production
yarn prisma:setup
```

---

## Security Configuration

### Environment Variables

Create `server/.env.production` with the following configuration:

```bash
# =============================================================================
# CORE SETTINGS
# =============================================================================
NODE_ENV=production
SERVER_PORT=3001

# =============================================================================
# DATABASE (PostgreSQL for production)
# =============================================================================
DATABASE_URL="postgresql://user:password@localhost:5432/anythingllm?schema=public"

# =============================================================================
# AUTHENTICATION
# =============================================================================
# Internal JWT configuration
JWT_SECRET="<32+ character secure random string>"
AUTH_TOKEN="<secure random string for single-user mode fallback>"

# Multi-user mode (REQUIRED for Keystone integration)
DISABLE_TELEMETRY=true

# =============================================================================
# KEYSTONE INTEGRATION
# =============================================================================
# External authentication feature flag
EXTERNAL_AUTH_ENABLED=true

# Service identity verification mode
ANYTHINGLLM_SERVICE_AUTH_MODE=keystone_delegated_jwt

# Service audience (must match Keystone configuration)
ANYTHINGLLM_SERVICE_AUDIENCE=anythingllm

# Delegated JWT configuration (HS256 for development, RS256 for production)
KEYSTONE_DELEGATED_JWT_ALG=HS256
KEYSTONE_DELEGATED_JWT_SECRET="<shared secret with Keystone>"

# For RS256 (production recommended):
# KEYSTONE_DELEGATED_JWT_ALG=RS256
# KEYSTONE_DELEGATED_JWT_PUBLIC_KEY="<public key in PEM format>"

# Keystone introspection endpoint (for non-delegated tokens)
KEYSTONE_INTROSPECTION_URL=https://keystone.example.com/v1/auth/introspect
KEYSTONE_SERVICE_API_KEY="<Keystone service API key>"

# JWT issuer and audience validation
KEYSTONE_JWT_ISSUER=keystone.example.com
KEYSTONE_JWT_AUDIENCE=anythingllm

# Introspection cache TTL (seconds)
KEYSTONE_INTROSPECTION_CACHE_TTL=30

# =============================================================================
# LLM PROVIDER
# =============================================================================
LLM_PROVIDER=openai
OPENAI_API_KEY="<your-api-key>"

# Alternative: Anthropic
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY="<your-api-key>"

# Alternative: GCP Vertex AI (recommended for HIPAA)
# LLM_PROVIDER=gemini
# GEMINI_API_KEY="<your-api-key>"

# =============================================================================
# EMBEDDING ENGINE
# =============================================================================
EMBEDDING_ENGINE=openai
EMBEDDING_MODEL_PREF=text-embedding-3-small

# =============================================================================
# VECTOR DATABASE
# =============================================================================
# Production: Use Pinecone or managed vector DB
VECTOR_DB=lancedb

# For Pinecone:
# VECTOR_DB=pinecone
# PINECONE_API_KEY="<your-api-key>"
# PINECONE_INDEX="medical-rag"

# =============================================================================
# OCR CONFIGURATION
# =============================================================================
ENABLE_OCR_ENRICHMENT=true

# Google Cloud credentials (for Document AI / Vision AI)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json

# Document AI processor
GOOGLE_DOCUMENT_AI_PROJECT_ID=medical-rag-prod
GOOGLE_DOCUMENT_AI_LOCATION=us
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=<processor-id>

# =============================================================================
# SECURITY HARDENING
# =============================================================================
# Disable debug endpoints in production
DISABLE_DEBUG_ENDPOINTS=true

# Request rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# CORS configuration
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com

# =============================================================================
# LOGGING (No PHI in logs)
# =============================================================================
LOG_LEVEL=info
AUDIT_LOG_ENABLED=true
```

### TLS/SSL Configuration

```nginx
# /etc/nginx/conf.d/anythingllm.conf

upstream anythingllm {
    server 127.0.0.1:3001;
    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name rag.example.com;

    # TLS 1.2+ only (HIPAA requirement)
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    
    ssl_certificate /etc/ssl/certs/rag.example.com.crt;
    ssl_certificate_key /etc/ssl/private/rag.example.com.key;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://anythingllm;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeout for long-running LLM requests
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

---

## AnythingLLM Configuration

### Database Migration (SQLite → PostgreSQL)

```bash
# 1. Update prisma schema for PostgreSQL
# Edit server/prisma/schema.prisma:
# datasource db {
#   provider = "postgresql"
#   url      = env("DATABASE_URL")
# }

# 2. Generate Prisma client
cd server
npx prisma generate

# 3. Run migrations
npx prisma migrate deploy

# 4. Seed initial data (if needed)
npx prisma db seed
```

### System Settings for Medical RAG

```javascript
// Initial system settings (run via admin API or database)
const medicalSettings = {
  // Enable multi-user mode
  multi_user_mode: true,
  
  // Default workspace settings for medical documents
  default_similarity_threshold: 0.70,  // Higher threshold for medical accuracy
  default_top_n: 6,                    // More context for medical queries
  default_chat_mode: "query",          // Prefer document-grounded responses
  
  // LLM temperature (lower for factual medical responses)
  default_openai_temp: 0.3,
  
  // History length for multi-turn conversations
  default_openai_history: 10,
};
```

### Medical System Prompt Template

```text
You are a medical information assistant with access to clinical documents. 

CRITICAL GUIDELINES:
1. ONLY provide information that is explicitly stated in the provided context documents.
2. If the information is not in the documents, clearly state "This information is not available in the provided documents."
3. NEVER fabricate medical information, dosages, or treatment recommendations.
4. Always cite which document(s) your information comes from.
5. For any life-threatening conditions, always recommend consulting a healthcare provider.
6. Do not provide diagnostic conclusions - only summarize what is documented.

RESPONSE FORMAT:
- Start with a direct answer if available in documents
- Include relevant quotes from source documents
- List document sources at the end
- Flag any discrepancies between documents
```

---

## Keystone Integration

### Service-to-Service Authentication Flow

```mermaid
sequenceDiagram
    participant App as HealthAtlas App
    participant KS as Keystone Core API
    participant ALLM as AnythingLLM
    participant DB as Local Database

    App->>KS: Authenticate user
    KS-->>App: User JWT + Session
    App->>KS: Request delegated token for AnythingLLM
    KS->>KS: Generate delegated JWT with act claim
    KS-->>App: Delegated JWT
    App->>ALLM: API request with delegated JWT
    ALLM->>ALLM: validateExternalUserToken()
    ALLM->>ALLM: verifyDelegatedJWT()
    ALLM->>DB: syncExternalUser(act.sub)
    DB-->>ALLM: Local user record
    ALLM->>ALLM: Set response.locals.user
    ALLM-->>App: API response
```

### Delegated Token Structure

```json
{
  "iss": "keystone.example.com",
  "aud": "anythingllm",
  "sub": "keystone-service",
  "exp": 1704844800,
  "iat": 1704841200,
  "scope": ["read:workspaces", "write:threads", "read:documents"],
  "act": {
    "sub": "user-uuid-12345",
    "provider": "keystone",
    "roles": ["admin"],
    "sessionId": "session-uuid-67890"
  }
}
```

### Required Keystone Configuration

```yaml
# keystone/config/anythingllm-integration.yaml
services:
  anythingllm:
    audience: "anythingllm"
    delegatedTokenTTL: 3600  # 1 hour
    allowedScopes:
      - "read:workspaces"
      - "write:workspaces"
      - "read:threads"
      - "write:threads"
      - "read:documents"
      - "write:documents"
      - "read:chats"
      - "write:chats"
    roleMapping:
      admin: ["admin"]
      manager: ["manager"]
      default: ["default"]
```

---

## Document Processing Pipeline

### Ingestion Flow

```mermaid
graph LR
    A[Upload Request] --> B{File Type}
    B -->|PDF| C[PDF Processor]
    B -->|Image| D[OCR Pipeline]
    B -->|DOCX| E[DOCX Parser]
    
    C --> F{Is Scanned?}
    F -->|Yes| D
    F -->|No| G[Text Extraction]
    
    D --> H[Google Document AI]
    H --> I[OCR Enrichment]
    I --> G
    
    G --> J[Chunking Strategy]
    J --> K[Embedding Generation]
    K --> L[Vector Storage]
    L --> M[Document Metadata]
```

### Chunking Strategy for Medical Documents

```javascript
// server/utils/medical/chunkingStrategy.js
const MEDICAL_CHUNKING_CONFIG = {
  // Larger chunks for medical context
  chunkSize: 1500,
  chunkOverlap: 200,
  
  // Preserve medical sections
  preserveSections: [
    "CHIEF COMPLAINT",
    "HISTORY OF PRESENT ILLNESS",
    "PAST MEDICAL HISTORY",
    "MEDICATIONS",
    "ALLERGIES",
    "PHYSICAL EXAMINATION",
    "ASSESSMENT",
    "PLAN",
    "LAB RESULTS",
    "IMAGING",
    "DIAGNOSIS",
    "PROGNOSIS"
  ],
  
  // Never split within these patterns
  noSplitPatterns: [
    /\d+\.?\d*\s*(mg|mcg|ml|units?|IU)/i,  // Dosages
    /\d{1,2}\/\d{1,2}\/\d{2,4}/,           // Dates
    /ICD-\d+/,                              // ICD codes
    /CPT-\d+/                               // CPT codes
  ]
};
```

---

## OCR & Enrichment Configuration

### Document AI Processor Setup

```bash
# Create Document AI processor for medical forms
gcloud documentai processors create \
    --location=us \
    --display-name="Medical Form Parser" \
    --type=FORM_PARSER

# Get processor ID
gcloud documentai processors list --location=us
```

### OCR Enrichment Pipeline

```javascript
// Collector configuration for medical OCR
// collector/.env
ENABLE_OCR_ENRICHMENT=true
OCR_PROVIDER=google_document_ai
OCR_FALLBACK_PROVIDER=google_vision

// Medical-specific extraction fields
OCR_EXTRACT_FIELDS=patient_name,dob,mrn,diagnosis,medications,lab_values,vitals

// Confidence threshold for medical data
OCR_CONFIDENCE_THRESHOLD=0.85
```

### Sample OCR Response Processing

```javascript
// server/utils/ocr/medicalEntityExtractor.js
const extractMedicalEntities = (ocrResult) => {
  return {
    patientInfo: {
      name: ocrResult.entities.find(e => e.type === 'patient_name')?.mentionText,
      dob: ocrResult.entities.find(e => e.type === 'date_of_birth')?.mentionText,
      mrn: ocrResult.entities.find(e => e.type === 'medical_record_number')?.mentionText,
    },
    clinicalData: {
      diagnoses: ocrResult.entities.filter(e => e.type === 'diagnosis').map(e => e.mentionText),
      medications: ocrResult.entities.filter(e => e.type === 'medication').map(e => ({
        name: e.mentionText,
        dosage: e.properties?.dosage,
        frequency: e.properties?.frequency,
      })),
      labResults: ocrResult.entities.filter(e => e.type === 'lab_result').map(e => ({
        test: e.properties?.test_name,
        value: e.mentionText,
        unit: e.properties?.unit,
        reference: e.properties?.reference_range,
      })),
    },
    metadata: {
      documentType: ocrResult.entities.find(e => e.type === 'document_type')?.mentionText,
      serviceDate: ocrResult.entities.find(e => e.type === 'service_date')?.mentionText,
      provider: ocrResult.entities.find(e => e.type === 'provider_name')?.mentionText,
    }
  };
};
```

---

## Monitoring & Observability

### Health Check Endpoints

```javascript
// Available health check endpoints
GET /health           // Basic health check
GET /v1/health        // Detailed health with dependencies
GET /v1/system/check  // Full system diagnostics (admin only)
```

### Metrics Collection

```yaml
# docker-compose.monitoring.yml
version: '3.8'
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=secure-password
    ports:
      - "3000:3000"
    volumes:
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards
```

### Key Metrics to Monitor

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `http_request_duration_ms` | API response time | > 2000ms |
| `embedding_generation_time_ms` | Embedding latency | > 5000ms |
| `vector_search_latency_ms` | Vector DB query time | > 500ms |
| `llm_response_time_ms` | LLM generation time | > 30000ms |
| `document_processing_queue_size` | Pending documents | > 100 |
| `ocr_success_rate` | OCR extraction accuracy | < 95% |
| `auth_failure_rate` | Authentication failures | > 1% |
| `database_connection_pool` | Active connections | > 80% |

### Logging Configuration

```javascript
// server/utils/logger/config.js
// CRITICAL: No PHI in logs

const logConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: 'json',
  
  // Fields to ALWAYS redact
  redactFields: [
    'password',
    'token',
    'authorization',
    'patient_name',
    'dob',
    'ssn',
    'mrn',
    'address',
    'phone',
    'email',
    'diagnosis'
  ],
  
  // Audit log format
  auditLogFormat: {
    timestamp: true,
    userId: true,        // Local user ID only
    action: true,
    resourceType: true,
    resourceId: true,    // Document/workspace ID only
    ipAddress: true,
    userAgent: true,
    // NO: document content, patient info, query text, response text
  }
};
```

---

## Disaster Recovery

### Backup Strategy

```bash
#!/bin/bash
# backup.sh - Run daily via cron

BACKUP_DIR="/backup/anythingllm/$(date +%Y%m%d)"
mkdir -p $BACKUP_DIR

# 1. Database backup (PostgreSQL)
pg_dump -h localhost -U anythingllm -d anythingllm \
    --format=custom \
    --file=$BACKUP_DIR/database.dump

# 2. Vector database backup (if using file-based)
cp -r /opt/anythingllm/server/storage/lancedb $BACKUP_DIR/

# 3. Document storage backup
cp -r /opt/anythingllm/server/storage/documents $BACKUP_DIR/

# 4. Configuration backup (no secrets)
cp /opt/anythingllm/server/.env.production $BACKUP_DIR/.env.template
sed -i 's/=.*/=REDACTED/g' $BACKUP_DIR/.env.template

# 5. Upload to secure storage
gsutil cp -r $BACKUP_DIR gs://medical-rag-backups/
```

### Recovery Procedure

```bash
#!/bin/bash
# recover.sh

BACKUP_DATE=$1
BACKUP_DIR="/backup/anythingllm/$BACKUP_DATE"

# 1. Stop services
systemctl stop anythingllm

# 2. Restore database
pg_restore -h localhost -U anythingllm -d anythingllm \
    --clean --if-exists \
    $BACKUP_DIR/database.dump

# 3. Restore vector database
rm -rf /opt/anythingllm/server/storage/lancedb
cp -r $BACKUP_DIR/lancedb /opt/anythingllm/server/storage/

# 4. Restore documents
cp -r $BACKUP_DIR/documents/* /opt/anythingllm/server/storage/documents/

# 5. Run migrations (if schema changed)
cd /opt/anythingllm/server
npx prisma migrate deploy

# 6. Start services
systemctl start anythingllm

# 7. Verify
curl -f http://localhost:3001/health || exit 1
```

### RTO/RPO Targets

| Metric | Target | Implementation |
|--------|--------|----------------|
| **RPO** (Recovery Point Objective) | 1 hour | Hourly database backups |
| **RTO** (Recovery Time Objective) | 4 hours | Automated restore scripts |
| **MTTR** (Mean Time to Recovery) | 2 hours | Runbook + on-call rotation |

---

## Compliance Checklist

### HIPAA Technical Safeguards

- [ ] **Access Control** (164.312(a)(1))
  - [x] Unique user identification via Keystone integration
  - [x] Emergency access procedure documented
  - [x] Automatic logoff (token expiration)
  - [x] Encryption and decryption (TLS 1.2+, AES-256 at rest)

- [ ] **Audit Controls** (164.312(b))
  - [x] All API access logged with user ID
  - [x] No PHI in audit logs
  - [x] Logs stored for 6+ years
  - [x] Tamper-evident log storage

- [ ] **Integrity** (164.312(c)(1))
  - [x] Document checksums stored
  - [x] Database integrity checks
  - [x] Backup verification

- [ ] **Authentication** (164.312(d))
  - [x] Delegated JWT with cryptographic verification
  - [x] Token expiration enforcement
  - [x] Multi-factor authentication (via Keystone)

- [ ] **Transmission Security** (164.312(e)(1))
  - [x] TLS 1.2+ for all connections
  - [x] Certificate pinning supported
  - [x] VPN for internal traffic

### Pre-Production Checklist

- [ ] Security vulnerability scan completed
- [ ] Penetration testing completed
- [ ] Load testing completed (target: 100 concurrent users)
- [ ] Failover testing completed
- [ ] Backup/restore testing completed
- [ ] Runbook reviewed and tested
- [ ] On-call rotation established
- [ ] BAA signed with all vendors (GCP, LLM provider, etc.)
- [ ] Privacy impact assessment completed
- [ ] Staff training completed

---

## Runbook

### Starting the Service

```bash
# Production start
cd /opt/anythingllm/server
NODE_ENV=production yarn start

# Or via systemd
systemctl start anythingllm
systemctl status anythingllm
```

### Common Issues

#### Issue: Foreign Key Constraint on Thread Creation

**Symptom:** `Foreign key constraint failed on the field: foreign key` when creating threads

**Cause:** External user ID passed instead of local user ID

**Resolution:** The thread creation endpoint now validates `userId` exists locally and falls back to `response.locals.user.id`

---

#### Issue: Token Introspection Failures

**Symptom:** 401 errors with "Invalid or expired token"

**Diagnosis:**
```bash
# Check Keystone connectivity
curl -X POST https://keystone.example.com/v1/auth/introspect \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -d "token=$USER_TOKEN"
```

**Resolution:** Verify `KEYSTONE_INTROSPECTION_URL` and `KEYSTONE_SERVICE_API_KEY` in environment

---

#### Issue: OCR Processing Failures

**Symptom:** Documents fail to process with OCR errors

**Diagnosis:**
```bash
# Check Document AI quota
gcloud documentai processors describe $PROCESSOR_ID --location=us

# View processing logs
journalctl -u anythingllm-collector -f
```

**Resolution:** Verify GCP credentials and Document AI processor configuration

---

#### Issue: High Vector Search Latency

**Symptom:** `/v1/workspace/:slug/chat` responses > 10 seconds

**Diagnosis:**
```bash
# Check vector DB size
du -sh /opt/anythingllm/server/storage/lancedb

# Check embedding queue
curl http://localhost:3001/v1/system/queue
```

**Resolution:** Consider migrating to Pinecone or adding index optimization

---

### Emergency Procedures

#### Complete System Failure

1. Activate incident response team
2. Check infrastructure status (GCP Console / on-prem monitoring)
3. Review recent deployments for rollback candidates
4. Execute restore from latest backup
5. Verify system health before resuming traffic
6. Document incident and conduct post-mortem

#### Data Breach Suspected

1. **IMMEDIATELY** notify Security Officer
2. Preserve all logs (do not delete/modify)
3. Identify affected data scope
4. Begin breach notification procedure (within 72 hours per HIPAA)
5. Engage legal counsel
6. Document all actions taken

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-09 | Engineering | Initial release |

---

> **Note:** This document contains sensitive configuration information. Store securely and limit access to authorized personnel only.
