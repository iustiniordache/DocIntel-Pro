# 🚀 Quick Deploy Commands

## One-Command Deploy

```bash
# From project root
pnpm --filter api build && pnpm --filter infra deploy:minimal
```

## Step-by-Step Deploy

```bash
# 1. Build API handlers
cd apps/api
pnpm build

# 2. Deploy infrastructure
cd ../../infra
pnpm run deploy:minimal
```

## Verify Deployment

```bash
# Check stack status
aws cloudformation describe-stacks --stack-name MinimalStack --query 'Stacks[0].StackStatus'

# Get outputs
aws cloudformation describe-stacks --stack-name MinimalStack --query 'Stacks[0].Outputs'
```

## Test Upload Endpoint

```bash
# Get the upload endpoint from CDK outputs
export UPLOAD_URL=$(aws cloudformation describe-stacks --stack-name MinimalStack --query 'Stacks[0].Outputs[?OutputKey==`UploadEndpoint`].OutputValue' --output text)

# Request presigned URL
curl -X POST $UPLOAD_URL \
  -H "Content-Type: application/json" \
  -d '{"filename":"test.pdf","contentType":"application/pdf"}' \
  | jq .
```

## Cleanup

```bash
cd infra
pnpm run destroy:minimal
```

## Troubleshooting

### Check Lambda Logs

```bash
aws logs tail /aws/lambda/DocIntel-UploadHandler --follow
aws logs tail /aws/lambda/DocIntel-TextractStartHandler --follow
```

### Check DynamoDB Tables

```bash
aws dynamodb list-tables --query 'TableNames[?starts_with(@, `DocIntel-`)]'
```

### Check S3 Bucket

```bash
aws s3 ls | grep docintel-documents
```

## Resources Created

- **S3 Bucket**: `docintel-documents-{account}-{region}`
- **DynamoDB Tables**:
  - `DocIntel-DocumentMetadata`
  - `DocIntel-ProcessingJobs`
- **Lambda Functions**:
  - `DocIntel-UploadHandler` (512MB, 30s timeout)
  - `DocIntel-TextractStartHandler` (512MB, 60s timeout)
- **API Gateway**: `DocIntel API` with `/upload` endpoint

## Deployment Time

- **First Deploy**: ~5-7 minutes (includes Lambda asset upload)
- **Subsequent Deploys**: ~2-3 minutes (if Lambda code unchanged)
