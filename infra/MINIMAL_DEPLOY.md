# Minimal Stack Deployment Guide

Ultra-fast deployment of DocIntel with 2 handlers only (Upload + TextractStart).

## ⚡ Quick Deploy (~5 minutes)

```bash
# 1. Build API handlers
cd apps/api
pnpm build

# 2. Deploy stack
cd ../../infra
pnpm run deploy:minimal
```

## 🏗️ Stack Components

### Infrastructure (5 resources)

- **S3 Bucket**: `docintel-documents-{account}-{region}`
  - 7-day lifecycle (dev)
  - Block public access
  - Encryption enabled

- **DynamoDB Tables** (2):
  - `DocIntel-DocumentMetadata` (PK: documentId)
  - `DocIntel-ProcessingJobs` (PK: jobId)
  - On-demand billing

- **Lambda Functions** (2):
  - `DocIntel-UploadHandler`: 512MB, 30s timeout
  - `DocIntel-TextractStartHandler`: 512MB, 60s timeout

- **API Gateway**:
  - REST API with CORS
  - POST /upload endpoint
  - Throttling: 100 req/s

### Outputs

After deployment, you'll get:

- `ApiEndpoint`: https://xxx.execute-api.{region}.amazonaws.com/prod/
- `UploadEndpoint`: https://xxx.execute-api.{region}.amazonaws.com/prod/upload
- `DocumentsBucketName`: docintel-documents-{account}-{region}
- `MetadataTableName`: DocIntel-DocumentMetadata
- `JobsTableName`: DocIntel-ProcessingJobs

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

```bash
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
```

### 5. Check CloudWatch Logs

```bash
# UploadHandler logs
aws logs tail /aws/lambda/DocIntel-UploadHandler --follow

# TextractStartHandler logs
aws logs tail /aws/lambda/DocIntel-TextractStartHandler --follow
```

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

## 🗑️ Cleanup

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

# Check dist/ folder
ls -la dist/
# Should see: handlers/upload.handler.js, handlers/textract-start.handler.js
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

- **Fast Iteration**: Build API once, deploy stack multiple times (CDK only takes ~2 min)
- **Logs**: Use `--follow` flag with `aws logs tail` for real-time logs
- **Costs**: On-demand DynamoDB + S3 lifecycle = ~$0.50/day with light usage
- **Production**: Change `removalPolicy` to `RETAIN` and enable PITR on DynamoDB
