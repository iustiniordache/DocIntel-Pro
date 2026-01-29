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
 *
 * NOTE: This handler creates a factory function that initializes with NestJS config
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
  UpdateItemCommand,
  UpdateItemCommandInput,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import pino from 'pino';

// Types
interface DocumentMetadata {
  workspaceId: string; // Partition key
  documentId: string; // Sort key
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

// Configuration constants
const MAX_FILE_SIZE = 52428800; // 50MB in bytes
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 300; // milliseconds

// Configuration from environment variables
const CONFIG = {
  aws: {
    region: process.env['AWS_REGION'] || 'us-east-1',
    accountId: process.env['AWS_ACCOUNT_ID'] || '',
  },
  s3: {
    documentsBucket: process.env['S3_DOCUMENTS_BUCKET'] || '',
  },
  dynamodb: {
    metadataTable: process.env['DYNAMODB_METADATA_TABLE'] || '',
    jobsTable: process.env['DYNAMODB_JOBS_TABLE'] || '',
  },
  textract: {
    snsTopicArn: process.env['TEXTRACT_SNS_TOPIC_ARN'] || '',
    roleArn: process.env['TEXTRACT_ROLE_ARN'] || '',
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
};

// Lazy initialization of AWS clients
let s3Client: S3Client;
let textractClient: TextractClient;
let dynamoClient: DynamoDBClient;
let logger: pino.Logger;

async function initializeServices() {
  if (!s3Client) {
    // Initialize AWS SDK clients
    s3Client = new S3Client({
      region: CONFIG.aws.region,
    });

    textractClient = new TextractClient({
      region: CONFIG.aws.region,
    });

    dynamoClient = new DynamoDBClient({
      region: CONFIG.aws.region,
    });

    // Structured logger
    logger = pino({
      level: CONFIG.logging.level,
      formatters: {
        level: (label) => ({ level: label }),
      },
    });

    logger.info('Services initialized');
  }
}

/**
 * Validates S3 event record
 */
function isValidS3Record(record: S3EventRecord): boolean {
  return !!(
    record.s3?.bucket?.name &&
    record.s3?.object?.key &&
    record.eventName?.startsWith('ObjectCreated:')
  );
}

/**
 * Validates PDF file via S3 HeadObject
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
    if (fileSize > MAX_FILE_SIZE) {
      return {
        isValid: false,
        reason: `File too large: ${fileSize} bytes. Max: ${MAX_FILE_SIZE} bytes`,
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
 * Updates existing record if it exists (from upload handler)
 */
async function saveDocumentMetadata(metadata: DocumentMetadata): Promise<void> {
  const params: UpdateItemCommandInput = {
    TableName: CONFIG.dynamodb.metadataTable,
    Key: marshall({ documentId: metadata.documentId }),
    UpdateExpression:
      'SET #status = :status, #bucket = :bucket, s3Key = :s3Key, fileSize = :fileSize, ' +
      'contentType = :contentType, createdAt = :createdAt',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#bucket': 'bucket',
    },
    ExpressionAttributeValues: marshall({
      ':status': metadata.status,
      ':bucket': metadata.bucket,
      ':s3Key': metadata.s3Key,
      ':fileSize': metadata.fileSize,
      ':contentType': metadata.contentType,
      ':createdAt': metadata.createdAt,
    }),
  };

  await dynamoClient.send(new UpdateItemCommand(params));
  logger.info(
    { documentId: metadata.documentId, table: CONFIG.dynamodb.metadataTable },
    'Document metadata updated',
  );
}

/**
 * Saves processing job metadata to DynamoDB (non-blocking)
 */
async function saveJobMetadata(job: ProcessingJob): Promise<void> {
  try {
    const params: PutItemCommandInput = {
      TableName: CONFIG.dynamodb.jobsTable,
      Item: marshall(job),
    };

    await dynamoClient.send(new PutItemCommand(params));
    logger.info(
      {
        jobId: job.jobId,
        documentId: job.documentId,
        table: CONFIG.dynamodb.jobsTable,
      },
      'Job metadata saved',
    );
  } catch (error) {
    logger.error({ error, jobId: job.jobId }, 'Failed to save job metadata');
  }
}

/**
 * Starts Textract job with retry logic
 */
async function startTextractJob(
  bucket: string,
  key: string,
  documentId: string,
): Promise<StartDocumentTextDetectionResponse> {
  // Debug: Log SNS configuration
  logger.info(
    {
      snsTopicArn: CONFIG.textract.snsTopicArn,
      roleArn: CONFIG.textract.roleArn,
      hasSnsConfig: !!CONFIG.textract.snsTopicArn && !!CONFIG.textract.roleArn,
    },
    'Textract SNS configuration',
  );

  const input: StartDocumentTextDetectionCommandInput = {
    DocumentLocation: {
      S3Object: {
        Bucket: bucket,
        Name: key,
      },
    },
    ClientRequestToken: documentId, // Idempotency
    NotificationChannel:
      CONFIG.textract.snsTopicArn && CONFIG.textract.roleArn
        ? {
            SNSTopicArn: CONFIG.textract.snsTopicArn,
            RoleArn: CONFIG.textract.roleArn,
          }
        : undefined,
  };

  logger.info(
    {
      documentId,
      hasNotificationChannel: !!input.NotificationChannel,
      notificationChannel: input.NotificationChannel,
    },
    'Starting Textract job',
  );

  const command = new StartDocumentTextDetectionCommand(input);

  // Retry with exponential backoff
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await textractClient.send(command);

      if (!response.JobId) {
        logger.warn(
          { documentId, attempt: attempt + 1 },
          'Textract job started but no JobId returned',
        );
      }

      return response;
    } catch (error) {
      const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);

      logger.warn(
        {
          error,
          attempt: attempt + 1,
          maxAttempts: RETRY_ATTEMPTS,
          nextRetryDelay: delay,
          documentId,
        },
        'Textract job failed, retrying...',
      );

      if (attempt < RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error('Failed to start Textract job after max retries');
}

/**
 * Updates document status to FAILED in DynamoDB
 */
async function markDocumentAsFailed(documentId: string): Promise<void> {
  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: CONFIG.dynamodb.metadataTable,
        Item: marshall({
          documentId,
          status: DocumentStatus.FAILED_TEXTRACT_START,
          updatedAt: new Date().toISOString(),
        }),
      }),
    );
  } catch (error) {
    logger.error({ error, documentId }, 'Failed to update document status to FAILED');
  }
}

/**
 * Processes a single S3 record
 */
async function processRecord(record: S3EventRecord, requestId: string): Promise<void> {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  const filename = key.split('/').pop() || key;

  logger.info({ bucket, key, filename, requestId }, 'Processing S3 record');

  // Validate S3 record structure
  if (!isValidS3Record(record)) {
    logger.warn({ record }, 'Invalid S3 record structure, skipping');
    return;
  }

  // Validate PDF file
  const validation = await validatePdfFile(bucket, key);

  if (!validation.isValid) {
    logger.warn(
      { bucket, key, filename, requestId, reason: validation.reason },
      'File validation failed, skipping',
    );
    return;
  }

  // Extract userId and workspaceId from S3 key path: <userId>/<workspaceId>/<filename>
  const keyParts = key.split('/');
  const userId = keyParts.length >= 1 ? keyParts[0] : null;
  const workspaceId = keyParts.length >= 2 ? keyParts[1] : null;

  if (!userId || !workspaceId) {
    logger.warn(
      { bucket, key, filename, requestId },
      'Invalid S3 key structure, expected: <userId>/<workspaceId>/<filename>',
    );
    return;
  }

  const now = new Date().toISOString();

  logger.info(
    {
      bucket,
      key,
      filename,
      requestId,
      userId,
      workspaceId,
      fileSize: validation.fileSize,
    },
    'File validated successfully',
  );

  // Query DynamoDB to find the document by workspaceId and s3Key
  const queryResult = await dynamoClient.send(
    new QueryCommand({
      TableName: CONFIG.dynamodb.metadataTable,
      KeyConditionExpression: 'workspaceId = :workspaceId',
      FilterExpression: 's3Key = :s3Key',
      ExpressionAttributeValues: marshall({
        ':workspaceId': workspaceId,
        ':s3Key': key,
      }),
    }),
  );

  let documentId: string;

  if (queryResult.Items && queryResult.Items.length > 0) {
    // Document already exists (created by upload handler)
    const existingDoc = unmarshall(queryResult.Items[0]!);
    documentId = existingDoc['documentId'] as string;

    logger.info(
      { documentId, workspaceId, filename },
      'Found existing document in DynamoDB',
    );

    // Update status to TEXTRACT_PENDING
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: CONFIG.dynamodb.metadataTable,
        Key: marshall({ workspaceId, documentId }),
        UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': DocumentStatus.TEXTRACT_PENDING,
          ':updatedAt': now,
        }),
      }),
    );
  } else {
    // Document not found, this shouldn't happen if upload handler works correctly
    // But we'll handle it gracefully
    logger.warn(
      { workspaceId, filename, key },
      'Document not found in DynamoDB, creating new entry',
    );

    documentId = randomUUID();

    const metadata: DocumentMetadata = {
      workspaceId, // Add workspaceId as partition key
      documentId,
      filename,
      bucket,
      s3Key: key,
      uploadDate: now,
      status: DocumentStatus.TEXTRACT_PENDING,
      fileSize: validation.fileSize ?? 0,
      contentType: validation.contentType ?? 'application/octet-stream',
      createdAt: now,
    };

    await saveDocumentMetadata(metadata);
  }

  // Start Textract job
  try {
    const response = await startTextractJob(bucket, key, documentId);

    logger.info(
      { documentId, jobId: response.JobId, attempt: 1 },
      'Textract job started successfully',
    );

    // Save job metadata (non-blocking)
    if (response.JobId) {
      const job: ProcessingJob = {
        jobId: randomUUID(),
        documentId,
        bucket,
        s3Key: key,
        status: JobStatus.IN_PROGRESS,
        createdAt: now,
        textractJobId: response.JobId,
      };

      await saveJobMetadata(job);
    }

    logger.info(
      {
        documentId,
        jobId: response.JobId,
        bucket,
        key,
        fileSize: validation.fileSize,
      },
      'Document processing initiated successfully',
    );
  } catch (error) {
    logger.error({ error, documentId, bucket, key }, 'Failed to process document');

    await markDocumentAsFailed(documentId);
    throw error;
  }
}

/**
 * Main Lambda handler
 */
export async function handler(event: S3Event, context: Context): Promise<void> {
  // Initialize services on first invocation (Lambda warm start optimization)
  await initializeServices();

  const requestId = context.awsRequestId;

  logger.info(
    { requestId, recordCount: event.Records?.length || 0 },
    'Processing S3 event',
  );

  // Warn if SNS not configured
  if (!CONFIG.textract.snsTopicArn || !CONFIG.textract.roleArn) {
    logger.warn(
      'TEXTRACT_SNS_TOPIC_ARN or TEXTRACT_ROLE_ARN not configured. Jobs will not send notifications.',
    );
  }

  // Process all records in parallel
  const results = await Promise.allSettled(
    (event.Records || []).map((record) => processRecord(record, requestId)),
  );

  // Log results
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  logger.info(
    { requestId, total: event.Records.length, succeeded, failed },
    'S3 event processing completed',
  );

  // Log individual failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(
        { recordIndex: index, error: result.reason, record: event.Records[index] },
        'Record processing failed',
      );
    }
  });
}
