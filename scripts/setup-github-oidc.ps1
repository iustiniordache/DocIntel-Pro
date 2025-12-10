# GitHub OIDC Setup Script for AWS (PowerShell)
# This script configures AWS IAM for GitHub Actions OIDC authentication

$ErrorActionPreference = "Stop"

Write-Host "GitHub Actions OIDC Setup for AWS" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check if AWS CLI is installed
try {
    $null = Get-Command aws -ErrorAction Stop
} catch {
    Write-Host "AWS CLI not found. Please install it first." -ForegroundColor Red
    Write-Host "Download from: https://aws.amazon.com/cli/" -ForegroundColor Yellow
    exit 1
}

# Check AWS credentials
try {
    $callerIdentity = aws sts get-caller-identity 2>&1 | ConvertFrom-Json
    Write-Host "AWS CLI configured for account: $($callerIdentity.Account)" -ForegroundColor Green
} catch {
    Write-Host "AWS CLI not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}

# Prompt for repository information
$GITHUB_REPO = Read-Host 'Enter your GitHub repository (format owner/repo)'
$AWS_ACCOUNT_ID = Read-Host 'Enter your AWS account ID'
$AWS_REGION = Read-Host 'Enter AWS region [us-east-1]'
if ([string]::IsNullOrWhiteSpace($AWS_REGION)) {
    $AWS_REGION = "us-east-1"
}

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Repository: $GITHUB_REPO" -ForegroundColor Yellow
Write-Host "  Account ID: $AWS_ACCOUNT_ID" -ForegroundColor Yellow
Write-Host "  Region: $AWS_REGION" -ForegroundColor Yellow
Write-Host ""
$continue = Read-Host 'Continue? (y or n)'
if ($continue -ne "y" -and $continue -ne "Y") {
    exit 0
}

# Step 1: Create OIDC Identity Provider
Write-Host ""
Write-Host "Step 1: Creating OIDC Identity Provider..." -ForegroundColor Cyan

$PROVIDER_ARN = "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

try {
    $null = aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$PROVIDER_ARN" 2>&1
    Write-Host "OIDC provider already exists" -ForegroundColor Green
} catch {
    aws iam create-open-id-connect-provider `
        --url https://token.actions.githubusercontent.com `
        --client-id-list sts.amazonaws.com `
        --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 `
        --region $AWS_REGION
    
    Write-Host "OIDC provider created" -ForegroundColor Green
}

# Step 2: Create Staging Role
Write-Host ""
Write-Host "Step 2: Creating Staging IAM Role..." -ForegroundColor Cyan

# Create trust policy JSON
$stagingJson = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Federated = "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
            }
            Action = "sts:AssumeRoleWithWebIdentity"
            Condition = @{
                StringEquals = @{
                    "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
                }
                StringLike = @{
                    "token.actions.githubusercontent.com:sub" = "repo:${GITHUB_REPO}:*"
                }
            }
        }
    )
}

$tempStagingFile = Join-Path $env:TEMP "trust-policy-staging.json"
$stagingJson | ConvertTo-Json -Depth 10 | Out-File -FilePath $tempStagingFile -Encoding ascii -NoNewline

$STAGING_ROLE_NAME = "GitHubActionsRole-Staging"

try {
    $null = aws iam get-role --role-name "$STAGING_ROLE_NAME" 2>&1
    Write-Host "Staging role already exists, updating trust policy..." -ForegroundColor Yellow
    aws iam update-assume-role-policy `
        --role-name "$STAGING_ROLE_NAME" `
        --policy-document "file://$tempStagingFile"
} catch {
    aws iam create-role `
        --role-name "$STAGING_ROLE_NAME" `
        --assume-role-policy-document "file://$tempStagingFile" `
        --description "GitHub Actions role for staging deployments"
    
    Write-Host "Staging role created" -ForegroundColor Green
}

# Attach policies to staging role
Write-Host "Attaching policies to staging role..." -ForegroundColor Gray
aws iam attach-role-policy `
    --role-name "$STAGING_ROLE_NAME" `
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

$STAGING_ROLE_ARN = "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${STAGING_ROLE_NAME}"
Write-Host "Staging role configured: $STAGING_ROLE_ARN" -ForegroundColor Green

# Step 3: Create Production Role
Write-Host ""
Write-Host "Step 3: Creating Production IAM Role..." -ForegroundColor Cyan

# Create trust policy JSON for production (restricted to main branch)
$productionJson = @{
    Version = "2012-10-17"
    Statement = @(
        @{
            Effect = "Allow"
            Principal = @{
                Federated = "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
            }
            Action = "sts:AssumeRoleWithWebIdentity"
            Condition = @{
                StringEquals = @{
                    "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
                }
                StringLike = @{
                    "token.actions.githubusercontent.com:sub" = "repo:${GITHUB_REPO}:ref:refs/heads/main"
                }
            }
        }
    )
}

$tempProductionFile = Join-Path $env:TEMP "trust-policy-production.json"
$productionJson | ConvertTo-Json -Depth 10 | Out-File -FilePath $tempProductionFile -Encoding ascii -NoNewline

$PRODUCTION_ROLE_NAME = "GitHubActionsRole-Production"

try {
    $null = aws iam get-role --role-name "$PRODUCTION_ROLE_NAME" 2>&1
    Write-Host "Production role already exists, updating trust policy..." -ForegroundColor Yellow
    aws iam update-assume-role-policy `
        --role-name "$PRODUCTION_ROLE_NAME" `
        --policy-document "file://$tempProductionFile"
} catch {
    aws iam create-role `
        --role-name "$PRODUCTION_ROLE_NAME" `
        --assume-role-policy-document "file://$tempProductionFile" `
        --description "GitHub Actions role for production deployments"
    
    Write-Host "Production role created" -ForegroundColor Green
}

# Attach policies to production role
Write-Host "Attaching policies to production role..." -ForegroundColor Gray
aws iam attach-role-policy `
    --role-name "$PRODUCTION_ROLE_NAME" `
    --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

$PRODUCTION_ROLE_ARN = "arn:aws:iam::${AWS_ACCOUNT_ID}:role/${PRODUCTION_ROLE_NAME}"
Write-Host "Production role configured: $PRODUCTION_ROLE_ARN" -ForegroundColor Green

# Cleanup
if ($tempStagingFile -and (Test-Path $tempStagingFile)) {
    Remove-Item -Path $tempStagingFile -ErrorAction SilentlyContinue
}
if ($tempProductionFile -and (Test-Path $tempProductionFile)) {
    Remove-Item -Path $tempProductionFile -ErrorAction SilentlyContinue
}

# Summary
Write-Host ""
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "=================" -ForegroundColor Green
Write-Host ""
Write-Host "Add these secrets to your GitHub repository:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. AWS_ROLE_ARN_STAGING" -ForegroundColor Yellow
Write-Host "   Value: $STAGING_ROLE_ARN" -ForegroundColor White
Write-Host ""
Write-Host "2. AWS_ROLE_ARN_PRODUCTION" -ForegroundColor Yellow
Write-Host "   Value: $PRODUCTION_ROLE_ARN" -ForegroundColor White
Write-Host ""
Write-Host "How to add secrets:" -ForegroundColor Cyan
Write-Host "   1. Go to https://github.com/$GITHUB_REPO/settings/secrets/actions" -ForegroundColor Gray
Write-Host "   2. Click 'New repository secret'" -ForegroundColor Gray
Write-Host "   3. Add each secret with the name and value above" -ForegroundColor Gray
Write-Host ""
Write-Host "Security Note:" -ForegroundColor Yellow
Write-Host "   These roles have AdministratorAccess. For production, consider" -ForegroundColor Gray
Write-Host "   using a custom policy with minimal required permissions." -ForegroundColor Gray
Write-Host ""
Write-Host "Full documentation: .github/SECRETS_SETUP.md" -ForegroundColor Cyan
Write-Host ""
