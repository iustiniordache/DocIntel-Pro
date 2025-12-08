# DocIntel Pro - Production TypeScript Monorepo

> Intelligent Document Processing with AWS Textract, Bedrock, NestJS, and Next.js

## 🏗️ Architecture

```
docintel-pro/
├── apps/
│   ├── api/              # NestJS Lambda API
│   └── web/              # Next.js 15 Frontend
├── packages/
│   └── shared/           # Shared TypeScript types & utils
├── infra/                # AWS CDK Infrastructure
└── [config files]        # Root configuration
```

## 📦 Tech Stack

### Backend (apps/api)

- **NestJS 10.4+** - Lambda-optimized framework
- **AWS SDK v3** - Modular AWS services
- **pdfjs-dist 4.9+** - PDF processing
- **Pino 9.x** - Structured logging
- **Vitest** - Fast unit testing
- **esbuild** - Lambda bundling

### Frontend (apps/web)

- **Next.js 15** - App Router
- **React 18.3+** - UI library
- **TanStack Query v5** - Data fetching
- **Tailwind CSS** - Styling
- **shadcn/ui** - Component library
- **Vitest** - Testing

### Infrastructure (infra)

- **AWS CDK v2.174+** - Infrastructure as Code
- **Lambda** - Serverless compute
- **API Gateway** - REST API
- **S3** - Document storage
- **DynamoDB** - Metadata storage
- **Textract** - Document analysis
- **Bedrock** - AI embeddings

### Shared (packages/shared)

- TypeScript interfaces
- Utility functions
- Type-safe data structures

## 🚀 Quick Start

### Prerequisites

- **Node.js**: 20.x or higher
- **pnpm**: 9.x or higher
- **AWS CLI**: Configured with credentials
- **AWS CDK**: Bootstrap your account

```bash
# Install pnpm globally
npm install -g pnpm@9

# Verify installation
pnpm --version
node --version
```

### Installation

```bash
# Clone repository
git clone <repo-url>
cd docintel-pro

# Install dependencies (all workspaces)
pnpm install

# Setup environment variables
cp .env.example .env
# Edit .env with your AWS configuration
```

### Development

```bash
# Run all apps in parallel
pnpm dev

# Run specific apps
pnpm dev:api      # API on http://localhost:3000
pnpm dev:web      # Web on http://localhost:3001

# Build all packages and apps
pnpm build

# Run tests
pnpm test

# Type checking
pnpm typecheck

# Lint and format
pnpm lint
pnpm format
```

## 📁 Project Structure

### Root Configuration

| File                  | Purpose                             |
| --------------------- | ----------------------------------- |
| `package.json`        | Root package with workspace scripts |
| `pnpm-workspace.yaml` | pnpm workspace configuration        |
| `tsconfig.base.json`  | Base TypeScript config              |
| `eslint.config.js`    | ESLint 9 flat config                |
| `.prettierrc.json`    | Prettier formatting                 |
| `.husky/pre-commit`   | Git pre-commit hooks                |

### Apps Directory

#### apps/api (NestJS Backend)

```
apps/api/
├── src/
│   ├── app.module.ts      # Root module
│   ├── main.ts            # Dev entry point
│   ├── lambda.ts          # Lambda handler
│   └── document/          # Document processing module
├── esbuild.config.js      # Lambda bundling
├── nest-cli.json          # NestJS CLI config
├── vitest.config.ts       # Vitest config
├── tsconfig.json          # TypeScript config
└── package.json           # Dependencies
```

**Key Features:**

- Lambda-optimized NestJS
- AWS SDK v3 modular imports
- Structured logging with Pino
- esbuild for fast bundling
- Tree-shakeable dependencies

**Scripts:**

```bash
cd apps/api
pnpm dev          # Development with hot reload
pnpm build        # Build + Lambda bundle
pnpm test         # Run tests
pnpm typecheck    # Type checking
```

#### apps/web (Next.js Frontend)

```
apps/web/
├── src/
│   └── app/
│       ├── layout.tsx     # Root layout
│       ├── page.tsx       # Home page
│       ├── providers.tsx  # React Query provider
│       └── globals.css    # Tailwind styles
├── next.config.js         # Next.js config
├── tailwind.config.js     # Tailwind config
├── vitest.config.ts       # Vitest config
├── tsconfig.json          # TypeScript config
└── package.json           # Dependencies
```

**Key Features:**

- Next.js 15 App Router
- TanStack Query for data fetching
- Tailwind CSS + shadcn/ui
- TypeScript strict mode
- Optimized for production

**Scripts:**

```bash
cd apps/web
pnpm dev          # Development server
pnpm build        # Production build
pnpm start        # Start production server
pnpm test         # Run tests
```

### Packages Directory

#### packages/shared

```
packages/shared/
├── src/
│   ├── index.ts           # Barrel export
│   ├── types.ts           # Shared types
│   └── utils.ts           # Utility functions
├── tsconfig.json          # TypeScript config
└── package.json           # Dependencies
```

**Exports:**

- `Document`, `DocumentStatus` - Document types
- `TextractResult`, `TextractBlock` - Textract types
- `EmbeddingResult`, `DocumentChunk` - Bedrock types
- `ApiResponse`, `PaginatedResponse` - API types
- Utility functions for formatting, retry logic, etc.

**Usage:**

```typescript
import { Document, DocumentStatus } from '@docintel/shared';
```

### Infrastructure Directory

#### infra (AWS CDK)

```
infra/
├── bin/
│   └── cdk.ts             # CDK app entry
├── lib/
│   ├── api-stack.ts       # Lambda + API Gateway
│   └── storage-stack.ts   # S3 + DynamoDB
├── cdk.json               # CDK config
├── tsconfig.json          # TypeScript config
└── package.json           # Dependencies
```

**Stacks:**

- `DocIntelProStorageStack` - S3 bucket, DynamoDB table
- `DocIntelProApiStack` - Lambda function, API Gateway

**Scripts:**

```bash
cd infra
pnpm build        # Compile TypeScript
pnpm cdk synth    # Synthesize CloudFormation
pnpm cdk diff     # Show changes
pnpm deploy       # Deploy all stacks
pnpm cdk destroy  # Tear down stacks
```

## 🛠️ Development Workflow

### 1. Local Development

```bash
# Terminal 1: Start API
pnpm dev:api

# Terminal 2: Start Web
pnpm dev:web

# Terminal 3: Watch shared package
cd packages/shared && pnpm dev
```

### 2. Make Changes

1. Edit code in any workspace
2. TypeScript will auto-compile
3. Hot reload triggers automatically
4. Tests run in watch mode

### 3. Pre-commit Checks

Husky automatically runs on commit:

- Lint staged files
- Format with Prettier
- Type checking
- Run relevant tests

### 4. Build for Production

```bash
# Build all packages
pnpm build

# This builds:
# 1. packages/shared (TypeScript compilation)
# 2. apps/api (NestJS + esbuild Lambda bundle)
# 3. apps/web (Next.js optimized build)
```

### 5. Deploy to AWS

```bash
# Deploy infrastructure
pnpm deploy

# Or deploy specific stack
pnpm deploy:api

# Verify deployment
pnpm cdk:api diff
```

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
pnpm test

# Run tests for specific app
pnpm test:api
pnpm test:web

# Watch mode
cd apps/api && pnpm test:watch

# Coverage
cd apps/api && pnpm test:coverage
```

### Integration Tests

```bash
# API integration tests
cd apps/api
pnpm test:e2e

# Web component tests
cd apps/web
pnpm test:components
```

## 📝 Scripts Reference

### Root Scripts

| Script           | Description                   |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Start all apps in development |
| `pnpm build`     | Build all packages and apps   |
| `pnpm test`      | Run all tests                 |
| `pnpm lint`      | Lint all code                 |
| `pnpm format`    | Format all code with Prettier |
| `pnpm typecheck` | Type check all workspaces     |
| `pnpm clean`     | Clean all build artifacts     |
| `pnpm deploy`    | Deploy all CDK stacks         |

### Workspace Scripts

Each workspace (apps/api, apps/web, packages/shared, infra) has:

- `dev` - Development mode
- `build` - Production build
- `test` - Run tests
- `typecheck` - Type checking
- `clean` - Clean build artifacts

## 🏗️ Adding New Features

### Add API Endpoint

1. Create module in `apps/api/src/`
2. Add service with business logic
3. Add controller with routes
4. Register in `app.module.ts`
5. Add tests

### Add Web Page

1. Create route in `apps/web/src/app/`
2. Add page component
3. Add TanStack Query hooks
4. Style with Tailwind
5. Add tests

### Add Shared Type

1. Define interface in `packages/shared/src/types.ts`
2. Export from `packages/shared/src/index.ts`
3. Use in API and Web with `@docintel/shared`

### Add Infrastructure

1. Create stack in `infra/lib/`
2. Define resources with CDK constructs
3. Register in `infra/bin/cdk.ts`
4. Deploy with `pnpm deploy`

## 🔧 Configuration

### TypeScript

Base configuration in `tsconfig.base.json`:

- Strict mode enabled
- ES2022 target
- Path aliases configured
- Project references for workspaces

### ESLint

Flat config format (ESLint 9):

- TypeScript support
- Prettier integration
- React rules for web
- NestJS patterns for API

### Prettier

Consistent formatting:

- Single quotes
- Semicolons
- 2-space indentation
- 90 character line width
- Trailing commas

### Git Hooks

Pre-commit:

- Lint staged files
- Format changed files
- Abort on errors

## 🚀 Deployment

### Prerequisites

1. **AWS Account** configured
2. **CDK Bootstrap** your account:
   ```bash
   npx cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

### Deploy Steps

```bash
# 1. Build Lambda bundle
pnpm build:api

# 2. Synthesize CloudFormation
cd infra && pnpm cdk synth

# 3. Review changes
pnpm cdk diff

# 4. Deploy
pnpm deploy

# 5. Get outputs
pnpm cdk synth --quiet
```

### Environment Variables

Set in AWS Lambda console or `.env`:

- `AWS_REGION` - AWS region
- `DOCUMENTS_BUCKET` - S3 bucket name
- `LOG_LEVEL` - Logging level

### Frontend Deployment

Deploy to Vercel, Netlify, or AWS Amplify:

```bash
cd apps/web
pnpm build

# Outputs to .next/ directory
# Configure deployment platform
```

## 📊 Monitoring

### CloudWatch Logs

- Lambda logs: `/aws/lambda/docintel-pro-api`
- API Gateway logs: Enabled in stack

### Metrics

- Lambda duration, errors, invocations
- API Gateway 4xx/5xx errors
- S3 bucket metrics
- DynamoDB read/write capacity

### X-Ray Tracing

Enabled for:

- Lambda functions
- API Gateway
- AWS SDK calls

## 🔐 Security

### IAM Policies

- Least privilege access
- Service-specific roles
- No hardcoded credentials

### API Security

- CORS configured
- Input validation
- Rate limiting (API Gateway)

### Data Security

- S3 encryption at rest
- DynamoDB encryption
- VPC endpoints (optional)

## 🤝 Contributing

### Code Style

- Follow TypeScript strict mode
- Use functional components (React)
- Dependency injection (NestJS)
- Async/await over promises

### Commit Messages

```
feat: add document upload endpoint
fix: resolve S3 upload timeout
docs: update API documentation
chore: upgrade dependencies
```

### Pull Request Process

1. Create feature branch
2. Make changes with tests
3. Run `pnpm lint && pnpm test`
4. Create PR with description
5. Wait for CI checks
6. Merge after approval

## 📚 Resources

### Documentation

- [NestJS Docs](https://docs.nestjs.com/)
- [Next.js Docs](https://nextjs.org/docs)
- [AWS CDK Docs](https://docs.aws.amazon.com/cdk/)
- [TanStack Query](https://tanstack.com/query/latest)
- [pnpm Docs](https://pnpm.io/)

### AWS Services

- [Textract](https://aws.amazon.com/textract/)
- [Bedrock](https://aws.amazon.com/bedrock/)
- [Lambda](https://aws.amazon.com/lambda/)
- [API Gateway](https://aws.amazon.com/api-gateway/)

## 📄 License

MIT

## 👥 Team

Built with ❤️ by the DocIntel Pro team

---

**Happy Coding! 🚀**
