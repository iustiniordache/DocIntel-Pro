#!/bin/bash

# GitHub OIDC Setup Script for AWS
# This script configures AWS IAM for GitHub Actions OIDC authentication

set -e

echo "🔐 GitHub Actions OIDC Setup for AWS"
echo "===================================="
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install it first."
    exit 1
fi

# Prompt for repository information
read -p "Enter your GitHub repository (format: owner/repo): " GITHUB_REPO
read -p "Enter your AWS account ID: " AWS_ACCOUNT_ID
read -p "Enter AWS region [us-east-1]: " AWS_REGION
AWS_REGION=${AWS_REGION:-us-east-1}

echo ""
echo "Configuration:"
echo "  Repository: $GITHUB_REPO"
echo "  Account ID: $AWS_ACCOUNT_ID"
echo "  Region: $AWS_REGION"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Step 1: Create OIDC Identity Provider
echo ""
echo "📋 Step 1: Creating OIDC Identity Provider..."

PROVIDER_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" &> /dev/null; then
    echo "✅ OIDC provider already exists"
else
    aws iam create-open-id-connect-provider \
        --url https://token.actions.githubusercontent.com \
        --client-id-list sts.amazonaws.com \
        --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
        --region $AWS_REGION
    
    echo "✅ OIDC provider created"
fi

# Step 2: Create Staging Role
echo ""
echo "📋 Step 2: Creating Staging IAM Role..."

cat > /tmp/trust-policy-staging.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
        }
      }
    }
  ]
}
EOF

STAGING_ROLE_NAME="GitHubActionsRole-Staging"

if aws iam get-role --role-name "$STAGING_ROLE_NAME" &> /dev/null; then
    echo "⚠️  Staging role already exists, updating trust policy..."
    aws iam update-assume-role-policy \
        --role-name "$STAGING_ROLE_NAME" \
        --policy-document file:///tmp/trust-policy-staging.json
else
    aws iam create-role \
        --role-name "$STAGING_ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy-staging.json \
        --description "GitHub Actions role for staging deployments"
    
    echo "✅ Staging role created"
fi

# Attach policies to staging role
echo "   Attaching policies to staging role..."
aws iam attach-role-policy \
    --role-name "$STAGING_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

STAGING_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STAGING_ROLE_NAME}"
echo "✅ Staging role configured: $STAGING_ROLE_ARN"

# Step 3: Create Production Role
echo ""
echo "📋 Step 3: Creating Production IAM Role..."

cat > /tmp/trust-policy-production.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:ref:refs/heads/main"
        }
      }
    }
  ]
}
EOF

PRODUCTION_ROLE_NAME="GitHubActionsRole-Production"

if aws iam get-role --role-name "$PRODUCTION_ROLE_NAME" &> /dev/null; then
    echo "⚠️  Production role already exists, updating trust policy..."
    aws iam update-assume-role-policy \
        --role-name "$PRODUCTION_ROLE_NAME" \
        --policy-document file:///tmp/trust-policy-production.json
else
    aws iam create-role \
        --role-name "$PRODUCTION_ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy-production.json \
        --description "GitHub Actions role for production deployments"
    
    echo "✅ Production role created"
fi

# Attach policies to production role
echo "   Attaching policies to production role..."
aws iam attach-role-policy \
    --role-name "$PRODUCTION_ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

PRODUCTION_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PRODUCTION_ROLE_NAME}"
echo "✅ Production role configured: $PRODUCTION_ROLE_ARN"

# Cleanup
rm /tmp/trust-policy-staging.json
rm /tmp/trust-policy-production.json

# Summary
echo ""
echo "✨ Setup Complete!"
echo "================="
echo ""
echo "Add these secrets to your GitHub repository:"
echo ""
echo "1. AWS_ROLE_ARN_STAGING"
echo "   Value: $STAGING_ROLE_ARN"
echo ""
echo "2. AWS_ROLE_ARN_PRODUCTION"
echo "   Value: $PRODUCTION_ROLE_ARN"
echo ""
echo "📖 How to add secrets:"
echo "   1. Go to https://github.com/$GITHUB_REPO/settings/secrets/actions"
echo "   2. Click 'New repository secret'"
echo "   3. Add each secret with the name and value above"
echo ""
echo "⚠️  Security Note:"
echo "   These roles have AdministratorAccess. For production, consider"
echo "   using a custom policy with minimal required permissions."
echo ""
echo "📚 Full documentation: .github/SECRETS_SETUP.md"
