# Quick Start: Web App Deployment

Deploy the DocIntel Pro web application to AWS CloudFront + S3 in 3 steps.

## Prerequisites

- AWS CLI configured with credentials
- Node.js and pnpm installed
- AWS CDK installed globally: `npm install -g aws-cdk`

## Step 1: Install Dependencies

```bash
# From project root
pnpm install

# Install AWS SDK dependencies for deployment script
cd infra
pnpm install
```

## Step 2: Deploy Infrastructure

```bash
cd infra
pnpm build
pnpm deploy:web
```

**Time**: 5-10 minutes (CloudFront distribution creation)

This creates:

- S3 bucket for website files
- CloudFront distribution with security headers
- Origin Access Identity for secure S3 access

**Output**: CloudFront URL will be displayed (e.g.,
`https://d111111abcdef8.cloudfront.net`)

## Step 3: Deploy Web Content

```bash
# Still in infra directory
pnpm deploy:web:content
```

This will:

1. Build the Next.js app
2. Upload files to S3
3. Invalidate CloudFront cache
4. Display the website URL

**Time**: 1-2 minutes

## Access Your Site

Visit the CloudFront URL displayed in the output:

```
https://[DISTRIBUTION_ID].cloudfront.net
```

## Update After Code Changes

```bash
cd infra
pnpm deploy:web:content
```

This rebuilds and redeploys only the web content (no infrastructure changes).

## Configuration

### Set API URL

Create `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=https://your-api-gateway-url.amazonaws.com/prod
```

Get your API Gateway URL from CloudFormation outputs or run:

```bash
aws cloudformation describe-stacks --stack-name DocIntelProApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' --output text
```

Then redeploy:

```bash
cd infra
pnpm deploy:web:content
```

## Troubleshooting

### Build Fails

**Error**: "No build output found"

```bash
cd apps/web
pnpm install
pnpm build
```

### 403 Errors

**Cause**: S3 permissions issue **Fix**: Redeploy infrastructure

```bash
cd infra
pnpm deploy:web
```

### Stale Content

**Cause**: CloudFront cache **Fix**: Content deployment script auto-invalidates cache.
Wait 1-2 minutes.

## Cleanup

Remove all web resources:

```bash
cd infra
pnpm destroy:web
```

**Note**: CloudFront deletion takes 15-30 minutes.

## Next Steps

- Configure custom domain (see WEB_DEPLOYMENT.md)
- Set up CI/CD pipeline
- Enable CloudFront logging
- Add WAF protection

## Full Documentation

See [WEB_DEPLOYMENT.md](./WEB_DEPLOYMENT.md) for complete deployment guide.

## Common Commands

| Command                   | Description                      |
| ------------------------- | -------------------------------- |
| `pnpm deploy:web`         | Deploy/update infrastructure     |
| `pnpm deploy:web:content` | Build and deploy web content     |
| `pnpm diff:web`           | Preview infrastructure changes   |
| `pnpm synth:web`          | Generate CloudFormation template |
| `pnpm destroy:web`        | Delete all web resources         |

## Architecture

```
┌──────────────┐
│   Internet   │
└──────┬───────┘
       │
       │ HTTPS
       ▼
┌──────────────────┐
│   CloudFront     │ ◄── Security Headers
│   Distribution   │ ◄── SPA Routing
└──────┬───────────┘ ◄── Cache (TTL)
       │
       │ OAI
       ▼
┌──────────────────┐
│   S3 Bucket      │
│   (Private)      │ ◄── Static Files (.html, .js, .css, etc)
└──────────────────┘
```

## Estimated Costs

**Development** (100 requests/day):

- CloudFront: ~$0.50/month
- S3 Storage: ~$0.02/month
- Data Transfer: ~$0.50/month
- **Total**: ~$1/month

**Production** (10,000 requests/day):

- CloudFront: ~$50/month
- S3 Storage: ~$0.20/month
- Data Transfer: ~$100/month
- **Total**: ~$150/month

_Costs vary by region and usage_
