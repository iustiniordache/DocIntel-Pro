# Frontend Setup Guide

## Installation

1. Install dependencies:

```bash
cd apps/web
npm install
```

## Environment Configuration

Create a `.env.local` file in `apps/web/` with your AWS configuration:

```bash
# API Configuration (from CDK deployment outputs)
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/prod

# Cognito Configuration (from CDK deployment outputs)
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=us-east-1
```

### Getting the Values

After deploying the infrastructure with `cdk deploy MinimalStack`, you'll see outputs
like:

```
Outputs:
MinimalStack.ApiEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/prod/
MinimalStack.UserPoolId = us-east-1_ABC123XYZ
MinimalStack.UserPoolClientId = 1234567890abcdefghijklmnop
```

Use these values to populate your `.env.local` file.

## Features

### Authentication

- User registration with email verification
- Login/logout
- Automatic token refresh
- Session persistence

### Workspace Management

- Create workspaces to organize documents
- Switch between workspaces
- View workspace document count
- Delete empty workspaces

### Document Upload

- Upload PDFs to selected workspace
- Progress tracking
- File size validation (50MB max)
- Automatic processing with Textract

### Document Chat

- Ask questions about documents
- RAG-powered answers using Bedrock
- Source citations

## Running the Application

Development mode:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## User Flow

1. **Sign Up**: Create account with email and password
2. **Verify Email**: Enter confirmation code sent to email
3. **Sign In**: Login with credentials
4. **Create Workspace**: Create your first workspace (e.g., "Legal Documents")
5. **Upload Document**: Select workspace and upload PDF
6. **Ask Questions**: Use chat interface to query documents

## Architecture

```
┌─────────────────┐
│   Next.js App   │
└────────┬────────┘
         │
    ┌────┴─────────────────────┐
    │                          │
┌───▼──────┐          ┌────────▼─────┐
│ Cognito  │          │  API Gateway │
│  Auth    │          │  (Cognito    │
└──────────┘          │  Authorized) │
                      └────────┬──────┘
                               │
                      ┌────────▼──────┐
                      │   Lambda      │
                      │   Functions   │
                      └────────┬──────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
      ┌─────▼────┐      ┌─────▼────┐      ┌─────▼────┐
      │    S3    │      │ DynamoDB │      │OpenSearch│
      └──────────┘      └──────────┘      └──────────┘
```

## Components

### Contexts

- `AuthContext`: Authentication state and methods
- `WorkspaceContext`: Workspace management

### Components

- `AuthForm`: Login/register/verify interface
- `WorkspaceSelector`: Workspace dropdown and creation
- `FileUpload`: Document upload with progress
- `DocumentManagement`: List of documents
- `ChatInterface`: RAG query interface

## API Integration

All API calls include:

- `Authorization: Bearer <idToken>` header
- Automatic token refresh before expiry
- Workspace ID in relevant requests

## Troubleshooting

### CORS Errors

Ensure API Gateway CORS is configured to allow your frontend origin.

### Authentication Fails

- Verify Cognito User Pool ID and Client ID in `.env.local`
- Check Cognito region matches
- Ensure user is confirmed

### Upload Fails

- Check workspace is selected
- Verify file is PDF and under 50MB
- Check API endpoint in `.env.local`

### Token Expired

Tokens automatically refresh. If issues persist, sign out and sign back in.

## Security Notes

- Tokens stored in localStorage (consider httpOnly cookies for production)
- All API endpoints require authentication
- Workspace access verified server-side
- S3 uploads use presigned URLs (no direct access)

---

**Last Updated**: January 28, 2026
