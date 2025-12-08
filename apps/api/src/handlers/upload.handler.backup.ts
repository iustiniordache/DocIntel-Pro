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

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import pino from 'pino';

// Import types from shared package
interface UploadRequestBody {
  filename: string;
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
  filename: string;
  s3Key: string;
  status: string;
  uploadDate: string;
  contentType?: string;
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

// Initialize AWS SDK clients
const s3Client = new S3Client({
  region: process.env['AWS_REGION'] || 'us-east-1',
});

const dynamoClient = new DynamoDBClient({
  region: process.env['AWS_REGION'] || 'us-east-1',
});

// Structured logger
const logger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Configuration
const CONFIG = {
  S3_BUCKET_NAME: process.env['S3_BUCKET_NAME'] || process.env['DOCUMENTS_BUCKET'],
  DYNAMODB_TABLE: process.env['DYNAMODB_TABLE'] || 'DocIntel-DocumentMetadata',
  MAX_FILE_SIZE: 52428800, // 50MB in bytes
  PRESIGNED_URL_EXPIRY: 300, // 5 minutes in seconds
  MAX_FILENAME_LENGTH: 100,
  RATE_LIMIT_MAX: 10, // Max uploads per minute
  ALLOWED_CONTENT_TYPE: 'application/pdf',
};

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
  const now = Date.now();
  const limit = rateLimiter.get(clientId);

  if (!limit || now > limit.resetAt) {
    rateLimiter.set(clientId, {
      count: 1,
      resetAt: now + 60000, // 1 minute
    });
    return true;
  }

  if (limit.count >= CONFIG.RATE_LIMIT_MAX) {
    return false;
  }

  limit.count++;
  return true;
}

/**
 * Sanitize filename to prevent path traversal and injection attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove path traversal
  let sanitized = filename.replace(/\.\.\//g, '').replace(/\\/g, '');

  // Keep only alphanumeric, dash, underscore, dot
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.trim().replace(/^\.+|\.+$/g, '');

  return sanitized;
}

/**
 * Validate upload request
 */
function validateRequest(body: UploadRequestBody): {
  valid: boolean;
  error?: string;
} {
  if (!body.filename) {
    return { valid: false, error: 'Filename is required' };
  }

  if (body.filename.length > CONFIG.MAX_FILENAME_LENGTH) {
    return {
      valid: false,
      error: `Filename must be less than ${CONFIG.MAX_FILENAME_LENGTH} characters`,
    };
  }

  const sanitized = sanitizeFilename(body.filename);
  if (!sanitized.toLowerCase().endsWith('.pdf')) {
    return { valid: false, error: 'Filename must be .pdf' };
  }

  if (sanitized.length === 0) {
    return { valid: false, error: 'Invalid filename format' };
  }

  return { valid: true };
}

/**
 * Generate presigned URL for S3 upload
 */
async function generatePresignedUrl(s3Key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: CONFIG.S3_BUCKET_NAME,
    Key: s3Key,
    ContentType: contentType,
  });

  try {
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: CONFIG.PRESIGNED_URL_EXPIRY,
    });

    logger.info(
      { s3Key, expiresIn: CONFIG.PRESIGNED_URL_EXPIRY },
      'Generated presigned URL',
    );

    return signedUrl;
  } catch (error) {
    logger.error({ error, s3Key }, 'Failed to generate presigned URL');
    throw new Error('Presigned URL generation failed');
  }
}

/**
 * Save document metadata to DynamoDB
 */
async function saveDocumentMetadata(metadata: DocumentMetadata): Promise<void> {
  const params: PutItemCommandInput = {
    TableName: CONFIG.DYNAMODB_TABLE,
    Item: marshall({
      documentId: metadata.documentId,
      filename: metadata.filename,
      s3Key: metadata.s3Key,
      status: metadata.status,
      uploadDate: metadata.uploadDate,
      contentType: metadata.contentType,
    }),
  };

  try {
    await dynamoClient.send(new PutItemCommand(params));
    logger.info({ documentId: metadata.documentId }, 'Saved document metadata');
  } catch (error) {
    logger.error({ error, metadata }, 'Failed to save document metadata');
    throw new Error('Upload initialization failed');
  }
}

/**
 * Create error response
 */
function errorResponse(
  statusCode: number,
  message: string,
  code?: string,
): APIGatewayProxyResultV2 {
  const error: UploadError = { error: 'Upload Error', message, code };

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(error),
  };
}

/**
 * Create success response
 */
function successResponse(data: UploadResponse): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(data),
  };
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  const requestId = context.awsRequestId;
  logger.info({ requestId, event }, 'Processing upload request');

  // Handle OPTIONS for CORS preflight
  if (event.requestContext.http.method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  try {
    // Rate limiting
    const clientIp = event.requestContext.http.sourceIp || 'unknown';
    if (!checkRateLimit(clientIp)) {
      logger.warn({ clientIp, requestId }, 'Rate limit exceeded');
      return errorResponse(
        429,
        'Too many requests. Please try again later.',
        'RATE_LIMIT_EXCEEDED',
      );
    }

    // Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required', 'MISSING_BODY');
    }

    let body: UploadRequestBody;
    try {
      body = JSON.parse(event.body);
    } catch (error) {
      logger.error({ error, requestId }, 'Invalid JSON in request body');
      return errorResponse(400, 'Invalid JSON format', 'INVALID_JSON');
    }

    // Validate request
    const validation = validateRequest(body);
    if (!validation.valid) {
      logger.warn({ body, requestId }, 'Validation failed');
      return errorResponse(400, validation.error!, 'VALIDATION_ERROR');
    }

    // Sanitize filename
    const sanitizedFilename = sanitizeFilename(body.filename);
    const contentType = body.contentType || CONFIG.ALLOWED_CONTENT_TYPE;

    // Generate document ID and S3 key
    const documentId = randomUUID();
    const s3Key = `documents/${documentId}/${sanitizedFilename}`;

    logger.info(
      { documentId, s3Key, filename: sanitizedFilename, requestId },
      'Processing upload request',
    );

    // Save metadata to DynamoDB
    const metadata: DocumentMetadata = {
      documentId,
      filename: sanitizedFilename,
      s3Key,
      status: DocumentStatus.UPLOAD_PENDING,
      uploadDate: new Date().toISOString(),
      contentType,
    };

    await saveDocumentMetadata(metadata);

    // Generate presigned URL
    const uploadUrl = await generatePresignedUrl(s3Key, contentType);

    // Prepare response
    const response: UploadResponse = {
      uploadUrl,
      documentId,
      s3Key,
      expiresIn: CONFIG.PRESIGNED_URL_EXPIRY,
    };

    logger.info({ documentId, requestId }, 'Upload request processed successfully');

    return successResponse(response);
  } catch (error) {
    logger.error({ error, requestId }, 'Unexpected error processing upload request');

    const message = error instanceof Error ? error.message : 'Internal server error';

    return errorResponse(500, message, 'INTERNAL_ERROR');
  }
}
