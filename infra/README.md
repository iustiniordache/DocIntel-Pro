# DocIntel Pro - Infrastructure

AWS CDK infrastructure for DocIntel Pro document processing platform.

## 📋 Overview

This directory contains AWS CDK code to deploy the entire DocIntel Pro infrastructure:

- **API Stack**: Lambda functions, API Gateway, authentication
- **Storage Stack**: S3 buckets, DynamoDB tables, OpenSearch
- **Web Stack**: CloudFront distribution, S3 static hosting
- **Minimal Stack**: Lightweight deployment for testing

## 🚀 Quick Start

### Deploy Web Application

```bash
# 1. Install dependencies
pnpm install

# 2. Build and deploy infrastructure
pnpm build
pnpm deploy:web

# 3. Build and upload web content
pnpm deploy:web:content
```

### Deploy API

```bash
# Build API code
pnpm build:api

# Deploy API stack
pnpm deploy:api
```

### Deploy Everything

```bash
# Deploy all stacks
pnpm deploy
```

## 📁 Project Structure

```
infra/
├── bin/
│   └── cdk.ts                    # CDK app entry point
├── lib/
│   ├── api-stack.ts              # API Lambda + API Gateway
│   ├── storage-stack.ts          # S3 + DynamoDB + OpenSearch
│   └── web-stack.ts              # CloudFront + S3 (static site)
├── stacks/
│   └── minimal-stack.ts          # Minimal deployment (testing)
├── scripts/
│   └── deploy-web-content.js     # Web content deployment script
├── cdk.json                      # CDK configuration
└── package.json                  # Scripts and dependencies
```

## 🛠️ Available Commands

### Build & Compile

```bash
pnpm build              # Compile TypeScript
pnpm watch              # Watch mode for TypeScript
pnpm typecheck          # Type check without building
pnpm clean              # Clean build artifacts
```

### Deployment

```bash
# Web Stack
pnpm deploy:web                 # Deploy CloudFront + S3
pnpm deploy:web:content         # Build & upload Next.js app
pnpm build:web                  # Build Next.js app only

# API Stack
pnpm deploy:api                 # Deploy API Gateway + Lambda
pnpm build:api                  # Build API Lambda code

# Storage Stack
pnpm deploy:storage             # Deploy S3 + DynamoDB + OpenSearch

# Minimal Stack (testing)
pnpm deploy:minimal             # Deploy minimal resources

# All Stacks
pnpm deploy                     # Deploy everything
```

### CDK Operations

```bash
pnpm synth              # Generate CloudFormation templates
pnpm synth:web          # Generate web stack template
pnpm synth:minimal      # Generate minimal stack template

pnpm diff               # Show changes to deploy
pnpm diff:web           # Show web stack changes

pnpm destroy            # Delete all stacks
pnpm destroy:web        # Delete web stack
pnpm destroy:minimal    # Delete minimal stack
```

## 🏗️ Infrastructure Stacks

### Web Stack (`DocIntelProWebStack`)

**Purpose**: Host Next.js web application

**Resources**:

- S3 bucket (private, stores static files)
- CloudFront distribution (CDN, HTTPS)
- Origin Access Identity (secure S3 access)
- CloudFront Functions (SPA routing)
- Security headers policies

**Outputs**:

- Website URL
- CloudFront Distribution ID
- S3 Bucket Name

**Cost**: ~$1-5/month (development), ~$50-200/month (production)

### API Stack (`DocIntelProApiStack`)

**Purpose**: Backend API for document processing

**Resources**:

- Lambda function (Node.js 20)
- API Gateway (REST API)
- IAM roles and policies
- CloudWatch Logs

**Dependencies**: Storage Stack (S3, DynamoDB)

**Cost**: ~$5-50/month (based on usage)

### Storage Stack (`DocIntelProStorageStack`)

**Purpose**: Data storage and search

**Resources**:

- S3 bucket (document storage)
- DynamoDB tables (metadata, jobs)
- OpenSearch domain (vector search)
- SNS topics (notifications)

**Cost**: ~$50-500/month (OpenSearch is primary cost)

### Minimal Stack (`MinimalStack`)

**Purpose**: Fast testing deployment (upload + Textract only)

**Resources**:

- Subset of full stack
- Upload handler
- TextractStart handler
- Essential S3/DynamoDB

**Cost**: ~$10-30/month

## ⚙️ Configuration

### Environment Variables

Create `.env.development` in project root:

```env
# AWS Configuration
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1

# API Configuration
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# OpenSearch Configuration
OPENSEARCH_DOMAIN=docintel-search
OPENSEARCH_INDEX_NAME=documents

# Bedrock Configuration
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
BEDROCK_LLM_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
```

### AWS Credentials

Configure AWS CLI:

```bash
aws configure
```

Or use environment variables:

```bash
export AWS_ACCESS_KEY_ID=your-key
export AWS_SECRET_ACCESS_KEY=your-secret
export AWS_REGION=us-east-1
```

### CDK Bootstrap

First-time setup (per account/region):

```bash
cdk bootstrap aws://ACCOUNT-ID/REGION
```

## 📦 Dependencies

### Runtime Dependencies

- `aws-cdk-lib`: AWS CDK v2 library
- `constructs`: CDK constructs
- `@aws-sdk/client-s3`: S3 operations
- `@aws-sdk/client-cloudfront`: CloudFront operations
- `@aws-sdk/client-cloudformation`: Stack queries
- `mime-types`: Content-Type detection

### Development Dependencies

- `typescript`: TypeScript compiler
- `aws-cdk`: CDK CLI
- `@types/node`: Node.js type definitions

## 🔧 Customization

### Custom Domain

To add a custom domain, create an ACM certificate in us-east-1 and update the web-stack.ts
with the domain configuration.

### Environment-Specific Stacks

Create separate stacks for staging/production:

```typescript
// In bin/cdk.ts
new DocIntelProWebStack(app, 'DocIntelProWebStack-Staging', {
  env: { account: '111', region: 'us-east-1' },
  // ... staging config
});

new DocIntelProWebStack(app, 'DocIntelProWebStack-Production', {
  env: { account: '222', region: 'us-east-1' },
  // ... production config
});
```

### Modify Cache Settings

Edit `lib/web-stack.ts`:

```typescript
// Longer cache for static assets
cachePolicy: new cloudfront.CachePolicy(this, 'CustomCachePolicy', {
  defaultTtl: cdk.Duration.days(30),
  maxTtl: cdk.Duration.days(365),
}),
```

## 🐛 Troubleshooting

### "Stack does not exist"

**Cause**: Stack not yet deployed **Fix**:

```bash
pnpm build
pnpm deploy:web
```

### "Credential error"

**Cause**: AWS credentials not configured **Fix**:

```bash
aws configure
```

### "Bootstrap required"

**Cause**: CDK not bootstrapped in account/region **Fix**:

```bash
cdk bootstrap
```

### Build Errors

```bash
# Clean and rebuild
pnpm clean
rm -rf node_modules
pnpm install
pnpm build
```

## 📊 Monitoring

### CloudFormation Console

View stack status:

```
AWS Console → CloudFormation → Stacks → [StackName]
```

### CloudWatch Metrics

- Lambda execution times
- API Gateway requests
- CloudFront cache hit ratio
- S3 storage usage

### Cost Explorer

Monitor AWS costs:

```
AWS Console → Billing → Cost Explorer
```

## 🔐 Security

### IAM Roles

- Principle of least privilege
- Separate roles per service
- No hardcoded credentials

### S3 Buckets

- Block public access enabled
- Server-side encryption (SSE-S3)
- Versioning (optional for production)

### CloudFront

- HTTPS only (redirect HTTP)
- Security headers enabled
- Origin Access Identity (no direct S3 access)

### API Gateway

- CloudWatch logging enabled
- Request throttling configured
- CORS properly configured

## 🚨 Disaster Recovery

### Backup

```bash
# Export CloudFormation templates
pnpm synth

# Backup to S3
aws s3 sync cdk.out s3://backup-bucket/cdk-templates/
```

### Restore

```bash
# Redeploy from code
pnpm deploy

# Or import from backup
aws cloudformation create-stack --template-body file://template.json
```

## 📚 Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [CloudFront Best Practices](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/best-practices.html)
- [Next.js Deployment](https://nextjs.org/docs/deployment)

## 🤝 Contributing

When modifying infrastructure:

1. Test locally: `pnpm build && pnpm synth`
2. Preview changes: `pnpm diff`
3. Deploy to staging first
4. Document changes in commit message
5. Update relevant markdown docs

## 📝 License

Private - DocIntel Pro
