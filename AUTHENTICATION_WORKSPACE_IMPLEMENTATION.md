# Multi-Tenant Authentication & Workspace Implementation

This document details the changes made to implement multi-tenant authentication with
Amazon Cognito and workspace management functionality.

## Overview

The application has been upgraded with the following features:

- **Amazon Cognito User Pool**: Authentication and user management
- **API Gateway Security**: All endpoints now require Cognito JWT tokens
- **Workspace Management**: Multi-tenant workspace isolation with CRUD operations
- **Updated Data Model**: Documents are now organized by workspace and user
- **S3 Structure**: Hierarchical storage using
  `/<userId>/<workspaceId>/<documentId>/<file>`

## Infrastructure Changes

### 1. Amazon Cognito User Pool

**Location**: `infra/stacks/minimal-stack.ts`

A new Cognito User Pool has been added with:

- Email and username sign-in
- Self-registration enabled
- Email verification
- Password policy (8+ chars, uppercase, lowercase, digits, symbols)
- User Pool Client for web applications

**Outputs**:

- `UserPoolId`: Cognito User Pool ID
- `UserPoolClientId`: Client ID for authentication

### 2. API Gateway Authorizer

All API endpoints are now protected with a Cognito User Pool authorizer:

- `/upload` - POST (requires auth)
- `/query` - POST (requires auth)
- `/documents` - GET (requires auth)
- `/workspaces` - GET, POST (requires auth)
- `/workspaces/{workspaceId}` - GET, PUT, DELETE (requires auth)

The authorizer extracts the user ID from the JWT token's `sub` claim.

### 3. DynamoDB Tables

#### Workspaces Table (`DocIntel-Workspaces`)

```
Partition Key: ownerId (String)
Sort Key: workspaceId (String)
GSI: WorkspaceIdIndex (PK: workspaceId)
```

**Attributes**:

- `workspaceId`: UUID
- `ownerId`: Cognito user ID (sub claim)
- `name`: Workspace name
- `description`: Optional description
- `createdAt`: ISO timestamp
- `updatedAt`: ISO timestamp
- `documentCount`: Number of documents (optional)

#### Documents Table (Updated)

```
Partition Key: workspaceId (String)
Sort Key: documentId (String)
GSI: UserIdIndex (PK: userId, SK: createdAt)
```

**Breaking Changes**:

- `id` → `documentId`
- Added `workspaceId` as partition key
- Added `userId` field
- Updated `s3Key` structure

### 4. S3 Bucket Structure

**Old**: `documents/<documentId>/<filename>`

**New**: `<userId>/<workspaceId>/<documentId>/<filename>`

This provides:

- Clear ownership hierarchy
- Easy cleanup when deleting users/workspaces
- Better access control and auditing

## Lambda Functions

### New Workspace Handlers

All handlers are in `apps/api/src/handlers/`:

1. **workspace-create.handler.ts** - Create new workspace
2. **workspace-list.handler.ts** - List user's workspaces
3. **workspace-get.handler.ts** - Get workspace by ID
4. **workspace-update.handler.ts** - Update workspace name/description
5. **workspace-delete.handler.ts** - Delete workspace (if no documents)

### Updated Handlers

#### upload.handler.ts

- Now requires `workspaceId` in request body
- Extracts `userId` from Cognito JWT
- Verifies workspace ownership before generating presigned URL
- Uses new S3 structure: `<userId>/<workspaceId>/<documentId>/<filename>`

**Request Body**:

```json
{
  "filename": "document.pdf",
  "workspaceId": "uuid-here",
  "contentType": "application/pdf"
}
```

## API Endpoints

### Authentication

All requests must include:

```
Authorization: Bearer <JWT_TOKEN>
```

The JWT token is obtained from Cognito User Pool after authentication.

### Workspace Endpoints

#### Create Workspace

```http
POST /workspaces
Content-Type: application/json

{
  "name": "My Workspace",
  "description": "Optional description"
}
```

**Response**:

```json
{
  "success": true,
  "data": {
    "workspaceId": "uuid",
    "ownerId": "cognito-user-id",
    "name": "My Workspace",
    "description": "Optional description",
    "createdAt": "2026-01-28T...",
    "updatedAt": "2026-01-28T...",
    "documentCount": 0
  }
}
```

#### List Workspaces

```http
GET /workspaces
```

Returns all workspaces owned by the authenticated user.

#### Get Workspace

```http
GET /workspaces/{workspaceId}
```

Returns workspace details (with ownership verification).

#### Update Workspace

```http
PUT /workspaces/{workspaceId}
Content-Type: application/json

{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Workspace

```http
DELETE /workspaces/{workspaceId}
```

Deletes workspace only if it has no documents.

### Document Upload

```http
POST /upload
Content-Type: application/json

{
  "filename": "contract.pdf",
  "workspaceId": "workspace-uuid"
}
```

## TypeScript Types

Updated types in `packages/shared/src/types.ts`:

```typescript
export interface Workspace {
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}

export interface Document {
  documentId: string;
  workspaceId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string; // Format: /<userId>/<workspaceId>/<documentId>/<file>
  s3Bucket: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
```

## Migration Guide

### For Existing Data

If you have existing documents in the old schema:

1. **Run a migration script** to:
   - Create a default workspace for each user
   - Update document records with `workspaceId` and `userId`
   - Move S3 objects to new structure

2. **Update client applications** to:
   - Include workspace selection in upload flow
   - Pass `workspaceId` in upload requests
   - Implement Cognito authentication

### Authentication Flow

1. **User Registration**:

   ```javascript
   import {
     CognitoIdentityProviderClient,
     SignUpCommand,
   } from '@aws-sdk/client-cognito-identity-provider';

   const client = new CognitoIdentityProviderClient({ region: 'us-east-1' });
   await client.send(
     new SignUpCommand({
       ClientId: USER_POOL_CLIENT_ID,
       Username: email,
       Password: password,
       UserAttributes: [{ Name: 'email', Value: email }],
     }),
   );
   ```

2. **User Login**:

   ```javascript
   import {
     CognitoIdentityProviderClient,
     InitiateAuthCommand,
   } from '@aws-sdk/client-cognito-identity-provider';

   const response = await client.send(
     new InitiateAuthCommand({
       AuthFlow: 'USER_PASSWORD_AUTH',
       ClientId: USER_POOL_CLIENT_ID,
       AuthParameters: {
         USERNAME: email,
         PASSWORD: password,
       },
     }),
   );

   const idToken = response.AuthenticationResult.IdToken;
   ```

3. **API Calls**:
   ```javascript
   fetch('https://api-url/workspaces', {
     headers: {
       Authorization: `Bearer ${idToken}`,
       'Content-Type': 'application/json',
     },
   });
   ```

## Security Considerations

1. **Workspace Isolation**: Users can only access their own workspaces
2. **Document Access**: Documents are tied to workspaces and verified on upload
3. **S3 Bucket Policies**: Consider adding bucket policies to enforce the path structure
4. **CORS**: Update CORS settings for your frontend domain (currently set to `*`)

## Environment Variables

Lambda functions now use these environment variables:

- `DYNAMODB_WORKSPACES_TABLE`: Workspaces table name
- All handlers have access to Cognito user ID via
  `event.requestContext.authorizer.jwt.claims.sub`

## Deployment

1. **Build the updated handlers**:

   ```bash
   cd apps/api
   npm run build
   ```

2. **Deploy infrastructure**:

   ```bash
   cd infra
   npx cdk deploy MinimalStack
   ```

3. **Note the outputs**:
   - `UserPoolId`
   - `UserPoolClientId`
   - API endpoints

4. **Configure your frontend** with the Cognito details

## Testing

### Create User and Workspace

```bash
# 1. Register user (use AWS CLI or SDK)
# 2. Confirm user email
# 3. Login to get JWT token
# 4. Create workspace
curl -X POST https://api-url/workspaces \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Workspace"}'

# 5. Upload document
curl -X POST https://api-url/upload \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"filename": "test.pdf", "workspaceId": "<workspace-id>"}'
```

## Future Enhancements

1. **Workspace Sharing**: Add members to workspaces
2. **Roles & Permissions**: Owner, Editor, Viewer roles
3. **Workspace Quotas**: Limit documents per workspace
4. **Soft Delete**: Archive instead of hard delete
5. **Audit Logging**: Track all workspace/document operations
6. **Workspace Templates**: Pre-configured workspace types

## Rollback Plan

If issues occur:

1. Revert CDK stack: `cdk deploy --previous-deployment`
2. Keep both old and new handlers during transition
3. Maintain backward compatibility with old S3 paths temporarily

---

**Last Updated**: January 28, 2026 **Version**: 2.0.0
