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

// Configuration constants
const MAX_FILENAME_LENGTH = 100;
const RATE_LIMIT_MAX = 10; // Max uploads per minute
const ALLOWED_CONTENT_TYPE = 'application/pdf';

// Configuration from environment variables
const CONFIG = {
  aws: {
    region: process.env['AWS_REGION'] || 'us-east-1',
    accountId: process.env['AWS_ACCOUNT_ID'] || '',
  },
  s3: {
    documentsBucket: process.env['S3_DOCUMENTS_BUCKET'] || '',
    presignedUrlExpiry: parseInt(process.env['S3_PRESIGNED_URL_EXPIRY'] || '300', 10),
  },
  dynamodb: {
    metadataTable: process.env['DYNAMODB_METADATA_TABLE'] || '',
    jobsTable: process.env['DYNAMODB_JOBS_TABLE'] || '',
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
};

// Lazy initialization of AWS clients
let s3Client: S3Client;
let dynamoClient: DynamoDBClient;
let logger: pino.Logger;

async function initializeServices() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: CONFIG.aws.region,
    });

    dynamoClient = new DynamoDBClient({
      region: CONFIG.aws.region,
    });

    logger = pino({
      level: CONFIG.logging.level,
      formatters: {
        level: (label) => ({ level: label }),
      },
    });

    logger.info('Services initialized');
  }
}

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

  if (limit.count >= RATE_LIMIT_MAX) {
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

  // Remove special characters, keep alphanumeric, dots, dashes, underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_]/g, '_');

  // Trim to max length
  if (sanitized.length > MAX_FILENAME_LENGTH) {
    const ext = sanitized.split('.').pop();
    const nameWithoutExt = sanitized.slice(
      0,
      MAX_FILENAME_LENGTH - (ext?.length || 0) - 1,
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

  const { filename, contentType } = body as Partial<UploadRequestBody>;

  if (!filename || typeof filename !== 'string') {
    return {
      isValid: false,
      error: {
        error: 'INVALID_FILENAME',
        message: 'Filename is required and must be a string',
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
    data: { filename, contentType: contentType || ALLOWED_CONTENT_TYPE },
  };
}

/**
 * Save document metadata to DynamoDB
 */
async function saveDocumentMetadata(metadata: DocumentMetadata): Promise<void> {
  const params: PutItemCommandInput = {
    TableName: CONFIG.dynamodb.metadataTable,
    Item: marshall(metadata),
  };

  await dynamoClient.send(new PutItemCommand(params));
  logger.info(
    { documentId: metadata.documentId, table: CONFIG.dynamodb.metadataTable },
    'Document metadata saved',
  );
}

/**
 * Generate presigned URL for S3 upload
 */
async function generatePresignedUrl(
  documentId: string,
  filename: string,
  contentType: string,
): Promise<{ uploadUrl: string; s3Key: string }> {
  const sanitizedFilename = sanitizeFilename(filename);
  const s3Key = `documents/${documentId}/${sanitizedFilename}`;

  const command = new PutObjectCommand({
    Bucket: CONFIG.s3.documentsBucket,
    Key: s3Key,
    ContentType: contentType,
    Metadata: {
      documentId,
      originalFilename: filename,
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: CONFIG.s3.presignedUrlExpiry,
  });

  logger.info(
    { documentId, s3Key, bucket: CONFIG.s3.documentsBucket },
    'Presigned URL generated',
  );

  return { uploadUrl, s3Key };
}

/**
 * Create error response
 */
function errorResponse(
  statusCode: number,
  error: UploadError,
  requestId: string,
): APIGatewayProxyResultV2 {
  logger.error({ statusCode, error, requestId }, 'Request failed');

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // Configure as needed
      'X-Request-Id': requestId,
    },
    body: JSON.stringify(error),
  };
}

/**
 * Create success response
 */
function successResponse(
  data: UploadResponse,
  requestId: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // Configure as needed
      'X-Request-Id': requestId,
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
  // Initialize services on first invocation (Lambda warm start optimization)
  await initializeServices();

  const requestId = context.awsRequestId;

  logger.info(
    {
      requestId,
      method: event.requestContext?.http?.method || 'UNKNOWN',
      path: event.requestContext?.http?.path || 'UNKNOWN',
    },
    'Processing upload request',
  );

  try {
    // Rate limiting (using source IP as client ID)
    const clientId = event.requestContext?.http?.sourceIp || 'unknown';
    if (!checkRateLimit(clientId)) {
      return errorResponse(
        429,
        {
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
          code: '429',
        },
        requestId,
      );
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return errorResponse(
        400,
        {
          error: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
        requestId,
      );
    }

    const validation = validateRequestBody(body);
    if (!validation.isValid) {
      return errorResponse(
        400,
        (validation.error || 'Invalid request') as UploadError,
        requestId,
      );
    }

    if (!validation.data) {
      return errorResponse(
        400,
        'Invalid request data' as unknown as UploadError,
        requestId,
      );
    }

    const { filename, contentType } = validation.data;

    // Generate document ID
    const documentId = randomUUID();
    const now = new Date().toISOString();

    // Generate presigned URL
    const { uploadUrl, s3Key } = await generatePresignedUrl(
      documentId,
      filename,
      contentType || 'application/octet-stream',
    );

    // Save metadata to DynamoDB
    const metadata: DocumentMetadata = {
      documentId,
      filename,
      s3Key,
      status: DocumentStatus.UPLOAD_PENDING,
      uploadDate: now,
      contentType,
    };

    await saveDocumentMetadata(metadata);

    // Return response
    const response: UploadResponse = {
      uploadUrl,
      documentId,
      s3Key,
      expiresIn: CONFIG.s3.presignedUrlExpiry,
    };

    logger.info({ documentId, filename, requestId }, 'Upload URL generated successfully');

    return successResponse(response, requestId);
  } catch (error) {
    logger.error({ error, requestId }, 'Unexpected error processing request');

    return errorResponse(
      500,
      {
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        code: '500',
      },
      requestId,
    );
  }
}
