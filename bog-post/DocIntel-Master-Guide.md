# DocIntel Pro: Complete Implementation Guide (December 2025)

## 🎯 What You're Building

**DocIntel Pro** is a production-ready document Q&A system using:

- **AWS Textract** (PDF extraction with tables + forms + OCR)
- **AWS Bedrock** (Claude 3 Haiku + Titan embeddings)
- **OpenSearch** (vector search + hybrid retrieval)
- **NestJS + Next.js** (full-stack TypeScript)
- **AWS Lambda** (serverless infrastructure)

**Outcome:** Published blog post + open-source GitHub repo + portfolio piece

---

## 📊 Project Architecture

```
UPLOAD FLOW:
Browser (Next.js)
    ↓ POST /api/upload
Lambda: UploadHandler
    ↓ Generate presigned URL
S3 Bucket ← Direct browser PUT
    ↓ S3:ObjectCreated
Lambda: TextractStart
    ↓ StartDocumentTextDetection (async)
Textract
    ↓ Job complete
SNS Topic
    ↓ SNS notification
Lambda: TextractComplete
    ↓ Parse + chunk + embed
DocumentService (NestJS)
    ↓ Bedrock Titan embeddings
EmbeddingService (NestJS)
    ↓ Vector storage
VectorStoreService (NestJS)
    ↓ Index in OpenSearch
OpenSearch
    ↓ Status: PROCESSED

QUERY FLOW:
User question (Next.js)
    ↓ POST /api/query
Lambda: QueryHandler
    ↓ Embed question
EmbeddingService
    ↓ Vector search
OpenSearch (k-NN + keyword)
    ↓ Top 5 chunks
VectorStoreService
    ↓ Construct prompt
RAG Pipeline
    ↓ Bedrock Claude 3 Haiku
Bedrock
    ↓ Stream response
Next.js (real-time)
```

---

## 📁 Directory Structure (Monorepo)

```
docintel-pro/
├── apps/
│   ├── api/                          # NestJS backend (Lambda)
│   │   ├── src/
│   │   │   ├── handlers/             # Lambda entry points
│   │   │   │   ├── upload.handler.ts
│   │   │   │   ├── textract-start.handler.ts
│   │   │   ├── modules/
│   │   │   │   ├── document/         # PDF chunking
│   │   │   │   ├── embedding/        # Bedrock Titan
│   │   │   │   └── vector-store/     # OpenSearch
│   │   │   └── app.module.ts
│   │   ├── dist/                     # Compiled
│   │   └── package.json
│   └── web/                          # Next.js frontend
│       ├── app/
│       │   ├── page.tsx              # Main interface
│       │   └── layout.tsx
│       ├── components/
│       │   ├── FileUpload.tsx
│       │   ├── ChatInterface.tsx
│       │   └── DocumentManagement.tsx
│       └── package.json
├── infra/                            # AWS CDK
│   ├── stacks/
│   │   └── docintel-stack.ts         # Complete infrastructure
│   └── package.json
├── packages/
│   └── shared/
│       ├── types/                    # TypeScript interfaces
│       └── utils/                    # Shared logic
├── __tests__/                        # Integration tests
├── docs/                             # Documentation
│   ├── README.md
│   ├── DEPLOYMENT.md
│   ├── MONITORING.md
│   └── TROUBLESHOOTING.md
├── .github/workflows/                # CI/CD (GitHub Actions)
├── .env.example
├── package.json                      # Root monorepo
├── pnpm-workspace.yaml               # pnpm workspaces
├── tsconfig.base.json                # TypeScript base
├── eslint.config.js                  # ESLint 2025
└── README.md
```

---

## ⚡ Tech Stack (2025 Standards)

| Layer              | Technology                                                       | Version           |
| ------------------ | ---------------------------------------------------------------- | ----------------- |
| **Runtime**        | Node.js                                                          | 20.x LTS          |
| **Language**       | TypeScript                                                       | 5.4+              |
| **Backend**        | NestJS                                                           | 10.4+             |
| **Frontend**       | Next.js                                                          | 15.x              |
| **Package Mgr**    | pnpm                                                             | 9.x               |
| **Testing**        | Vitest                                                           | 2.x               |
| **Bundler**        | esbuild                                                          | 0.23+             |
| **Linting**        | ESLint                                                           | 9.x (flat config) |
| **Formatting**     | Prettier                                                         | 3.3+              |
| **Infrastructure** | AWS CDK                                                          | 2.2+              |
| **AWS Services**   | Textract, Bedrock, Lambda, S3, DynamoDB, OpenSearch, API Gateway |

---

## 🚀 8-Week Implementation Timeline

### **WEEK 1-2: Planning & Blog Writing**

```
Day 1-3: Reading phase
□ Read entire guide
□ Understand architecture
□ Setup GitHub repo (private)
□ Research blog angle

Day 4-6: Blog writing
□ Edit blog template (sections 1-3)
□ Add company examples
□ Include cost breakdowns
□ Add architecture diagrams

Day 7-10: Blog finalization
□ Write sections 4-6
□ Add performance data
□ Technical review with team
□ Ready to publish (not yet)
```

**Output:** Blog post draft (80% complete)

---

### **WEEK 3-4: Backend Development (Prompts 0-6)**

```
Day 1: Project setup
□ Run PROMPT 0 (monorepo init)
□ Create all directories
□ pnpm install

Day 2: Upload handler
□ Run PROMPT 1A
□ Test presigned URL generation
□ Verify S3 integration

Day 3: Textract start
□ Run PROMPT 2A
□ Test S3 event trigger
□ Verify DynamoDB writes

Day 4: TextractComplete
□ Run PROMPT 3A
□ Mock Textract results
□ Test parsing logic

Day 5: DocumentService
□ Run PROMPT 4A
□ Test chunking algorithm
□ Measure token counts

Day 6: EmbeddingService
□ Run PROMPT 5A
□ Test Bedrock integration
□ Track embedding costs

Day 7: VectorStoreService
□ Run PROMPT 6A
□ Test OpenSearch indexing
□ Verify hybrid search
```

**Output:** Production NestJS backend (~2,000 LOC)

---

### **WEEK 5: Frontend Development (Prompts 7-8)**

```
Day 1-2: Next.js setup
□ Run PROMPT 7A (components)
□ FileUpload component
□ ChatInterface component

Day 3-4: API integration
□ Connect to Lambda endpoints
□ Setup React Query
□ Implement streaming

Day 5: UI polish
□ Tailwind styling
□ Responsive design
□ Loading states
```

**Output:** Functional Next.js frontend (~800 LOC)

---

### **WEEK 6: Infrastructure & Deployment (Prompts 9-10)**

```
Day 1-3: AWS CDK
□ Run PROMPT 9A (CDK stack)
□ S3, Textract, SNS, Lambdas
□ DynamoDB, OpenSearch
□ API Gateway

Day 4-5: Deploy & test
□ cdk deploy --all
□ Test upload → processing
□ Test query → response
□ Monitor costs
```

**Output:** Live system on AWS

---

### **WEEK 7: Testing & Optimization (Prompts 11-12)**

```
Day 1-2: Integration tests
□ Run PROMPT 11A (Vitest suite)
□ Test all handlers
□ Mock AWS services

Day 3-5: Performance tuning
□ Measure cold starts
□ Optimize Lambda memory
□ Fine-tune chunking size
□ Benchmark OpenSearch
```

**Output:** Test suite + optimized system

---

### **WEEK 8: Launch (Prompts 13)**

```
Day 1-2: Documentation
□ Run PROMPT 13A (docs)
□ README.md
□ DEPLOYMENT.md
□ MONITORING.md

Day 3-4: GitHub release
□ Make repo public
□ Tag v1.0.0
□ Create demo video

Day 5: Publish & announce
□ Blog post live
□ LinkedIn announcement
□ GitHub stars tracking
□ Internal demo
```

**Output:** Published blog + open-source repo

---

## 📋 Complete Copilot Prompts (13 Total)

### **PROMPT 0: Monorepo Initialization**

```
Create a production TypeScript monorepo for DocIntel Pro (Textract + Bedrock + NestJS + Next.js).

Requirements:

1. Package Manager & Tools:
   - Use pnpm 9.x (fast, efficient)
   - Root package.json with workspaces
   - pnpm-workspace.yaml configuration

2. Backend (apps/api):
   - NestJS 10.4+ standalone (no Express, Lambda-optimized)
   - AWS SDK v3 (modular imports: @aws-sdk/client-*)
   - TypeScript 5.4+ strict mode
   - esbuild for Lambda bundling
   - Vitest for testing
   - pino 9.x for structured logging

3. Frontend (apps/web):
   - Next.js 15 (App Router)
   - React 18.3+
   - TanStack Query v5
   - Tailwind CSS
   - shadcn/ui components
   - TypeScript strict

4. Infrastructure (infra):
   - AWS CDK v2.2+
   - constructs 10.4+
   - TypeScript for IaC

5. Shared (packages):
   - TypeScript interfaces
   - Shared utilities
   - Project references

6. Linting & Formatting:
   - ESLint 9 (flat config)
   - Prettier 3.3
   - husky + lint-staged (pre-commit)

7. Scripts in root package.json:
   - pnpm build (all apps)
   - pnpm dev (all apps parallel)
   - pnpm test (all tests)
   - pnpm lint (all code)
   - pnpm format (all code)
   - pnpm deploy (CDK deploy)

8. tsconfig.json Strategy:
   - tsconfig.base.json (root, shared settings)
   - apps/api/tsconfig.json (extends base, strict)
   - apps/web/tsconfig.json (extends base, Next.js)
   - infra/tsconfig.json (extends base, CDK)

Output:
- Root package.json with pnpm workspaces
- pnpm-workspace.yaml
- apps/api/package.json
- apps/web/package.json
- infra/package.json
- tsconfig.base.json
- tsconfig.json in each app
- eslint.config.js (flat config 2025)
- .prettierrc.json
- .husky/pre-commit
- .gitignore
- Complete setup instructions
```

---

### **PROMPT 1A: Upload Handler (S3 Presigned URLs)**

```
Create apps/api/src/handlers/upload.handler.ts for secure PDF uploads.

Context:
- Frontend calls this to get presigned URLs
- Direct browser → S3 upload (no Lambda proxy)
- S3 ObjectCreated automatically triggers TextractStart

Requirements:

1. Handler Signature:
   - Export: async function handler(event: APIGatewayProxyEventV2, context: Context)
   - Returns APIGatewayProxyResultV2

2. Input Validation:
   - Body: { filename: string, contentType?: string }
   - Validate: filename ends with .pdf
   - Validate: max 100 char filename
   - Strip path traversal characters (../)

3. Generate Presigned URL:
   - AWS SDK v3: @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner
   - Method: PUT
   - Expiry: 300 seconds (5 minutes)
   - Conditions:
     - Content-Type: application/pdf
     - Content-Length: 0-52428800 (50MB max)
   - Bucket: from env S3_BUCKET_NAME

4. Create S3 Key:
   - Format: documents/{documentId}/{filename}
   - documentId = uuid v4
   - Example: documents/abc-123/contract.pdf

5. Save Metadata (Pre-upload):
   - DynamoDB table: DocIntel-DocumentMetadata
   - PK: documentId
   - Attributes: filename, s3Key, status: "UPLOAD_PENDING", uploadDate (ISO)
   - Use AWS SDK v3: @aws-sdk/client-dynamodb

6. Response:
   {
     "uploadUrl": "https://bucket.s3.amazonaws.com/...",
     "documentId": "abc-123",
     "s3Key": "documents/abc-123/contract.pdf",
     "expiresIn": 300
   }

7. Error Handling:
   - Invalid filename: 400 "Filename must be .pdf"
   - DynamoDB failure: 500 "Upload initialization failed"
   - S3 error: 500 "Presigned URL generation failed"

8. Security:
   - Rate limit: max 10 uploads/minute (in-memory counter)
   - Filename sanitization (only alphanumeric, dash, underscore, dot)
   - CORS headers explicit

9. Observability:
   - Structured JSON logging (pino)
   - CloudWatch custom metrics
   - AWS X-Ray tracing

10. Testing:
    - Include upload.handler.test.ts
    - Mock S3 and DynamoDB
    - Test: valid PDF, invalid filename, DynamoDB failure
    - 90%+ coverage

Output:
- Complete apps/api/src/handlers/upload.handler.ts
- apps/api/src/handlers/upload.handler.test.ts
- Type definitions in packages/shared/types/upload.types.ts
- Frontend integration example in comments
```

---

### **PROMPT 2A: TextractStart Handler**

```
Create apps/api/src/handlers/textract-start.handler.ts for S3 → Textract pipeline.

Context:
- S3 ObjectCreated event triggers this Lambda
- Starts async Textract job (doesn't wait)
- Saves job metadata to DynamoDB

Requirements:

1. Trigger:
   - Event: S3Event (ObjectCreated)
   - Records: single or multiple
   - Extract: bucket, key from event
   - Validate: file is .pdf, size < 50MB

2. Validation:
   - Check content-type is application/pdf
   - Check file size (head object)
   - Log if skipped (e.g., non-PDF)

3. Document Initialization:
   - Generate documentId = uuid v4
   - Create DynamoDB record: DocIntel-DocumentMetadata
     - PK: documentId
     - Attributes: filename, bucket, s3Key, uploadDate, status: "TEXTRACT_PENDING", fileSize, contentType
   - SDK: @aws-sdk/client-dynamodb

4. Start Textract Job (Async):
   - SDK: @aws-sdk/client-textract
   - StartDocumentTextDetection:
     - DocumentLocation.S3Object: bucket + key
     - NotificationChannel.SNSTopicArn: from env TEXTRACT_SNS_TOPIC_ARN
     - RoleArn: from env TEXTRACT_ROLE_ARN
     - Features: [TABLES, FORMS] (extract structure)

5. Save Job Metadata:
   - DynamoDB table: DocIntel-ProcessingJobs
   - PK: jobId (from Textract response)
   - Attributes: documentId, bucket, s3Key, status: "TEXTRACT_IN_PROGRESS", createdAt (ISO), jobId
   - Batch write (parallel writes)

6. Error Handling:
   - Malformed S3 event: log and return gracefully
   - DynamoDB write failure: log but don't block
   - Textract failure: update status to "FAILED_TEXTRACT_START", log with full context
   - Never throw unhandled exceptions

7. Retry Logic:
   - DynamoDB: SDK built-in retry
   - Textract: 3x exponential backoff (300ms, 600ms, 1200ms)

8. Observability:
   - Structured logging (pino): documentId, jobId, bucket, key, fileSize
   - CloudWatch metrics: DocumentUploadCount, AverageFileSize
   - X-Ray segments

9. Testing:
   - textract-start.handler.test.ts
   - Mock S3 events (valid PDF, invalid file, missing key)
   - Mock Textract responses
   - Mock DynamoDB failures

Output:
- apps/api/src/handlers/textract-start.handler.ts
- apps/api/src/handlers/textract-start.handler.test.ts
- IAM policy snippet for CDK
- Type definitions for S3 events
```

---

### **PROMPT 3A: TextractComplete Handler**

```
Create apps/api/src/handlers/textract-complete.handler.ts for Textract results processing.

Context:
- SNS notification from Textract job completion
- This Lambda processes results and feeds to embedding pipeline
- Parses structured Textract output

Requirements:

1. Trigger:
   - Event: SNSEvent
   - Parse SNS Message for Textract notification
   - Extract: JobId, Status, DocumentLocation

2. Job Lookup:
   - Query DynamoDB ProcessingJobs by jobId
   - Fetch: documentId, bucket, s3Key, uploadDate
   - If not found: log and exit gracefully

3. Handle Status:
   - If Status != "SUCCEEDED":
     - Update job: status = "FAILED_TEXTRACT"
     - Log failure details
     - Return early
   - If Status == "SUCCEEDED": continue

4. Fetch Textract Results (Paginated):
   - SDK: @aws-sdk/client-textract
   - GetDocumentTextDetection (paginated)
   - Fetch all Blocks until end
   - Aggregate blocks by type

5. Parse Textract Output:
   - Extract blocks into structured document:
     - Pages: { pageNumber, text (in reading order) }
     - Tables: { pageNumber, markdown representation }
     - Forms: { pageNumber, keyValuePairs }
     - PlainText: concatenated all text
   - Implement parseTextractBlocks helper
   - Confidence filtering (>80%)

6. Invoke Document Pipeline:
   - Call: documentService.processParsedDocument(parsed, documentId)
   - This chunks, embeds, and indexes
   - Assume service handles storage

7. Update Metadata:
   - Update ProcessingJobs:
     - status: "COMPLETED"
     - pageCount (from Textract)
     - completedAt (ISO)
   - Update DocumentMetadata:
     - status: "PROCESSED"
     - pageCount
     - textractCost = pageCount * 0.0015
     - processedAt (ISO)

8. Error Handling:
   - Wrap in try-catch (per major step)
   - Log: jobId, documentId, errorMessage, stack
   - On failure: status = "FAILED_TEXTRACT_PROCESSING"
   - No unhandled exceptions

9. Observability:
   - Log: pageCount, chunksGenerated, totalTokens, embeddingCost
   - Metrics: TextractSuccessRate, ProcessingTime
   - X-Ray segments for each step

10. Testing:
    - textract-complete.handler.test.ts
    - Mock SNS events with Textract completion
    - Mock GetDocumentTextDetection response
    - Test success path + failure paths

Output:
- apps/api/src/handlers/textract-complete.handler.ts
- apps/api/src/handlers/textract-complete.handler.test.ts
- parseTextractBlocks helper function
- Type definitions: ParsedDocument, TextractPage
```

---

### **PROMPT 4A: DocumentService (NestJS)**

```
Create apps/api/src/modules/document/document.service.ts for document chunking.

Context:
- Receives ParsedDocument from Textract
- Chunks text semantically (not naive fixed-size)
- Integrates with EmbeddingService for vectors
- Returns enriched chunks

Requirements:

1. Service Structure:
   - File: src/modules/document/document.service.ts
   - Decorator: @Injectable()
   - Inject: EmbeddingService (constructor)

2. Core Method:
   - async processParsedDocument(parsed: ParsedDocument, documentId: string): Promise<Chunk[]>
   - Input: ParsedDocument { pages[], tables[], forms[], plainText }
   - Output: Chunk[] with embeddings

3. Chunking Strategy:
   - Semantic chunking (paragraph boundaries, not fixed-size)
   - Target size: 300-500 tokens per chunk
   - Overlap: 50 tokens between chunks
   - Avoid splitting tables or forms
   - Metadata: pageNumber, sectionType ("paragraph"|"table"|"form")

4. Embedding Integration:
   - For each chunk: await embeddingService.embedText(chunk.text)
   - Attach vector to chunk
   - Track total tokens

5. Cost & Metrics:
   - Calculate: totalChunks, totalTokens, estimatedCost
   - Log JSON: { documentId, totalChunks, totalTokens, estimatedCost }
   - Return: chunks + summary

6. Error Handling:
   - Empty text: return []
   - Chunking failure: throw descriptive error
   - Embedding errors: log but continue

7. Testing:
   - document.service.test.ts
   - Mock ParsedDocument inputs
   - Test chunking algorithm (various text lengths)
   - Verify metadata

8. DTOs:
   - ParsedDocument
   - Chunk
   - ChunkingResult

Output:
- Complete document.service.ts
- document.service.test.ts
- document.module.ts (NestJS module)
- Type definitions (DTOs)
```

---

### **PROMPT 5A: EmbeddingService (NestJS)**

```
Create apps/api/src/modules/embedding/embedding.service.ts for Bedrock embeddings.

Requirements:

1. Service Structure:
   - @Injectable() singleton
   - AWS SDK v3: @aws-sdk/client-bedrock-runtime
   - Config from env: BEDROCK_EMBEDDING_MODEL_ID (default: amazon.titan-embed-text-v2:0)

2. Core Methods:
   - async embedText(text: string): Promise<number[]>
     - Returns 1024-dimensional vector
     - Uses InvokeModelCommand

   - async embedBatch(texts: string[]): Promise<number[][]>
     - Process in batches of 16
     - Skip empty texts
     - If one fails, log but continue

3. Token Estimation:
   - Estimate tokens: Math.ceil(text.length / 4)
   - Track total, calculate cost: tokens / 1_000_000 * 0.02

4. Retry & Error Handling:
   - Transient errors: exponential backoff (3x)
   - Hard errors: log and throw
   - Never timeout (Lambda manages timeout)

5. Observability:
   - Structured logging (pino)
   - Metrics: token count, cost, latency
   - X-Ray traces

6. Testing:
   - embedding.service.test.ts
   - Mock Bedrock client
   - Test single + batch
   - Test error cases

Output:
- Complete embedding.service.ts
- embedding.service.test.ts
- Type definitions
```

---

### **PROMPT 6A: VectorStoreService (NestJS)**

```
Create apps/api/src/modules/vector-store/vector-store.service.ts for OpenSearch.

Requirements:

1. Service Structure:
   - @Injectable() singleton
   - Client: @opensearch-project/opensearch
   - Config from env: OPENSEARCH_DOMAIN, OPENSEARCH_INDEX_NAME

2. Index Management:
   - async initializeIndex(): Promise<void>
   - Create knn_vector index (1024 dims, cosinesimil, HNSW)
   - Shards: 3, Replicas: 1
   - Lazy initialize on first use

3. Index Operations:
   - async bulkIndex(chunks: Chunk[]): Promise<void>
     - Bulk API for performance
     - Skip duplicates
     - Handle partial failures

   - async deleteByDocumentId(documentId: string): Promise<void>

4. Search Operations:
   - async hybridSearch(queryVector: number[], queryText: string, k: number = 5): Promise<SearchResult[]>
     - Vector (knn) + keyword (multi_match) in bool query
     - Return top k with similarity_score, metadata

   - async vectorSearch(queryVector: number[], k: number = 5): Promise<SearchResult[]>

5. Connection Management:
   - Singleton client pattern
   - Timeout: 30s max
   - Retry transient failures

6. Error Handling:
   - Catch OpenSearch errors
   - Don't throw on search failures (return empty)
   - Log structured errors

7. Testing:
   - vector-store.service.test.ts
   - Mock OpenSearch client
   - Test bulk indexing, search

Output:
- Complete vector-store.service.ts
- vector-store.service.test.ts
- Type definitions: Chunk, SearchResult
```

---

### **PROMPT 7A: QueryHandler Lambda**

```
Create apps/api/src/handlers/query.handler.ts for RAG inference.

Requirements:

1. Handler:
   - async function handler(event: APIGatewayProxyEventV2, context: Context)
   - Body: { question: string, documentId?: string }
   - Validate: non-empty, max 500 chars

2. Flow:
   - Embed question (EmbeddingService)
   - Vector search (VectorStoreService.hybridSearch)
   - Filter by similarity > 0.7
   - Construct prompt with chunks [S1], [S2], etc.
   - Call Bedrock Claude 3 Haiku (temperature: 0.3, max_tokens: 500)
   - Stream response

3. Response:
   {
     "answer": "...",
     "sources": [{ id: "S1", similarity: 0.92, pageNumber: 5 }],
     "confidence": 0.92
   }

4. Error Handling:
   - No chunks: "No relevant documents"
   - Bedrock failure: error response
   - Never throw

5. Testing:
   - query.handler.test.ts
   - Mock search results, Bedrock
   - Test RAG flow

Output:
- Complete query.handler.ts
- query.handler.test.ts
```

---

### **PROMPT 8A: AWS CDK Stack**

```
Create infra/stacks/docintel-stack.ts for complete infrastructure.

Requirements:

1. S3 Bucket:
   - DocumentsBucket
   - Auto-gen name prefix docintel-documents-
   - Block public
   - AES-256 encryption
   - Lifecycle: delete after 30 days
   - Event: S3:ObjectCreated → TextractStartFunction

2. SNS Topic:
   - TextractCompletionTopic

3. IAM Role for Textract:
   - TextractExecutionRole
   - Permissions: textract:*, s3:GetObject, sns:Publish

4. Lambdas (3 total):
   - UploadHandler (POST /upload)
   - TextractStartFunction (S3 trigger)
   - TextractCompleteFunction (SNS trigger)
   - QueryHandler (POST /query)
   - All: Node.js 20, 512MB, env vars set

5. DynamoDB Tables (2):
   - DocIntel-DocumentMetadata (PK: documentId)
   - DocIntel-ProcessingJobs (PK: jobId)
   - Billing: on-demand
   - TTL: 90 days

6. OpenSearch Domain:
   - 3 nodes (t3.small)
   - 100GB EBS
   - Private subnets
   - Access policy: allow Lambda roles

7. API Gateway:
   - /upload (POST)
   - /query (POST)
   - CORS enabled

8. Outputs:
   - S3 bucket name
   - API Gateway endpoint
   - OpenSearch domain

Output:
- Complete docintel-stack.ts
- All constructs wired correctly
- Export outputs
```

---

### **PROMPT 9A: Next.js Frontend Components**

```
Create apps/web components for file upload and chat.

Requirements:

1. FileUpload Component:
   - Drag-drop zone for PDFs
   - File size validation (50MB max)
   - Progress bar during upload
   - Success/error states
   - Call: POST /api/upload → presigned URL → PUT to S3

2. ChatInterface Component:
   - Question input
   - Real-time streaming responses
   - Show source citations
   - Display similarity scores
   - Conversation history

3. DocumentManagement Component:
   - List uploaded documents
   - Show processing status
   - Delete documents

4. Hooks:
   - useFileUpload (handle upload flow)
   - useQuery (send question, stream response)

5. Styling:
   - Tailwind CSS
   - shadcn/ui components
   - Dark mode support
   - Responsive

Output:
- apps/web/components/FileUpload.tsx
- apps/web/components/ChatInterface.tsx
- apps/web/components/DocumentManagement.tsx
- apps/web/hooks/useFileUpload.ts
- apps/web/hooks/useQuery.ts
- apps/web/lib/api-client.ts
```

---

### **PROMPT 10A: Integration Tests**

```
Create __tests__/integration/pipeline.spec.ts with Vitest.

Test Scenarios:

1. Upload Handler
   - Valid PDF presigned URL generation
   - Invalid filename rejection
   - DynamoDB record creation

2. TextractStart
   - S3 event processing
   - Textract job initiation
   - DynamoDB metadata save

3. TextractComplete
   - SNS event processing
   - Textract result parsing
   - Document metadata update

4. Chunking + Embedding
   - ParsedDocument → chunks
   - Embedding integration
   - Cost calculation

5. Vector Search
   - Index documents
   - Hybrid search retrieval

6. RAG Query
   - Question embedding
   - Document retrieval
   - Bedrock invocation

7. Error Scenarios
   - Invalid PDF
   - Textract failure
   - Bedrock timeout
   - No relevant documents

Output:
- Complete pipeline.spec.ts
- Mock factories for AWS services
- Helper functions for test setup
```

---

### **PROMPT 11A: GitHub Actions CI/CD**

```
Create .github/workflows/deploy.yml for automated deployment.

Pipeline:

1. Trigger: push to main
2. Steps:
   - Checkout
   - Install (pnpm)
   - Lint (ESLint, Prettier)
   - Test (Vitest, 80%+ coverage)
   - Build (NestJS, Next.js)
   - CDK synth
   - CDK deploy (manual approval for prod)
3. Notifications: Slack/email

Output:
- .github/workflows/deploy.yml
- GitHub secrets setup instructions
```

---

### **PROMPT 12A: Documentation**

```
Generate documentation files:

1. README.md:
   - Project overview
   - Architecture diagram
   - Quick start
   - Environment variables
   - Cost breakdown
   - Performance benchmarks

2. DEPLOYMENT.md:
   - Prerequisites
   - Step-by-step deploy
   - Verification
   - Troubleshooting

3. MONITORING.md:
   - CloudWatch logs
   - X-Ray tracing
   - Cost monitoring
   - Common errors + fixes

Output:
- docs/README.md
- docs/DEPLOYMENT.md
- docs/MONITORING.md
- .env.example
- deploy.sh script
```

---

## 💻 Getting Started (TODAY)

### **Step 1: Copy PROMPT 0 to Copilot Chat**

```
Open GitHub Copilot Chat → Paste PROMPT 0 from above section
Wait 60-90 seconds for complete response
Copy all generated files to correct paths
```

### **Step 2: Initialize Directories**

```bash
mkdir -p docintel-pro
cd docintel-pro
# Copilot will generate this structure, then:
pnpm install
```

### **Step 3: Build & Verify**

```bash
pnpm build
pnpm lint
pnpm test
```

### **Step 4: Run PROMPT 1A-13A Sequentially**

- Copy each PROMPT to Copilot Chat
- Review output
- Place in correct directory
- Test before moving to next

---

## 📅 Week-by-Week Execution

```
WEEK 1-2: Blog writing (use existing template)
WEEK 3-4: Backend (PROMPT 0-6)
WEEK 5:   Frontend (PROMPT 7-8)
WEEK 6:   Infrastructure (PROMPT 9)
WEEK 7:   Tests (PROMPT 10-11)
WEEK 8:   Launch (PROMPT 12)
```

---

## 🎯 Success Metrics

**By Week 8:**

- ✅ Published blog post (5,000+ words)
- ✅ GitHub repo (open-source)
- ✅ Live system on AWS
- ✅ Production test suite
- ✅ Complete documentation
- ✅ Company announcement

**Blog metrics:**

- Views: 1,000+/month (potential)
- GitHub stars: 50+ (potential)
- Interview value: High ("I built this from scratch")

---

## 💡 Key Success Factors

1. **Follow structure exactly** (monorepo layout matters)
2. **Review Copilot output** (don't just copy-paste)
3. **Test after each PROMPT** (catch errors early)
4. **Commit frequently** (git history documents learning)
5. **Document decisions** (blog post notes your thinking)

---

## 🚀 You're Ready

**Everything you need:**

- ✅ 13 complete Copilot prompts (copy-paste)
- ✅ Project structure (clear directories)
- ✅ Week-by-week timeline (8 weeks)
- ✅ Code standards (2025 best practices)
- ✅ Testing strategy (90%+ coverage)
- ✅ Deployment plan (CDK automated)

**Start Monday. Use Copilot. Ship by Week 8.**

Good luck! 🎯
