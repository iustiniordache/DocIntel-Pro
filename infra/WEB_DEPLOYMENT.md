# Web App Deployment Guide

This guide covers deploying the DocIntel Pro web application to AWS using CDK.

## Architecture

The web stack includes:

- **S3 Bucket**: Stores static website files (Next.js build output)
- **CloudFront Distribution**: CDN for global content delivery
- **Origin Access Identity**: Secures S3 bucket access
- **Security Headers**: Best practice security headers
- **SPA Routing**: CloudFront function for client-side routing

## Prerequisites

1. AWS CLI configured with credentials
2. AWS CDK installed (`npm install -g aws-cdk`)
3. Next.js app built (`cd apps/web && pnpm build`)
4. Infrastructure dependencies installed (`cd infra && pnpm install`)

## Deployment Steps

### 1. Initial Infrastructure Deployment

Deploy the web stack (CloudFront + S3):

```bash
cd infra
pnpm build
pnpm deploy:web
```

This creates:

- S3 bucket for static files
- CloudFront distribution
- Security configurations
- Outputs: bucket name, distribution ID, website URL

**Note:** Initial deployment takes 5-10 minutes (CloudFront distribution creation).

### 2. Build the Next.js Application

```bash
cd apps/web
pnpm build
```

This creates the production build in `apps/web/.next/` or `apps/web/out/` (for static
export).

### 3. Upload Web Content

After building, upload the content to S3:

```bash
cd infra
pnpm deploy:web:content
```

This script:

1. Reads stack outputs (bucket name, distribution ID)
2. Uploads all files from Next.js build to S3
3. Sets appropriate cache headers
4. Invalidates CloudFront cache
5. Displays deployment URL

### 4. Access Your Website

After deployment completes, access your site at the CloudFront URL:

```
https://[DISTRIBUTION_ID].cloudfront.net
```

The URL is displayed in the deployment output.

## Quick Deploy Commands

### Full deployment (infrastructure + content):

```bash
cd infra
pnpm build
pnpm deploy:web
pnpm deploy:web:content
```

### Update content only (after code changes):

```bash
cd apps/web
pnpm build
cd ../../infra
pnpm deploy:web:content
```

### Check deployment status:

```bash
cd infra
pnpm cdk diff DocIntelProWebStack
```

## Configuration

### Environment Variables

Configure API URL for the web app in `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=https://[YOUR_API_GATEWAY_URL]/prod
```

To get your API Gateway URL:

```bash
aws cloudformation describe-stacks \
  --stack-name DocIntelProApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
```

### Next.js Configuration

The `next.config.js` already supports:

- Static file optimization
- Environment variable injection
- Transpilation of shared packages

For static export (optional), add to `apps/web/package.json`:

```json
{
  "scripts": {
    "build:static": "next build && next export"
  }
}
```

## CloudFront Configuration

### Cache Behavior

- **Static Assets** (`_next/static/*`): Cached for 1 year (immutable)
- **HTML/Dynamic**: No cache, always revalidate
- **Compression**: Gzip + Brotli enabled

### Security Headers

Automatically applied:

- `Strict-Transport-Security`: HSTS enabled
- `X-Content-Type-Options`: nosniff
- `X-Frame-Options`: DENY
- `X-XSS-Protection`: enabled
- `Referrer-Policy`: strict-origin-when-cross-origin

### SPA Routing

CloudFront function rewrites all non-file requests to `/index.html` for client-side
routing.

## Monitoring & Logs

### CloudFront Logs

Enable logging (optional):

```typescript
// In web-stack.ts
this.distribution = new cloudfront.Distribution(this, 'WebDistribution', {
  // ... existing config
  enableLogging: true,
  logBucket: loggingBucket,
  logFilePrefix: 'cloudfront-logs/',
});
```

### Real-time Monitoring

Access CloudFront metrics in AWS Console:

- Requests per minute
- Error rates (4xx, 5xx)
- Cache hit ratio
- Data transfer

## Troubleshooting

### Issue: 403 Forbidden

**Cause**: S3 bucket policy not allowing CloudFront access **Fix**: Redeploy the web stack

```bash
cd infra
pnpm deploy:web --require-approval never
```

### Issue: 404 on Refresh

**Cause**: CloudFront not rewriting to index.html **Fix**: Check the rewrite function is
deployed

### Issue: Stale Content

**Cause**: CloudFront cache not invalidated **Fix**: Manually invalidate:

```bash
aws cloudfront create-invalidation \
  --distribution-id [DISTRIBUTION_ID] \
  --paths "/*"
```

Or use the deployment script which auto-invalidates.

### Issue: Build Not Found

**Cause**: Next.js app not built before content deployment **Fix**:

```bash
cd apps/web
pnpm build
cd ../../infra
pnpm deploy:web:content
```

## Cost Optimization

### Development

- Use `PriceClass.PRICE_CLASS_100` (North America + Europe only)
- Short TTL for HTML files
- Destroy when not needed: `pnpm destroy:web`

### Production

- Upgrade to `PriceClass.PRICE_CLASS_ALL` for global coverage
- Enable access logs for analytics
- Set up CloudWatch alarms for errors
- Consider custom domain with Route53

## Custom Domain (Optional)

### 1. Request ACM Certificate

```bash
aws acm request-certificate \
  --domain-name yourdomain.com \
  --subject-alternative-names www.yourdomain.com \
  --validation-method DNS \
  --region us-east-1
```

**Note**: Certificate must be in `us-east-1` for CloudFront.

### 2. Update Web Stack

In `web-stack.ts`:

```typescript
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

// Reference existing certificate
const certificate = acm.Certificate.fromCertificateArn(
  this,
  'Certificate',
  'arn:aws:acm:us-east-1:ACCOUNT:certificate/CERT_ID',
);

// Add to distribution config
this.distribution = new cloudfront.Distribution(this, 'WebDistribution', {
  // ... existing config
  certificate,
  domainNames: ['yourdomain.com', 'www.yourdomain.com'],
});

// Create Route53 alias record (if hosted zone exists)
const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
  domainName: 'yourdomain.com',
});

new route53.ARecord(this, 'AliasRecord', {
  zone: hostedZone,
  recordName: 'yourdomain.com',
  target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution)),
});
```

### 3. Redeploy

```bash
cd infra
pnpm build
pnpm deploy:web
```

## Cleanup

### Remove web stack and all resources:

```bash
cd infra
pnpm destroy:web
```

This deletes:

- CloudFront distribution
- S3 bucket and all contents
- CloudFront functions
- Security policies

**Note**: CloudFront deletion takes 15-30 minutes.

## Next Steps

1. Set up CI/CD pipeline (GitHub Actions, CodePipeline)
2. Configure custom domain
3. Enable CloudFront access logs
4. Set up monitoring dashboards
5. Configure WAF for security
6. Add authentication (Cognito, Auth0)

## Support

For issues or questions:

- Check AWS CloudFormation events for deployment errors
- Review CloudFront distribution settings in AWS Console
- Check S3 bucket contents and permissions
- Verify Next.js build output exists

## Additional Resources

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [CloudFront Developer Guide](https://docs.aws.amazon.com/cloudfront/)
- [Next.js Deployment](https://nextjs.org/docs/deployment)
- [S3 Static Website Hosting](https://docs.aws.amazon.com/s3/latest/userguide/WebsiteHosting.html)
