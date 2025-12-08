/**
 * Textract Start Handler - S3 → Textract Pipeline
 *
 * Flow:
 * 1. S3 ObjectCreated event triggers this Lambda
 * 2. Validates PDF file (content-type, size)
 * 3. Creates document metadata in DynamoDB
 * 4. Starts async Textract job (doesn't wait)
 * 5. Saves job metadata for status tracking
 *
 * Architecture:
 * S3 → Lambda (this) → Textract → SNS → Lambda (completion handler)
 */

import { S3Event, S3EventRecord, Context } from 'aws-lambda';
import { S3Client, HeadObjectCommand, HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  StartDocumentTextDetectionCommandInput,
  StartDocumentTextDetectionResponse,
} from '@aws-sdk/client-textract';
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import pino from 'pino';

// Types
interface DocumentMetadata {
  documentId: string;
  filename: string;
  bucket: string;
  s3Key: string;
  uploadDate: string;
  status: string;
  fileSize: number;
  contentType: string;
  createdAt: string;
}

interface ProcessingJob {
  jobId: string;
  documentId: string;
  bucket: string;
  s3Key: string;
  status: string;
  createdAt: string;
  textractJobId: string;
}

interface ValidationResult {
  isValid: boolean;
  reason?: string;
  fileSize?: number;
  contentType?: string;
}

const DocumentStatus = {
  TEXTRACT_PENDING: 'TEXTRACT_PENDING',
  TEXTRACT_IN_PROGRESS: 'TEXTRACT_IN_PROGRESS',
  TEXTRACT_COMPLETED: 'TEXTRACT_COMPLETED',
  TEXTRACT_FAILED: 'TEXTRACT_FAILED',
  FAILED_TEXTRACT_START: 'FAILED_TEXTRACT_START',
} as const;

const JobStatus = {
  IN_PROGRESS: 'TEXTRACT_IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

// Initialize AWS SDK clients
const s3Client = new S3Client({
  region: process.env['AWS_REGION'] || 'us-east-1',
});

const textractClient = new TextractClient({
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
  METADATA_TABLE: process.env['DYNAMODB_METADATA_TABLE'] || 'DocIntel-DocumentMetadata',
  JOBS_TABLE: process.env['DYNAMODB_JOBS_TABLE'] || 'DocIntel-ProcessingJobs',
  TEXTRACT_SNS_TOPIC_ARN: process.env['TEXTRACT_SNS_TOPIC_ARN'],
  TEXTRACT_ROLE_ARN: process.env['TEXTRACT_ROLE_ARN'],
  MAX_FILE_SIZE: 52428800, // 50MB in bytes
  ALLOWED_CONTENT_TYPE: 'application/pdf',
  RETRY_ATTEMPTS: 3,
  RETRY_BASE_DELAY: 300, // milliseconds
};

/**
 * Validates S3 event record
 */
function isValidS3Record(record: S3EventRecord): boolean {
  return !!(
    record.s3?.bucket?.name &&
    record.s3?.object?.key &&
    record.eventName?.startsWith('ObjectCreated')
  );
}

/**
 * Extracts filename from S3 key
 */
function extractFilename(s3Key: string): string {
  const decoded = decodeURIComponent(s3Key.replace(/\+/g, ' '));
  return decoded.split('/').pop() || decoded;
}

/**
 * Validates PDF file
 */
async function validatePdfFile(bucket: string, key: string): Promise<ValidationResult> {
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response: HeadObjectCommandOutput = await s3Client.send(headCommand);

    const contentType = response.ContentType || '';
    const fileSize = response.ContentLength || 0;

    // Validate content type
    if (!contentType.toLowerCase().includes('pdf')) {
      return {
        isValid: false,
        reason: `Invalid content type: ${contentType}. Expected application/pdf`,
        contentType,
        fileSize,
      };
    }

    // Validate file size
    if (fileSize > CONFIG.MAX_FILE_SIZE) {
      return {
        isValid: false,
        reason: `File too large: ${fileSize} bytes. Max: ${CONFIG.MAX_FILE_SIZE} bytes`,
        contentType,
        fileSize,
      };
    }

    if (fileSize === 0) {
      return {
        isValid: false,
        reason: 'File is empty',
        contentType,
        fileSize,
      };
    }

    return {
      isValid: true,
      contentType,
      fileSize,
    };
  } catch (error) {
    logger.error({ error, bucket, key }, 'Failed to validate file');
    return {
      isValid: false,
      reason: `Failed to read file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Saves document metadata to DynamoDB
 */
async function saveDocumentMetadata(metadata: DocumentMetadata): Promise<void> {
  const params: PutItemCommandInput = {
    TableName: CONFIG.METADATA_TABLE,
    Item: marshall(metadata, {
      removeUndefinedValues: true,
    }),
  };

  try {
    await dynamoClient.send(new PutItemCommand(params));
    logger.info(
      { documentId: metadata.documentId, table: CONFIG.METADATA_TABLE },
      'Document metadata saved',
    );
  } catch (error) {
    logger.error(
      { error, documentId: metadata.documentId },
      'Failed to save document metadata',
    );
    throw error;
  }
}

/**
 * Saves processing job metadata to DynamoDB
 */
async function saveJobMetadata(job: ProcessingJob): Promise<void> {
  const params: PutItemCommandInput = {
    TableName: CONFIG.JOBS_TABLE,
    Item: marshall(job, {
      removeUndefinedValues: true,
    }),
  };

  try {
    await dynamoClient.send(new PutItemCommand(params));
    logger.info(
      { jobId: job.jobId, documentId: job.documentId, table: CONFIG.JOBS_TABLE },
      'Job metadata saved',
    );
  } catch (error) {
    logger.error(
      { error, jobId: job.jobId, documentId: job.documentId },
      'Failed to save job metadata',
    );
    // Don't throw - non-critical, we can track via documentId
  }
}

/**
 * Starts Textract job with exponential backoff retry
 */
async function startTextractJob(
  bucket: string,
  key: string,
  documentId: string,
): Promise<StartDocumentTextDetectionResponse> {
  const params: StartDocumentTextDetectionCommandInput = {
    DocumentLocation: {
      S3Object: {
        Bucket: bucket,
        Name: key,
      },
    },
    NotificationChannel: CONFIG.TEXTRACT_SNS_TOPIC_ARN
      ? {
          SNSTopicArn: CONFIG.TEXTRACT_SNS_TOPIC_ARN,
          RoleArn: CONFIG.TEXTRACT_ROLE_ARN!,
        }
      : undefined,
    ClientRequestToken: documentId, // For idempotency
  };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < CONFIG.RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await textractClient.send(
        new StartDocumentTextDetectionCommand(params),
      );

      logger.info(
        {
          documentId,
          jobId: response.JobId,
          attempt: attempt + 1,
        },
        'Textract job started successfully',
      );

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const delay = CONFIG.RETRY_BASE_DELAY * Math.pow(2, attempt);

      logger.warn(
        {
          error: lastError,
          attempt: attempt + 1,
          maxAttempts: CONFIG.RETRY_ATTEMPTS,
          nextRetryDelay: delay,
          documentId,
        },
        'Textract job failed, retrying...',
      );

      if (attempt < CONFIG.RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error('Failed to start Textract job');
}

/**
 * Updates document status to failed
 */
async function updateDocumentStatusToFailed(
  documentId: string,
  errorMessage: string,
): Promise<void> {
  const params: PutItemCommandInput = {
    TableName: CONFIG.METADATA_TABLE,
    Item: marshall({
      documentId,
      status: DocumentStatus.FAILED_TEXTRACT_START,
      errorMessage,
      updatedAt: new Date().toISOString(),
    }),
  };

  try {
    await dynamoClient.send(new PutItemCommand(params));
  } catch (error) {
    logger.error({ error, documentId }, 'Failed to update document status to failed');
  }
}

/**
 * Processes a single S3 record
 */
async function processRecord(record: S3EventRecord, requestId: string): Promise<void> {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  const filename = extractFilename(key);

  const logContext = { bucket, key, filename, requestId };
  logger.info(logContext, 'Processing S3 record');

  // Validate record structure
  if (!isValidS3Record(record)) {
    logger.warn({ record }, 'Invalid S3 record structure, skipping');
    return;
  }

  // Validate PDF file
  const validation = await validatePdfFile(bucket, key);
  if (!validation.isValid) {
    logger.warn(
      { ...logContext, reason: validation.reason },
      'File validation failed, skipping',
    );
    return;
  }

  const documentId = randomUUID();
  const now = new Date().toISOString();

  logger.info(
    { ...logContext, documentId, fileSize: validation.fileSize },
    'File validated successfully',
  );

  try {
    // 1. Save document metadata
    const metadata: DocumentMetadata = {
      documentId,
      filename,
      bucket,
      s3Key: key,
      uploadDate: now,
      status: DocumentStatus.TEXTRACT_PENDING,
      fileSize: validation.fileSize!,
      contentType: validation.contentType!,
      createdAt: now,
    };

    await saveDocumentMetadata(metadata);

    // 2. Start Textract job
    const textractResponse = await startTextractJob(bucket, key, documentId);

    if (!textractResponse.JobId) {
      throw new Error('Textract response missing JobId');
    }

    // 3. Update document status
    await dynamoClient.send(
      new PutItemCommand({
        TableName: CONFIG.METADATA_TABLE,
        Item: marshall({
          documentId,
          status: DocumentStatus.TEXTRACT_IN_PROGRESS,
          textractJobId: textractResponse.JobId,
          updatedAt: new Date().toISOString(),
        }),
      }),
    );

    // 4. Save job metadata (non-blocking)
    const job: ProcessingJob = {
      jobId: textractResponse.JobId,
      documentId,
      bucket,
      s3Key: key,
      status: JobStatus.IN_PROGRESS,
      createdAt: new Date().toISOString(),
      textractJobId: textractResponse.JobId,
    };

    await saveJobMetadata(job);

    logger.info(
      {
        documentId,
        jobId: textractResponse.JobId,
        bucket,
        key,
        fileSize: validation.fileSize,
      },
      'Document processing initiated successfully',
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error, documentId, bucket, key }, 'Failed to process document');

    await updateDocumentStatusToFailed(documentId, errorMessage);
    throw error;
  }
}

/**
 * Main Lambda handler
 */
export async function handler(event: S3Event, context: Context): Promise<void> {
  const requestId = context.awsRequestId;
  logger.info({ requestId, recordCount: event.Records.length }, 'Processing S3 event');

  // Validate configuration
  if (!CONFIG.TEXTRACT_SNS_TOPIC_ARN || !CONFIG.TEXTRACT_ROLE_ARN) {
    logger.warn(
      'TEXTRACT_SNS_TOPIC_ARN or TEXTRACT_ROLE_ARN not configured. Jobs will not send notifications.',
    );
  }

  // Process all records
  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record, requestId)),
  );

  // Log summary
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  logger.info(
    {
      requestId,
      total: event.Records.length,
      succeeded,
      failed,
    },
    'S3 event processing completed',
  );

  // Log failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(
        {
          recordIndex: index,
          error: result.reason,
          record: event.Records[index],
        },
        'Record processing failed',
      );
    }
  });
}
