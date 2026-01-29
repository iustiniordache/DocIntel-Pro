# Web Deployment Summary

## ✅ Deployment Complete!

Your DocIntel Pro web application with Cognito authentication has been successfully
deployed to AWS.

### 🌐 Your Live Website

**CloudFront URL**: https://d1klr6giwlosct.cloudfront.net

### 📊 Deployed Resources

#### CloudFront Distribution

- **Distribution ID**: E10KZ8VOW3VOMD
- **Domain**: d1klr6giwlosct.cloudfront.net
- **Status**: Active
- **Cache**: Invalidated (may take 1-5 minutes to fully propagate)

#### S3 Bucket

- **Bucket Name**: docintel-web-000000000000-us-east-1
- **Files Uploaded**: 32 static files
- **Access**: Private (via CloudFront only)

#### API Gateway

- **Endpoint**: https://fdq0l5yuha.execute-api.us-east-1.amazonaws.com/prod/
- **Auth**: AWS Cognito JWT tokens

#### Cognito User Pool

- **User Pool ID**: us-east-1_cNIvA9K1J
- **Client ID**: 6fogchgm7vh05q0p2fm8b18eck
- **Region**: us-east-1

### 🧪 Testing Your Deployment

1. **Visit the Website**:

   ```
   https://d1klr6giwlosct.cloudfront.net
   ```

2. **Create an Account**:
   - Click "Sign up"
   - Enter your email and password
   - Password requirements:
     - Minimum 8 characters
     - At least one uppercase letter
     - At least one lowercase letter
     - At least one number
     - At least one special character

3. **Verify Your Email**:
   - Check your email inbox for verification code
   - Enter the 6-digit code in the confirmation form

4. **Login**:
   - Use your email and password to sign in
   - You'll be automatically logged in after verification

5. **Create a Workspace**:
   - Click "New Workspace" in the dropdown
   - Enter workspace name (e.g., "My Documents")
   - Add optional description
   - Click "Create Workspace"

6. **Upload a Document**:
   - Ensure a workspace is selected
   - Drag & drop a PDF file (up to 50MB)
   - Wait for processing to complete

7. **Query Your Documents**:
   - Type a question in the chat interface
   - Get AI-powered answers from your uploaded documents

### 🔧 Environment Configuration

The production build includes these environment variables:

```env
NEXT_PUBLIC_API_URL=https://fdq0l5yuha.execute-api.us-east-1.amazonaws.com/prod
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_cNIvA9K1J
NEXT_PUBLIC_COGNITO_CLIENT_ID=6fogchgm7vh05q0p2fm8b18eck
NEXT_PUBLIC_COGNITO_REGION=us-east-1
```

### 🔒 Security Features

✅ **HTTPS Only**: All traffic encrypted via CloudFront SSL ✅ **Cognito Authentication**:
JWT-based user authentication ✅ **API Authorization**: All API calls require valid JWT
tokens ✅ **Workspace Isolation**: Users can only access their own workspaces ✅ **S3
Security**: Direct bucket access blocked, CloudFront OAI only ✅ **Security Headers**:

- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Strict-Transport-Security: max-age=63072000
- X-XSS-Protection: 1; mode=block

### 📝 Next Steps

#### Update DNS (Optional)

To use a custom domain like `app.yourdomain.com`:

1. **Get SSL Certificate** (ACM):

   ```bash
   aws acm request-certificate \
     --domain-name app.yourdomain.com \
     --validation-method DNS \
     --region us-east-1
   ```

2. **Update Web Stack** (`infra/lib/web-stack.ts`):

   ```typescript
   import * as acm from 'aws-cdk-lib/aws-certificatemanager';

   // Add to stack constructor
   const certificate = acm.Certificate.fromCertificateArn(
     this,
     'Certificate',
     'arn:aws:acm:us-east-1:123456789012:certificate/xxx',
   );

   // Update CloudFront distribution
   this.distribution = new cloudfront.Distribution(this, 'Distribution', {
     // ... existing config
     certificate,
     domainNames: ['app.yourdomain.com'],
   });
   ```

3. **Create CNAME Record** in your DNS:

   ```
   app.yourdomain.com -> d1klr6giwlosct.cloudfront.net
   ```

4. **Redeploy**:
   ```bash
   cd infra
   npx cdk deploy DocIntelProWebStack
   ```

#### Monitor Usage

**CloudWatch Logs**:

- Lambda functions: `/aws/lambda/MinimalStack-*`
- API Gateway: Available in AWS Console

**Cognito Users**:

```bash
aws cognito-idp list-users \
  --user-pool-id us-east-1_cNIvA9K1J
```

**CloudFront Metrics**:

- Requests
- Error rates
- Cache hit ratio

#### Scale for Production

1. **DynamoDB**:
   - Current: On-demand pricing
   - Consider provisioned capacity for predictable workloads

2. **OpenSearch**:
   - Current: Development (single node)
   - Upgrade to multi-AZ for production

3. **S3 Lifecycle**:
   - Add lifecycle rules for old document versions
   - Consider S3 Intelligent-Tiering

4. **API Gateway**:
   - Add usage plans and API keys
   - Implement rate limiting
   - Add WAF for DDoS protection

5. **CloudFront**:
   - Add custom error pages
   - Configure geo-restrictions if needed
   - Add AWS WAF web ACL

### 🐛 Troubleshooting

#### Issue: "User not authenticated" after login

**Solution**:

- Clear browser localStorage
- Check Cognito User Pool settings
- Verify JWT token expiry (default: 1 hour)

#### Issue: Upload fails

**Solution**:

- Check workspace is selected
- Verify file size < 50MB
- Check S3 bucket permissions
- Review Lambda function logs

#### Issue: CloudFront shows old content

**Solution**:

```bash
aws cloudfront create-invalidation \
  --distribution-id E10KZ8VOW3VOMD \
  --paths "/*"
```

#### Issue: CORS errors

**Solution**:

- API Gateway CORS is configured
- Check browser dev console for specific error
- Verify API endpoint in environment variables

### 📊 Cost Estimate (Monthly)

**Assuming moderate usage** (1000 users, 10k documents, 100k queries/month):

| Service        | Estimated Cost      |
| -------------- | ------------------- |
| CloudFront     | $5-10               |
| S3 (Documents) | $10-20              |
| S3 (Website)   | $1-2                |
| DynamoDB       | $5-15               |
| Lambda         | $10-25              |
| OpenSearch     | $150-200            |
| Cognito        | Free (MAU < 50k)    |
| API Gateway    | $3-10               |
| **Total**      | **~$185-280/month** |

**Notes**:

- OpenSearch is the largest cost (can be optimized)
- Free tier covers many services for first 12 months
- On-demand pricing adjusts to actual usage

### 🔄 Redeploy After Changes

When you make frontend changes:

```bash
# 1. Build
cd apps/web
pnpm build

# 2. Deploy
cd ../infra
node scripts/deploy-web-content.js
```

When you make infrastructure changes:

```bash
cd infra
npx cdk deploy DocIntelProWebStack
```

When you make API changes:

```bash
cd apps/api
pnpm build

cd ../infra
npx cdk deploy MinimalStack
```

### 📚 Documentation References

- **AWS CDK**: https://docs.aws.amazon.com/cdk/
- **Next.js Static Export**:
  https://nextjs.org/docs/app/building-your-application/deploying/static-exports
- **AWS Cognito**: https://docs.aws.amazon.com/cognito/
- **CloudFront**: https://docs.aws.amazon.com/cloudfront/
- **API Gateway**: https://docs.aws.amazon.com/apigateway/

---

**Deployment Date**: January 28, 2026 **Status**: ✅ Live and Ready **Website**:
https://d1klr6giwlosct.cloudfront.net
