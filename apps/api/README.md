# DocIntel Pro - API

NestJS-based serverless API running on AWS Lambda for document processing and RAG queries.

## 🎯 Overview

The API handles:

- **Document Upload**: Generate presigned URLs for secure S3 uploads
- **Document Processing**: Textract OCR with embedding generation
- **RAG Queries**: Semantic search with Claude 3 answer generation
- **Workspace Management**: Multi-tenant workspace CRUD operations

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Architecture                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  API Gateway ──► Lambda Handler ──► NestJS Application                      │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Lambda Handlers                               │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │  upload.handler      │ Generate presigned URLs for S3 upload        │    │
│  │  documents.handler   │ List documents with status                   │    │
│  │  query.handler       │ RAG inference with Claude 3                  │    │
│  │  textract-start      │ S3 event → Start Textract job                │    │
│  │  textract-complete   │ SNS → Process results, embed, index          │    │
│  │  workspace-*         │ Workspace CRUD operations                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         NestJS Modules                               │    │
│  ├─────────────────────────────────────────────────────────────────────┤    │
│  │  EmbeddingModule     │ AWS Bedrock Titan embeddings (1024 dims)     │    │
│  │  VectorStoreModule   │ OpenSearch k-NN search                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
apps/api/
├── src/
│   ├── handlers/                    # Lambda function handlers
│   │   ├── upload.handler.ts        # Presigned URL generation
│   │   ├── documents.handler.ts     # Document listing
│   │   ├── query.handler.ts         # RAG query processing
│   │   ├── textract-start.handler.ts    # Start OCR job
│   │   ├── textract-complete.handler.ts # Process OCR results
│   │   ├── workspace-create.handler.ts  # Create workspace
│   │   ├── workspace-list.handler.ts    # List workspaces
│   │   ├── workspace-get.handler.ts     # Get workspace
│   │   ├── workspace-update.handler.ts  # Update workspace
│   │   └── workspace-delete.handler.ts  # Delete workspace
│   ├── modules/
│   │   ├── embedding/               # Bedrock embedding service
│   │   │   ├── embedding.module.ts
│   │   │   └── embedding.service.ts
│   │   └── vector-store/            # OpenSearch vector store
│   │       ├── vector-store.module.ts
│   │       └── vector-store.service.ts
│   ├── config/                      # Application configuration
│   ├── app.module.ts                # Root NestJS module
│   ├── main.ts                      # Development entry point
│   └── lambda.ts                    # Lambda handler entry point
├── build/                           # Compiled Lambda bundles
├── esbuild.config.js                # esbuild bundler config
├── nest-cli.json                    # NestJS CLI config
├── vitest.config.ts                 # Test configuration
├── tsconfig.json                    # TypeScript config
└── package.json                     # Dependencies
```

## 🔌 Lambda Handlers

### upload.handler

Generates presigned S3 URLs for secure PDF uploads.

**Trigger**: `POST /upload`

**Request**:

```json
{
  "filename": "document.pdf",
  "workspaceId": "uuid-here",
  "contentType": "application/pdf"
}
```

**Response**:

```json
{
  "uploadUrl": "https://s3.amazonaws.com/...",
  "documentId": "uuid",
  "expiresIn": 300
}
```

**Flow**:

1. Validates request and workspace ownership
2. Creates document record in DynamoDB (status: PENDING)
3. Generates presigned PUT URL (15 min expiry)
4. Returns URL for direct browser upload

---

### textract-start.handler

Initiates Textract OCR processing when a PDF is uploaded.

**Trigger**: S3 ObjectCreated event

**Flow**:

1. Validates PDF file (content-type, size)
2. Updates document status to PROCESSING
3. Starts async Textract job
4. Creates job record in DynamoDB

---

### textract-complete.handler

Processes Textract results and generates embeddings.

**Trigger**: SNS notification from Textract

**Flow**:

1. Fetches Textract results (paginated)
2. Parses text, tables, and forms
3. Chunks text into segments
4. Generates embeddings via Bedrock Titan
5. Indexes vectors in OpenSearch
6. Updates document status to COMPLETED

---

### query.handler

RAG inference pipeline for question-answering.

**Trigger**: `POST /query`

**Request**:

```json
{
  "question": "What is the main topic?",
  "workspaceId": "uuid-here"
}
```

**Response**:

```json
{
  "answer": "The document discusses...",
  "sources": [
    {
      "chunkId": "chunk-1",
      "documentId": "doc-1",
      "content": "...",
      "similarity": 0.89
    }
  ],
  "confidence": 0.85
}
```

**Flow**:

1. Generate question embedding (Bedrock Titan)
2. Semantic search in OpenSearch (k-NN, top 10)
3. Filter by similarity threshold (>0.5)
4. Build RAG prompt with context chunks
5. Generate answer (Claude 3 Haiku)
6. Return answer with sources

---

### documents.handler

Lists documents with processing status.

**Trigger**: `GET /documents`

**Response**:

```json
{
  "documents": [
    {
      "documentId": "uuid",
      "filename": "contract.pdf",
      "status": "COMPLETED",
      "uploadDate": "2026-01-28T...",
      "pageCount": 5
    }
  ]
}
```

---

### workspace-\*.handlers

CRUD operations for workspace management.

| Handler          | Method | Endpoint        | Description          |
| ---------------- | ------ | --------------- | -------------------- |
| workspace-create | POST   | /workspaces     | Create workspace     |
| workspace-list   | GET    | /workspaces     | List user workspaces |
| workspace-get    | GET    | /workspaces/:id | Get workspace        |
| workspace-update | PUT    | /workspaces/:id | Update workspace     |
| workspace-delete | DELETE | /workspaces/:id | Delete workspace     |

## 🧠 NestJS Modules

### EmbeddingModule

AWS Bedrock-based text embedding service using Amazon Titan Embeddings V2.

**Features**:

- Single & batch embedding generation
- Automatic retries with exponential backoff
- Cost tracking ($0.02 per 1M tokens)
- X-Ray trace support

**Configuration**:

```bash
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
AWS_REGION=us-east-1
```

**Usage**:

```typescript
// Single text
const embedding = await embeddingService.embedText('Your text');
// Returns: number[] (1024-dimensional vector)

// Batch
const result = await embeddingService.embedBatch(['Text 1', 'Text 2']);
// Returns: { embeddings, totalTokens, estimatedCost }
```

---

### VectorStoreModule

OpenSearch-based vector store with hybrid search capabilities.

**Features**:

- Vector indexing (1024 dimensions)
- Hybrid search (kNN + keyword matching)
- Bulk operations with partial failure handling
- Automatic index creation

**Configuration**:

```bash
OPENSEARCH_DOMAIN=https://your-domain.us-east-1.es.amazonaws.com
OPENSEARCH_INDEX_NAME=docintel-vectors
```

**Usage**:

```typescript
// Index chunks
await vectorStore.bulkIndex(chunks);

// Hybrid search
const results = await vectorStore.hybridSearch(queryVector, 'search text', 10);

// Vector-only search
const results = await vectorStore.vectorSearch(queryVector, 5);
```

## ⚙️ Environment Variables

| Variable                     | Description                 | Default                                |
| ---------------------------- | --------------------------- | -------------------------------------- |
| `AWS_REGION`                 | AWS region                  | us-east-1                              |
| `DOCUMENTS_BUCKET`           | S3 bucket for documents     | -                                      |
| `DYNAMODB_METADATA_TABLE`    | Document metadata table     | DocIntel-DocumentMetadata              |
| `DYNAMODB_JOBS_TABLE`        | Processing jobs table       | DocIntel-ProcessingJobs                |
| `DYNAMODB_WORKSPACES_TABLE`  | Workspaces table            | DocIntel-Workspaces                    |
| `OPENSEARCH_DOMAIN`          | OpenSearch endpoint         | -                                      |
| `OPENSEARCH_INDEX_NAME`      | Vector index name           | docintel-vectors                       |
| `BEDROCK_EMBEDDING_MODEL_ID` | Embedding model             | amazon.titan-embed-text-v2:0           |
| `BEDROCK_LLM_MODEL_ID`       | LLM model                   | anthropic.claude-3-haiku-20240307-v1:0 |
| `TEXTRACT_ROLE_ARN`          | Textract service role       | -                                      |
| `TEXTRACT_SNS_TOPIC_ARN`     | Textract notification topic | -                                      |
| `LOG_LEVEL`                  | Pino log level              | info                                   |

## 🚀 Development

### Run Locally

```bash
cd apps/api

# Development with hot reload
pnpm dev

# Build for Lambda
pnpm build

# Run tests
pnpm test

# Type checking
pnpm typecheck
```

### Build Output

The `pnpm build` command uses esbuild to create optimized Lambda bundles:

```
build/
├── lambda.js                    # Main Lambda entry
└── handlers/
    ├── upload.js
    ├── documents.js
    ├── query.js
    ├── textract-start.js
    ├── textract-complete.js
    └── workspace-*.js
```

### Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# Coverage
pnpm test:coverage
```

## 🔐 IAM Permissions

The Lambda functions require these IAM permissions:

```typescript
// S3
('s3:GetObject', 's3:PutObject', 's3:HeadObject');

// DynamoDB
('dynamodb:PutItem', 'dynamodb:GetItem', 'dynamodb:UpdateItem', 'dynamodb:Query');

// Textract
('textract:StartDocumentTextDetection', 'textract:GetDocumentTextDetection');

// Bedrock
('bedrock:InvokeModel');

// OpenSearch
('es:ESHttp*');

// SNS
('sns:Publish');

// CloudWatch
('logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents');

// X-Ray
('xray:PutTraceSegments', 'xray:PutTelemetryRecords');
```

## 📊 Observability

### Logging

Structured JSON logging with Pino:

```typescript
logger.info({ documentId, status }, 'Document processed');
logger.error({ error, jobId }, 'Textract job failed');
```

### Tracing

X-Ray tracing enabled for:

- Lambda function execution
- AWS SDK calls (S3, DynamoDB, Bedrock)
- OpenSearch queries

### Metrics

CloudWatch metrics available:

- Lambda duration, errors, invocations
- Textract job success/failure rates
- Embedding generation latency

## 🐛 Troubleshooting

### Check Lambda Logs

```bash
# Upload handler logs
aws logs tail /aws/lambda/DocIntel-UploadHandler --follow

# Textract start handler logs
aws logs tail /aws/lambda/DocIntel-TextractStartHandler --follow

# Textract complete handler logs
aws logs tail /aws/lambda/DocIntel-TextractCompleteHandler --follow

# Query handler logs
aws logs tail /aws/lambda/DocIntel-QueryHandler --follow
```

### Common Issues

| Issue            | Cause                         | Solution                  |
| ---------------- | ----------------------------- | ------------------------- |
| Timeout          | Large PDF processing          | Increase Lambda timeout   |
| Access Denied    | Missing IAM permissions       | Check role policies       |
| No results       | Similarity threshold too high | Lower threshold to 0.5    |
| Embedding failed | Bedrock not enabled           | Enable Bedrock in console |

## 📚 API Reference

All endpoints require `Authorization: Bearer <JWT_TOKEN>` header.

| Method | Endpoint        | Description              |
| ------ | --------------- | ------------------------ |
| POST   | /upload         | Get presigned upload URL |
| GET    | /documents      | List documents           |
| POST   | /query          | RAG query                |
| GET    | /workspaces     | List workspaces          |
| POST   | /workspaces     | Create workspace         |
| GET    | /workspaces/:id | Get workspace            |
| PUT    | /workspaces/:id | Update workspace         |
| DELETE | /workspaces/:id | Delete workspace         |
