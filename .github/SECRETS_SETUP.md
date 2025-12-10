# GitHub Secrets Setup Instructions

This document provides instructions for configuring GitHub secrets required for the CI/CD
pipeline.

## 📋 Overview

The CI/CD pipeline requires several secrets to authenticate with AWS and send
notifications. Follow these instructions to set them up.

## 🔐 Required Secrets

### AWS Authentication (OIDC - Recommended)

#### 1. `AWS_ROLE_ARN_STAGING`

**Description**: AWS IAM Role ARN for staging environment deployments

**Value Format**: `arn:aws:iam::123456789012:role/GitHubActionsRole-Staging`

**How to Create**:

```bash
# Create IAM OIDC Identity Provider (one-time setup)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create IAM Role for staging
cat > trust-policy-staging.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:*"
        }
      }
    }
  ]
}
EOF

# Replace ACCOUNT_ID, OWNER, and REPO
aws iam create-role \
  --role-name GitHubActionsRole-Staging \
  --assume-role-policy-document file://trust-policy-staging.json

# Attach necessary policies
aws iam attach-role-policy \
  --role-name GitHubActionsRole-Staging \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**Add to GitHub**:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
Name: AWS_ROLE_ARN_STAGING
Value: arn:aws:iam::123456789012:role/GitHubActionsRole-Staging
```

#### 2. `AWS_ROLE_ARN_PRODUCTION`

**Description**: AWS IAM Role ARN for production environment deployments

**Value Format**: `arn:aws:iam::123456789012:role/GitHubActionsRole-Production`

**How to Create**: Same as staging, but use different role name:

```bash
# Create trust policy for production
cat > trust-policy-production.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:OWNER/REPO:ref:refs/heads/main"
        }
      }
    }
  ]
}
EOF

aws iam create-role \
  --role-name GitHubActionsRole-Production \
  --assume-role-policy-document file://trust-policy-production.json

aws iam attach-role-policy \
  --role-name GitHubActionsRole-Production \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**Add to GitHub**:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
Name: AWS_ROLE_ARN_PRODUCTION
Value: arn:aws:iam::987654321098:role/GitHubActionsRole-Production
```

### Alternative: AWS Access Keys (Less Secure)

If you prefer to use access keys instead of OIDC:

#### `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

```bash
# Create IAM user
aws iam create-user --user-name github-actions

# Create access key
aws iam create-access-key --user-name github-actions

# Attach policies
aws iam attach-user-policy \
  --user-name github-actions \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

Add both secrets to GitHub.

### Application Configuration

#### 3. `NEXT_PUBLIC_API_URL`

**Description**: API Gateway URL for Next.js frontend

**Value Format**: `https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod`

**How to Get**:

```bash
# After deploying API stack
aws cloudformation describe-stacks \
  --stack-name DocIntelProApiStack \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
```

**Add to GitHub**:

```
Name: NEXT_PUBLIC_API_URL
Value: https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod
```

### Notifications (Optional)

#### 4. `SLACK_WEBHOOK_URL`

**Description**: Slack webhook URL for deployment notifications

**How to Create**:

1. Go to https://api.slack.com/apps
2. Create a new app or select existing
3. Enable "Incoming Webhooks"
4. Create webhook for your channel
5. Copy webhook URL

**Value Format**:
`https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX`

**Add to GitHub**:

```
Name: SLACK_WEBHOOK_URL
Value: https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

#### 5. `NOTIFICATION_EMAIL`

**Description**: Email address for deployment notifications

**Value Format**: `devops@yourcompany.com`

**Add to GitHub**:

```
Name: NOTIFICATION_EMAIL
Value: devops@yourcompany.com
```

**Note**: Requires mail server configuration or AWS SES setup.

### Code Coverage (Optional)

#### 6. `CODECOV_TOKEN`

**Description**: Codecov token for coverage reports

**How to Get**:

1. Sign up at https://codecov.io
2. Add your repository
3. Copy the token

**Add to GitHub**:

```
Name: CODECOV_TOKEN
Value: your-codecov-token
```

## 🔧 Setup Steps

### 1. Configure AWS OIDC (Recommended)

This is the most secure method and doesn't require long-lived access keys.

```bash
# Run the OIDC setup script
cd scripts
./setup-github-oidc.sh
```

Or follow the manual steps above.

### 2. Add Secrets to GitHub

Navigate to your repository:

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

Add each secret one by one.

### 3. Configure GitHub Environments

Create two environments for manual approval gates:

#### Staging Environment

```
Repository → Settings → Environments → New environment
Name: staging
```

No deployment protection rules needed (auto-deploy).

#### Production Environment

```
Repository → Settings → Environments → New environment
Name: production

Protection rules:
✅ Required reviewers: [Add team members]
✅ Wait timer: 0 minutes (or set delay)
```

This ensures production deployments require manual approval.

## ✅ Verification

After adding secrets, verify they're configured:

```
Repository → Settings → Secrets and variables → Actions
```

You should see:

- ✅ `AWS_ROLE_ARN_STAGING`
- ✅ `AWS_ROLE_ARN_PRODUCTION`
- ✅ `NEXT_PUBLIC_API_URL`
- ✅ `SLACK_WEBHOOK_URL` (optional)
- ✅ `NOTIFICATION_EMAIL` (optional)
- ✅ `CODECOV_TOKEN` (optional)

## 🧪 Test the Pipeline

Trigger a test run:

```bash
# Make a small change
git checkout -b test-pipeline
echo "test" >> README.md
git add README.md
git commit -m "test: trigger pipeline"
git push origin test-pipeline

# Create PR
gh pr create --title "Test CI/CD Pipeline" --body "Testing automated pipeline"
```

The pipeline should:

1. ✅ Run linting
2. ✅ Run tests
3. ✅ Build applications
4. ✅ Synthesize CDK templates
5. ⏸️ Wait for merge to deploy

## 🔒 Security Best Practices

### 1. Use OIDC Instead of Access Keys

OIDC provides temporary credentials and is more secure than long-lived access keys.

### 2. Principle of Least Privilege

Instead of `AdministratorAccess`, create a custom policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "cloudformation:*",
        "s3:*",
        "lambda:*",
        "apigateway:*",
        "iam:*",
        "cloudfront:*",
        "dynamodb:*",
        "opensearch:*",
        "sns:*",
        "logs:*"
      ],
      "Resource": "*"
    }
  ]
}
```

### 3. Use Environment-Specific Roles

Separate roles for staging and production prevent accidental production deployments.

### 4. Rotate Secrets Regularly

If using access keys, rotate them every 90 days:

```bash
# Deactivate old key
aws iam update-access-key \
  --access-key-id OLD_KEY_ID \
  --status Inactive \
  --user-name github-actions

# Create new key
aws iam create-access-key --user-name github-actions

# Update GitHub secret
# Delete old key
aws iam delete-access-key \
  --access-key-id OLD_KEY_ID \
  --user-name github-actions
```

### 5. Audit Secret Access

Monitor secret usage:

```
Repository → Settings → Secrets and variables → Actions → Audit log
```

## 🛠️ Troubleshooting

### "Error: Unable to assume role"

**Cause**: OIDC trust policy incorrect or role doesn't exist

**Fix**:

1. Verify role ARN is correct
2. Check trust policy allows your repository
3. Ensure OIDC provider is created

```bash
# List OIDC providers
aws iam list-open-id-connect-providers

# Get role trust policy
aws iam get-role --role-name GitHubActionsRole-Staging \
  --query 'Role.AssumeRolePolicyDocument'
```

### "Secret not found"

**Cause**: Secret name mismatch or not added to GitHub

**Fix**:

1. Check secret name matches workflow exactly (case-sensitive)
2. Verify secret is in correct repository
3. Ensure secret is not in environment (if not using environments)

### "Insufficient permissions"

**Cause**: IAM role doesn't have required permissions

**Fix**:

```bash
# Attach additional policies
aws iam attach-role-policy \
  --role-name GitHubActionsRole-Staging \
  --policy-arn arn:aws:iam::aws:policy/SERVICE_POLICY
```

### Slack notifications not working

**Cause**: Webhook URL invalid or expired

**Fix**:

1. Test webhook manually:

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"Test message"}' \
  YOUR_WEBHOOK_URL
```

2. Regenerate webhook in Slack if needed
3. Update GitHub secret

## 📚 Additional Resources

- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [AWS OIDC with GitHub Actions](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [Slack Incoming Webhooks](https://api.slack.com/messaging/webhooks)
- [Codecov Documentation](https://docs.codecov.com/docs)

## 🎯 Quick Reference

| Secret                    | Required | Description         | Example                         |
| ------------------------- | -------- | ------------------- | ------------------------------- |
| `AWS_ROLE_ARN_STAGING`    | ✅ Yes   | Staging AWS role    | `arn:aws:iam::123...:role/...`  |
| `AWS_ROLE_ARN_PRODUCTION` | ✅ Yes   | Production AWS role | `arn:aws:iam::123...:role/...`  |
| `NEXT_PUBLIC_API_URL`     | ✅ Yes   | API Gateway URL     | `https://...amazonaws.com/prod` |
| `SLACK_WEBHOOK_URL`       | ❌ No    | Slack webhook       | `https://hooks.slack.com/...`   |
| `NOTIFICATION_EMAIL`      | ❌ No    | Email for alerts    | `devops@company.com`            |
| `CODECOV_TOKEN`           | ❌ No    | Coverage reporting  | `abc123...`                     |

---

**Last Updated**: December 10, 2025 **Pipeline Version**: 1.0.0
