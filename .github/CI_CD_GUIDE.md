# CI/CD Pipeline Documentation

Complete guide for the automated CI/CD pipeline for DocIntel Pro.

## 📋 Overview

The pipeline provides automated testing, building, and deployment of the DocIntel Pro
application to AWS using GitHub Actions.

### Pipeline Stages

```
┌─────────────────────────────────────────────────────────────────┐
│                         TRIGGER                                 │
│  • Push to main/master                                         │
│  • Pull request                                                 │
│  • Manual workflow dispatch                                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
    ▼                ▼                ▼
┌─────────┐    ┌──────────┐    ┌──────────┐
│  Lint   │    │ Test API │    │ Test Web │
│         │    │          │    │          │
│ ESLint  │    │ Vitest   │    │ Vitest   │
│Prettier │    │ 80% Cov  │    │Coverage  │
│TypeCheck│    │Integration│    │         │
└────┬────┘    └────┬─────┘    └────┬─────┘
     │              │               │
     └──────────────┼───────────────┘
                    │
       ┌────────────┼────────────┐
       ▼            ▼            ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │Build API│ │Build Web│ │CDK Synth│
   └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │
        └───────────┼───────────┘
                    │
                    ▼
            ┌───────────────┐
            │Deploy Staging │
            │  (Auto)       │
            └───────┬───────┘
                    │
                    │ Manual Approval
                    ▼
            ┌───────────────┐
            │Deploy Production│
            └───────────────┘
```

## 🚀 Pipeline Jobs

### 1. Lint & Format Check

**Purpose**: Ensure code quality and consistency

**Steps**:

- ✅ ESLint checks (0 warnings allowed)
- ✅ Prettier format validation
- ✅ TypeScript type checking (API, Web, Infra)

**Duration**: ~2 minutes

**Fail Conditions**:

- ESLint errors or warnings
- Code not formatted with Prettier
- TypeScript type errors

### 2. Test API

**Purpose**: Validate API functionality and coverage

**Steps**:

- ✅ Run Vitest unit tests
- ✅ Check coverage ≥ 80%
- ✅ Upload coverage to Codecov

**Duration**: ~3 minutes

**Fail Conditions**:

- Test failures
- Coverage below 80%

**Artifacts**:

- Coverage reports (Codecov)

### 3. Test Web

**Purpose**: Validate web application

**Steps**:

- ✅ Run Vitest tests
- ✅ Generate coverage report
- ✅ Upload to Codecov

**Duration**: ~2 minutes

### 4. Integration Tests

**Purpose**: Test end-to-end workflows

**Steps**:

- ✅ Run integration test suite
- ✅ Validate all 32 tests pass

**Duration**: ~2 minutes

**Coverage**: Complete pipeline from upload to RAG query

### 5. Build API

**Purpose**: Create Lambda deployment package

**Steps**:

- ✅ Install dependencies
- ✅ Build NestJS application
- ✅ Verify lambda.js exists
- ✅ Upload build artifact

**Duration**: ~3 minutes

**Artifacts**:

- `api-build` (Lambda code)

### 6. Build Web

**Purpose**: Create Next.js production build

**Steps**:

- ✅ Install dependencies
- ✅ Build Next.js application
- ✅ Upload build artifact

**Duration**: ~4 minutes

**Artifacts**:

- `web-build` (Next.js .next directory)

### 7. CDK Synthesize

**Purpose**: Generate CloudFormation templates

**Steps**:

- ✅ Download API build
- ✅ Build CDK TypeScript
- ✅ Synthesize all stacks
- ✅ Upload templates

**Duration**: ~2 minutes

**Artifacts**:

- `cdk-templates` (CloudFormation JSON)

### 8. Deploy to Staging

**Purpose**: Deploy to staging environment

**Trigger**: Push to main/master

**Steps**:

- ✅ Configure AWS credentials (OIDC)
- ✅ Download build artifacts
- ✅ Deploy storage stack
- ✅ Deploy API stack
- ✅ Deploy web stack
- ✅ Upload web content to S3
- ✅ Invalidate CloudFront cache
- ✅ Send Slack notification

**Duration**: ~10 minutes

**Environment**: `staging` (no approval required)

**Outputs**:

- Web URL
- API URL

### 9. Deploy to Production

**Purpose**: Deploy to production environment

**Trigger**: Manual approval after staging

**Steps**:

- ⏸️ **Wait for manual approval**
- ✅ Configure AWS credentials (OIDC)
- ✅ Download build artifacts
- ✅ Deploy all stacks
- ✅ Upload web content
- ✅ Send notifications (Slack + Email)

**Duration**: ~10 minutes

**Environment**: `production` (requires approval)

### 10. Failure Notifications

**Purpose**: Alert team on pipeline failures

**Triggers**:

- Any job failure

**Actions**:

- ✅ Send Slack alert
- ✅ Create GitHub issue
- ✅ Tag with labels

## 🔐 Required Secrets

| Secret                    | Required | Environment | Description             |
| ------------------------- | -------- | ----------- | ----------------------- |
| `AWS_ROLE_ARN_STAGING`    | ✅ Yes   | Staging     | IAM role for staging    |
| `AWS_ROLE_ARN_PRODUCTION` | ✅ Yes   | Production  | IAM role for production |
| `NEXT_PUBLIC_API_URL`     | ✅ Yes   | Both        | API Gateway URL         |
| `SLACK_WEBHOOK_URL`       | ❌ No    | Both        | Slack notifications     |
| `NOTIFICATION_EMAIL`      | ❌ No    | Production  | Email alerts            |
| `CODECOV_TOKEN`           | ❌ No    | Both        | Coverage reporting      |

**Setup Instructions**: See [SECRETS_SETUP.md](.github/SECRETS_SETUP.md)

## 🎯 Trigger Conditions

### Automatic Triggers

1. **Push to main/master**
   - Runs full pipeline
   - Deploys to staging
   - Waits for production approval

2. **Pull Request**
   - Runs lint, test, build
   - No deployment
   - Blocks merge if fails

### Manual Triggers

1. **Workflow Dispatch**
   - Select environment (staging/production)
   - Optional skip tests flag
   - Useful for hotfixes

**How to Trigger**:

```
Repository → Actions → CI/CD Pipeline → Run workflow
```

## 📊 Quality Gates

### Code Quality

- ✅ ESLint: 0 warnings
- ✅ Prettier: All files formatted
- ✅ TypeScript: No type errors

### Testing

- ✅ Unit Tests: All passing
- ✅ Integration Tests: 32/32 passing
- ✅ Code Coverage: ≥ 80%

### Build

- ✅ API builds successfully
- ✅ Web builds successfully
- ✅ CDK synthesizes without errors

### Deployment

- ✅ Staging deploys successfully
- ✅ Manual approval for production
- ✅ CloudFormation stacks healthy

## 🔄 Deployment Flow

### Staging Deployment (Automatic)

```bash
# On push to main
1. Code pushed to main/master
2. Pipeline runs all checks
3. Builds applications
4. Synthesizes infrastructure
5. ✅ Automatically deploys to staging
6. Sends Slack notification
```

**Time to Staging**: ~20 minutes from push

### Production Deployment (Manual Approval)

```bash
# After staging success
1. Staging deployment completes
2. ⏸️ GitHub shows "Waiting for approval"
3. Reviewer approves in GitHub UI
4. Production deployment starts
5. ✅ Deploys to production
6. Sends Slack + Email notifications
```

**Time to Production**: ~10 minutes after approval

## 🛠️ Local Testing

Test pipeline jobs locally before pushing:

```bash
# Lint
pnpm lint
pnpm format:check
pnpm typecheck

# Test
cd apps/api && pnpm test:coverage
cd apps/web && pnpm test

# Build
pnpm build:api
pnpm build:web

# CDK
cd infra && pnpm synth
```

## 📈 Monitoring

### Pipeline Status

Check pipeline status:

```
Repository → Actions → CI/CD Pipeline
```

### Job Logs

View detailed logs:

```
Actions → Workflow Run → Job Name → Expand steps
```

### Deployment URLs

Get deployed URLs:

```bash
# Staging
aws cloudformation describe-stacks \
  --stack-name DocIntelProWebStack \
  --query 'Stacks[0].Outputs' --output table

# Production (different account)
aws cloudformation describe-stacks \
  --stack-name DocIntelProWebStack \
  --profile production \
  --query 'Stacks[0].Outputs' --output table
```

## 🚨 Troubleshooting

### Pipeline Fails at Lint

**Cause**: Code quality issues

**Fix**:

```bash
pnpm lint:fix
pnpm format
git add .
git commit -m "fix: code quality"
git push
```

### Tests Fail

**Cause**: Breaking changes or insufficient coverage

**Fix**:

```bash
# Run tests locally
cd apps/api
pnpm test:coverage

# Fix failing tests
# Ensure coverage ≥ 80%
```

### Build Fails

**Cause**: Compilation errors

**Fix**:

```bash
pnpm clean
pnpm install
pnpm build
```

### Deployment Fails

**Cause**: AWS credentials, permissions, or resource issues

**Fix**:

1. Check AWS credentials are valid
2. Verify IAM role has correct permissions
3. Check CloudFormation events in AWS Console
4. Review job logs for specific error

### "Unable to assume role"

**Cause**: OIDC trust policy incorrect

**Fix**:

```bash
# Re-run OIDC setup script
cd scripts
./setup-github-oidc.sh
```

### Coverage Below 80%

**Cause**: Insufficient test coverage

**Fix**:

```bash
# Check coverage report
cd apps/api
pnpm test:coverage

# View detailed coverage
open coverage/lcov-report/index.html

# Add tests for uncovered code
```

## 🔔 Notifications

### Slack Notifications

**Sent on**:

- ✅ Staging deployment success
- ✅ Production deployment success
- ❌ Pipeline failure

**Format**:

```
✅ Staging Deployment Successful
Environment: Staging
Web URL: https://...
API URL: https://...
Commit: abc123...
```

### Email Notifications

**Sent on**:

- ✅ Production deployment success

**Recipients**: `NOTIFICATION_EMAIL` secret

### GitHub Issues

**Created on**:

- ❌ Pipeline failure on main/master

**Labels**: `ci/cd`, `bug`, `automated`

## 🎨 Customization

### Add New Job

Edit `.github/workflows/deploy.yml`:

```yaml
new-job:
  name: New Job
  runs-on: ubuntu-latest
  needs: [previous-job]

  steps:
    - name: Checkout
      uses: actions/checkout@v4

    - name: Do something
      run: echo "Hello"
```

### Change Coverage Threshold

Edit test job:

```yaml
- name: Check coverage thresholds
  run: |
    COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
    if (( $(echo "$COVERAGE < 90" | bc -l) )); then  # Changed to 90%
      exit 1
    fi
```

### Add Environment Variables

```yaml
env:
  CUSTOM_VAR: value

# Or in job
jobs:
  my-job:
    env:
      JOB_VAR: value
```

### Skip Jobs on Certain Paths

```yaml
on:
  push:
    paths:
      - 'apps/**'
      - '!**/*.md' # Skip on markdown changes
```

## 📚 Best Practices

### 1. Test Locally First

Always run tests and linting locally before pushing:

```bash
pnpm lint && pnpm test && pnpm build
```

### 2. Use Feature Branches

```bash
git checkout -b feature/new-feature
# Make changes
git push origin feature/new-feature
# Create PR
```

Pipeline runs on PR without deploying.

### 3. Write Meaningful Commits

Use conventional commits:

```bash
git commit -m "feat: add new document processing feature"
git commit -m "fix: resolve S3 upload timeout"
git commit -m "test: add integration tests for RAG"
```

### 4. Monitor Pipeline

Watch pipeline progress after pushing:

```
Repository → Actions → Watch progress
```

### 5. Review Before Approving Production

Before approving production deployment:

- ✅ Test staging deployment
- ✅ Verify all features work
- ✅ Check logs for errors
- ✅ Review changes in PR

## 📖 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [AWS CDK GitHub Actions](https://docs.aws.amazon.com/cdk/v2/guide/deploy.html)
- [Secrets Setup Guide](.github/SECRETS_SETUP.md)
- [OIDC Setup Script](../scripts/setup-github-oidc.sh)

## 🆘 Support

**Pipeline Issues**:

1. Check job logs in Actions tab
2. Review error messages
3. Check AWS CloudFormation events
4. Verify secrets are configured correctly

**Contact**:

- Create GitHub issue
- Check #devops Slack channel
- Review documentation

---

**Last Updated**: December 10, 2025 **Pipeline Version**: 1.0.0
