# Minimal Stack Deployment Guide

Fast deployment of DocIntel with complete RAG pipeline including OpenSearch.

**Handlers Included**: Upload, TextractStart, TextractComplete, Query (RAG)

**Infrastructure**: S3, DynamoDB, SNS, Lambda, API Gateway, **OpenSearch Domain**

## ⚡ Quick Deploy (~12 minutes)

```bash
# 1. Build API handlers
cd apps/api
pnpm build

# 2. Deploy stack
cd ../../infra
pnpm run deploy:minimal
```

## 🏗️ Stack Components

### Infrastructure

- **S3 Bucket**: `docintel-documents-{account}-{region}`
  - 7-day lifecycle (dev)
  - Block public access
  - Encryption enabled

- **DynamoDB Tables** (2):
  - `DocIntel-DocumentMetadata` (PK: documentId)
  - `DocIntel-ProcessingJobs` (PK: jobId, GSI: TextractJobIdIndex)
  - On-demand billing

- **SNS Topic**:
  - `DocIntel-TextractCompletion` for async processing notifications

- **Lambda Functions** (4):
  - `DocIntel-UploadHandler`: 512MB, 30s timeout
  - `DocIntel-TextractStartHandler`: 512MB, 60s timeout
  - `DocIntel-TextractCompleteHandler`: 1024MB, 300s timeout
  - `DocIntel-QueryHandler`: 1024MB, 60s timeout (RAG inference)

- **OpenSearch Domain** (NEW - ~$20/month):
  - **Single node**: t3.small.search (dev optimized)
  - **EBS**: 30GB GP3
  - **Version**: OpenSearch 2.11
  - **Single-AZ** deployment (no cross-AZ costs)
  - **Public endpoint** with IAM auth (no VPC costs)
  - **Auto-configured** for Query Handler
  - Production notes: Use 3 nodes, t3.medium.search, private subnets, dedicated masters

- **API Gateway**:
  - REST API with CORS
  - POST /upload endpoint
  - POST /query endpoint (RAG question-answering)
  - Throttling: 100 req/s

### Outputs

After deployment, you'll get:

- `MetadataTableName`: DocIntel-DocumentMetadata
- `JobsTableName`: DocIntel-ProcessingJobs
- `TextractCompletionTopicArn`: arn:aws:sns:...
- `OpenSearchDomainEndpoint`: https://docintel-vectors-dev-xxx.us-east-1.es.amazonaws.com
- `OpenSearchDashboardUrl`:
  https://docintel-vectors-dev-xxx.us-east-1.es.amazonaws.com/_dashboardsion}.amazonaws.com/prod/query
- `DocumentsBucketName`: docintel-documents-{account}-{region}
- `MetadataTableName`: DocIntel-DocumentMetadata
- `JobsTableName`: DocIntel-ProcessingJobs
- `TextractCompletionTopicArn`: arn:aws:sns:...

## 🧪 End-to-End Test

### 1. Request Upload URL

```bash
# Save the UploadEndpoint from CDK outputs
export UPLOAD_ENDPOINT="https://xxx.execute-api.us-east-1.amazonaws.com/prod/upload"

# Request presigned URL
curl -X POST $UPLOAD_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "test-document.pdf",
    "contentType": "application/pdf"
  }' | jq .

# Expected response:
# {
#   "statusCode": 200,
#   "body": {
#     "uploadUrl": "https://s3.amazonaws.com/...",
#     "documentId": "uuid-here",
#     "expiresIn": 300
#   }
# }
```

### 2. Upload PDF to S3

```bash
# Save uploadUrl and documentId from previous response
export UPLOAD_URL="https://s3.amazonaws.com/..."
export DOCUMENT_ID="uuid-here"

# Upload a test PDF
curl -X PUT "$UPLOAD_URL" \
  -H "Content-Type: application/pdf" \
  --upload-file test-document.pdf

# HTTP 200 = success
```

### 3. Verify S3 Trigger

```bash
# Check if file exists in S3
aws s3 ls s3://docintel-documents-{account}-{region}/documents/$DOCUMENT_ID/

# Expected:
# test-document.pdf
```

### 4. Check DynamoDB Records

````bash
# Check DocumentMetadata table
aws dynamodb get-item \
  --table-name DocIntel-DocumentMetadata \
  --key "{\"documentId\": {\"S\": \"$DOCUMENT_ID\"}}" \
  | jq .

# Check ProcessingJobs table (should have 1 job)
aws dynamodb scan \
  --table-name DocIntel-ProcessingJobs \
  --filter-expression "documentId = :docId" \
  --expression-attribute-values "{\":docId\": {\"S\": \"$DOCUMENT_ID\"}}" \
  | jq .
### 5. Check CloudWatch Logs

```bash
# UploadHandler logs
aws logs tail /aws/lambda/DocIntel-UploadHandler --follow

# TextractStartHandler logs
aws logs tail /aws/lambda/DocIntel-TextractStartHandler --follow

# TextractCompleteHandler logs (processing results)
aws logs tail /aws/lambda/DocIntel-TextractCompleteHandler --follow

# QueryHandler logs (RAG inference)
aws logs tail /aws/lambda/DocIntel-QueryHandler --follow
### 6. Test Query Handler (RAG)

**OpenSearch is now included!** The domain is automatically configured and the Query Handler has access.

#### First: Create the Vector Index

```bash
# Get OpenSearch endpoint from CDK outputs
export OPENSEARCH_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name MinimalStack \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchDomainEndpoint`].OutputValue' \
  --output text)

# Create index with vector field (1024 dimensions for Titan V2)
curl -X PUT "https://$OPENSEARCH_ENDPOINT/docintel-vectors" \
  -H "Content-Type: application/json" \
  --aws-sigv4 "aws:amz:us-east-1:es" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -d '{
    "mappings": {
      "properties": {
        "chunkId": { "type": "keyword" },
        "documentId": { "type": "keyword" },
        "content": { "type": "text" },
        "embedding": {
          "type": "knn_vector",
          "dimension": 1024,
          "method": {
            "name": "hnsw",
            "space_type": "l2",
            "engine": "nmslib",
            "parameters": {
              "ef_construction": 128,
              "m": 16
            }
          }
        },
        "metadata": {
          "properties": {
            "page": { "type": "integer" },
            "documentId": { "type": "keyword" }
          }
        }
      }
    },
    "settings": {
      "index": {
        "knn": true,
        "number_of_shards": 1,
        "number_of_replicas": 0
      }
    }
  }'
````

#### Then: Query Your Documents

**Prerequisites**: OpenSearch domain with indexed document chunks

````bash
# Save the QueryEndpoint from CDK outputs
export QUERY_ENDPOINT="https://xxx.execute-api.us-east-1.amazonaws.com/prod/query"

# Ask a question about your documents
curl -X POST $QUERY_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the main topic of the document?"
  }' | jq .

# Expected response:
# {
#   "statusCode": 200,
#   "body": {
#     "answer": "Based on the documents, the main topic is...",
#     "sources": [
#       {
#         "chunkId": "uuid",
#         "documentId": "uuid",
#         "similarity": 0.89,
#         "pageNumber": 1,
#         "content": "excerpt from document..."
#       }
#     ],
#     "confidence": 0.89
#   }
# }

# Query with documentId filter (single document)
curl -X POST $QUERY_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Summarize the key points",
    "documentId": "your-document-id-here"
  }' | jq .
```extractStartHandler logs
aws logs tail /aws/lambda/DocIntel-TextractStartHandler --follow
````

## 📊 Monitoring

### Lambda Metrics

```bash
# Check invocation count
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=DocIntel-UploadHandler \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

### DynamoDB Metrics

```bash
# Check consumed read/write capacity
aws cloudwatch get-metric-statistics \
  --namespace AWS/DynamoDB \
  --metric-name ConsumedReadCapacityUnits \
  --dimensions Name=TableName,Value=DocIntel-DocumentMetadata \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-01T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

## 🔍 OpenSearch Configuration

**OpenSearch is included in the minimal stack!** A dev-optimized domain is automatically
deployed.

### Domain Specifications (Dev)

- **Instance**: 1x t3.small.search (single-AZ)
- **Storage**: 30GB GP3 EBS
- **Version**: OpenSearch 2.11
- **Cost**: ~$20/month
- **Access**: IAM-based (public endpoint)
- **Encryption**: At-rest and in-transit enabled

### Access the OpenSearch Dashboard

```bash
# Get dashboard URL from outputs
aws cloudformation describe-stacks \
  --stack-name MinimalStack \
  --query 'Stacks[0].Outputs[?OutputKey==`OpenSearchDashboardUrl`].OutputValue' \
  --output text

# Open in browser (requires AWS credentials)
```

### Production Upgrade Path

When ready for production, update the domain:

```bash
# Destroy stack (force, no confirmation)
cd infra
pnpm run destroy:minimal

# Verify deletion
aws cloudformation describe-stacks --stack-name MinimalStack
# Should return: Stack with id MinimalStack does not exist
```

## 🚨 Troubleshooting

### Build Errors

```bash
# Clean and rebuild
cd apps/api
pnpm clean
pnpm build

# Check handlers directory
ls build/handlers/
# Should see:
# - upload.handler.js
# - textract-start.handler.js
# - textract-complete.js
# - query.handler.js (NEW: RAG inference)
```

### CDK Errors

```bash
# Bootstrap CDK (first time only)
cd infra
cdk bootstrap

# Synthesize template (dry run)
pnpm run synth:minimal

# Check cdk.out/MinimalStack.template.json
```

### Lambda Invocation Errors

```bash
# Test Lambda directly
aws lambda invoke \
  --function-name DocIntel-UploadHandler \
  --payload '{"body": "{\"filename\":\"test.pdf\",\"contentType\":\"application/pdf\"}"}' \
  response.json

cat response.json
```

### S3 Trigger Not Firing

```bash
# Check S3 event configuration
aws s3api get-bucket-notification-configuration \
  --bucket docintel-documents-{account}-{region}

# Should show Lambda destination for ObjectCreated events
```

## 💡 Tips

- **Fast Iteration**: Build API once, deploy stack multiple times (CDK ~4 min)
- **Logs**: Use `--follow` flag with `aws logs tail` for real-time logs
- **Costs**: On-demand DynamoDB + S3 lifecycle + OpenSearch t3.small = ~$21/day
- **OpenSearch**: Included! Domain takes ~10 min to become active
- **Query Handler**: Create index first (see step 6), then test queries
- **RAG Testing**: Upload docs → Wait for Textract → Index chunks → Test queries
- **Production**: Change `removalPolicy` to `RETAIN` and enable PITR on DynamoDB
- **OpenSearch Cleanup**: Domain is destroyed with stack (removalPolicy: DESTROY)

## 📝 Handler Summary

| Handler          | Trigger     | Purpose                  | Memory | Timeout |
| ---------------- | ----------- | ------------------------ | ------ | ------- |
| Upload           | API Gateway | Generate presigned URLs  | 512MB  | 30s     |
| TextractStart    | S3 Event    | Start Textract jobs      | 512MB  | 60s     |
| TextractComplete | SNS         | Process Textract results | 1024MB | 300s    |
| Query            | API Gateway | RAG question-answering   | 1024MB | 60s     |

## 🏗️ Infrastructure Summary

| Component   | Specification             | Cost (Dev)             |
| ----------- | ------------------------- | ---------------------- | ------ | --- |
| S3 Bucket   | Standard, 7-day lifecycle | ~$0.10/day             |
| DynamoDB    | On-demand, 2 tables       | ~$0.10/day             |
| Lambda      | 4 functions, on-demand    | ~$0.05/day             |
| API Gateway | REST API, 100 req/s       | ~$0.05/day             |
| OpenSearch  | t3.small.search, 30GB     | ~$20/month             |
| SNS         | Topic + subscriptions     | ~$0.01/day             |
| **Total**   |                           | **~$21/month**         | 300s   |
| Query       | API Gateway               | RAG question-answering | 1024MB | 60s |

## 🔄 Processing Flow

```
1. Client → POST /upload → UploadHandler
   ↓
2. Client uploads PDF to S3 presigned URL
   ↓
3. S3 Event → TextractStartHandler → Textract API
   ↓
4. Textract completes → SNS → TextractCompleteHandler
   ↓
5. (Manual/Separate) Index chunks in OpenSearch
   ↓
6. Client → POST /query → QueryHandler → RAG Response
```

**Note**: Step 5 (indexing) is not automated in minimal stack. You'll need a separate
indexing Lambda or batch process.
