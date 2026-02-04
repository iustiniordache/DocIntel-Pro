/**
 * Upload Handler - Generates presigned URLs for secure PDF uploads
 *
 * Flow:
 * 1. Frontend calls this endpoint to get presigned URL
 * 2. Browser uploads directly to S3 using presigned URL
 * 3. S3 ObjectCreated event triggers Textract processing
 *
 * Frontend Integration Example:
 * ```typescript
 * // 1. Get presigned URL
 * const response = await fetch('/api/upload', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ filename: 'contract.pdf' })
 * });
 * const { uploadUrl, documentId } = await response.json();
 *
 * // 2. Upload file directly to S3
 * await fetch(uploadUrl, {
 *   method: 'PUT',
 *   headers: { 'Content-Type': 'application/pdf' },
 *   body: pdfFile
 * });
 *
 * // 3. Poll for results using documentId
 * const results = await fetch(`/api/documents/${documentId}`);
 * ```
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  PutItemCommand,
  PutItemCommandInput,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import {
  config,
  extractUserId,
  getDynamoClient,
  getS3Client,
  getLogger,
  successResponse as sharedSuccessResponse,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  errorResponse,
} from './shared';

// Types
interface UploadRequestBody {
  filename: string;
  workspaceId: string;
  contentType?: string;
}

interface UploadResponse {
  uploadUrl: string;
  documentId: string;
  s3Key: string;
  expiresIn: number;
}

interface DocumentMetadata {
  documentId: string;
  workspaceId: string;
  userId: string;
  filename: string;
  s3Key: string;
  status: string;
  uploadDate: string;
  contentType?: string;
  createdAt: string;
}

interface UploadError {
  error: string;
  message: string;
  code?: string;
}

const DocumentStatus = {
  UPLOAD_PENDING: 'UPLOAD_PENDING',
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

const ALLOWED_CONTENT_TYPE = 'application/pdf';

// In-memory rate limiter (simple implementation)
const rateLimiter = new Map<string, { count: number; resetAt: number }>();

/**
 * Reset rate limiter (for testing)
 */
export function resetRateLimiter(): void {
  rateLimiter.clear();
}

/**
 * Rate limiting check
 */
function checkRateLimit(clientId: string): boolean {
  const cfg = config();
  const now = Date.now();
  const limit = rateLimiter.get(clientId);

  if (!limit || now > limit.resetAt) {
    rateLimiter.set(clientId, {
      count: 1,
      resetAt: now + 60000, // 1 minute
    });
    return true;
  }

  if (limit.count >= cfg.validation.rateLimitMax) {
    return false;
  }

  limit.count++;
  return true;
}

/**
 * Sanitize filename to prevent path traversal and injection attacks
 */
function sanitizeFilename(filename: string): string {
  const cfg = config();

  // Remove path traversal
  let sanitized = filename.replace(/\.\.\//g, '').replace(/\\/g, '');

  // Remove special characters, keep alphanumeric, dots, dashes, underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_]/g, '_');

  // Trim to max length
  if (sanitized.length > cfg.validation.maxFilenameLength) {
    const ext = sanitized.split('.').pop();
    const nameWithoutExt = sanitized.slice(
      0,
      cfg.validation.maxFilenameLength - (ext?.length || 0) - 1,
    );
    sanitized = `${nameWithoutExt}.${ext}`;
  }

  return sanitized;
}

/**
 * Validate request body
 */
function validateRequestBody(body: unknown): {
  isValid: boolean;
  error?: UploadError;
  data?: UploadRequestBody;
} {
  if (!body || typeof body !== 'object') {
    return {
      isValid: false,
      error: {
        error: 'INVALID_REQUEST',
        message: 'Request body is required',
      },
    };
  }

  const { filename, workspaceId, contentType } = body as Partial<UploadRequestBody>;

  if (!filename || typeof filename !== 'string') {
    return {
      isValid: false,
      error: {
        error: 'INVALID_FILENAME',
        message: 'Filename is required and must be a string',
      },
    };
  }

  if (!workspaceId || typeof workspaceId !== 'string') {
    return {
      isValid: false,
      error: {
        error: 'INVALID_WORKSPACE',
        message: 'Workspace ID is required and must be a string',
      },
    };
  }

  if (!filename.toLowerCase().endsWith('.pdf')) {
    return {
      isValid: false,
      error: {
        error: 'INVALID_FILE_TYPE',
        message: 'Only PDF files are allowed',
      },
    };
  }

  if (contentType && contentType !== ALLOWED_CONTENT_TYPE) {
    return {
      isValid: false,
      error: {
        error: 'INVALID_CONTENT_TYPE',
        message: `Content type must be ${ALLOWED_CONTENT_TYPE}`,
      },
    };
  }

  return {
    isValid: true,
    data: { filename, workspaceId, contentType: contentType || ALLOWED_CONTENT_TYPE },
  };
}

/**
 * Save document metadata to DynamoDB
 */
async function saveDocumentMetadata(metadata: DocumentMetadata): Promise<void> {
  const cfg = config();
  const logger = getLogger();
  const dynamoClient = getDynamoClient();

  const params: PutItemCommandInput = {
    TableName: cfg.dynamodb.metadataTable,
    Item: marshall(metadata),
  };

  await dynamoClient.send(new PutItemCommand(params));
  logger.info(
    { documentId: metadata.documentId, table: cfg.dynamodb.metadataTable },
    'Document metadata saved',
  );
}

/**
 * Generate presigned URL for S3 upload
 * New structure: /<userId>/<workspaceId>/<filename>
 */
async function generatePresignedUrl(
  userId: string,
  workspaceId: string,
  documentId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; s3Key: string }> {
  const cfg = config();
  const logger = getLogger();
  const s3Client = getS3Client();

  const sanitizedFilename = sanitizeFilename(filename);
  const s3Key = `${userId}/${workspaceId}/${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: cfg.s3.documentsBucket,
    Key: s3Key,
    ContentType: contentType,
    Metadata: {
      documentId,
      userId,
      workspaceId,
      originalFilename: filename,
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: cfg.s3.presignedUrlExpiry,
  });

  logger.info(
    { documentId, s3Key, bucket: cfg.s3.documentsBucket },
    'Presigned URL generated',
  );

  return { uploadUrl, s3Key };
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  const cfg = config();
  const logger = getLogger();
  const dynamoClient = getDynamoClient();
  const requestId = context.awsRequestId;

  logger.info(
    {
      requestId,
      method: event.httpMethod || 'UNKNOWN',
      path: event.path || 'UNKNOWN',
    },
    'Processing upload request',
  );

  try {
    const userId = extractUserId(event);
    if (!userId) {
      return unauthorized('User not authenticated');
    }

    // Rate limiting (using user ID as client ID)
    if (!checkRateLimit(userId)) {
      return errorResponse(
        429,
        'RATE_LIMIT_EXCEEDED',
        'Too many requests. Please try again later.',
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return badRequest('Request body must be valid JSON');
    }

    const validation = validateRequestBody(body);
    if (!validation.isValid || !validation.data) {
      return badRequest(validation.error?.message || 'Invalid request');
    }

    const { filename, workspaceId, contentType } = validation.data;

    // Verify workspace ownership
    const workspaceCheck = await dynamoClient.send(
      new QueryCommand({
        TableName: cfg.dynamodb.workspacesTable,
        IndexName: 'WorkspaceIdIndex',
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
      }),
    );

    const workspace = workspaceCheck.Items?.[0];
    if (!workspace) {
      return notFound('Workspace not found');
    }

    if (workspace['ownerId']?.S !== userId) {
      return forbidden('Access denied to this workspace');
    }

    // Generate document ID
    const documentId = randomUUID();
    const now = new Date().toISOString();

    // Generate presigned URL with new S3 structure
    const { uploadUrl, s3Key } = await generatePresignedUrl(
      userId,
      workspaceId,
      documentId,
      filename,
      contentType || 'application/pdf',
    );

    // Save metadata to DynamoDB with new schema
    const metadata: DocumentMetadata = {
      documentId,
      workspaceId,
      userId,
      filename,
      s3Key,
      status: DocumentStatus.UPLOAD_PENDING,
      uploadDate: now,
      createdAt: now,
      contentType,
    };

    await saveDocumentMetadata(metadata);

    // Return response
    const response: UploadResponse = {
      uploadUrl,
      documentId,
      s3Key,
      expiresIn: cfg.s3.presignedUrlExpiry,
    };

    logger.info({ documentId, filename, requestId }, 'Upload URL generated successfully');

    return sharedSuccessResponse(response);
  } catch (error) {
    const logger = getLogger();
    logger.error({ error, requestId }, 'Unexpected error processing request');

    return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
  }
}
