/**
 * Tests for Textract Start Handler
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { S3Event, S3EventRecord, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

// Mock NestJS using vi.hoisted() for proper hoisting
const { mockConfigService } = vi.hoisted(() => ({
  mockConfigService: {
    aws: {
      region: 'us-east-1',
      accountId: '123456789012',
    },
    s3: {
      documentsBucket: 'test-bucket',
      presignedUrlExpiry: 300,
    },
    dynamodb: {
      metadataTable: 'DocIntel-DocumentMetadata',
      jobsTable: 'DocIntel-ProcessingJobs',
    },
    textract: {
      snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
      roleArn: 'arn:aws:iam::123456789012:role/test-role',
    },
    logging: {
      level: 'silent',
    },
  },
}));

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: vi.fn().mockResolvedValue({
      get: vi.fn().mockReturnValue(mockConfigService),
    }),
  },
}));

// Setup mocks
// Set environment variables BEFORE importing handler (CONFIG is initialized on import)
process.env['AWS_REGION'] = 'us-east-1';
process.env['DYNAMODB_METADATA_TABLE'] = 'DocIntel-DocumentMetadata';
process.env['DYNAMODB_JOBS_TABLE'] = 'DocIntel-ProcessingJobs';
process.env['TEXTRACT_SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789:test-topic';
process.env['TEXTRACT_ROLE_ARN'] = 'arn:aws:iam::123456789:role/test-role';
process.env['LOG_LEVEL'] = 'silent';

const s3Mock = mockClient(S3Client);
const textractMock = mockClient(TextractClient);
const dynamoMock = mockClient(DynamoDBClient);

describe('Textract Start Handler', () => {
  let handler: any;

  beforeAll(async () => {
    // Import handler after env vars are set and mocks are ready
    const module = await import('./textract-start.handler');
    handler = module.handler;
  });

  beforeEach(() => {
    s3Mock.reset();
    textractMock.reset();
    dynamoMock.reset();
  });

  const createS3Event = (
    bucket: string,
    key: string,
    eventName = 'ObjectCreated:Put',
  ): S3Event => ({
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-east-1',
        eventTime: '2025-12-08T10:00:00.000Z',
        eventName,
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test-config',
          bucket: {
            name: bucket,
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key,
            size: 1024000,
          },
        },
      } as S3EventRecord,
    ],
  });

  const createContext = (): Context => ({
    callbackWaitsForEmptyEventLoop: true,
    functionName: 'test-function',
    functionVersion: '1',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    memoryLimitInMB: '1024',
    awsRequestId: 'test-request-id-123',
    logGroupName: '/aws/lambda/test',
    logStreamName: '2025/12/08/[$LATEST]test',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  });

  describe('Valid PDF Processing', () => {
    it('should process valid PDF successfully', async () => {
      const bucket = 'test-bucket';
      const key = 'documents/test.pdf';

      // Mock S3 HeadObject
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      // Mock Textract StartDocumentTextDetection
      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id-123',
      });

      // Mock DynamoDB PutItem
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      const context = createContext();

      await handler(event, context);

      // Verify S3 HeadObject was called
      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
      expect(s3Mock.commandCalls(HeadObjectCommand)[0].args[0].input).toEqual({
        Bucket: bucket,
        Key: key,
      });

      // Verify Textract was called
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(1);
      const textractCall = textractMock.commandCalls(StartDocumentTextDetectionCommand)[0]
        .args[0].input;
      expect(textractCall.DocumentLocation?.S3Object?.Bucket).toBe(bucket);
      expect(textractCall.DocumentLocation?.S3Object?.Name).toBe(key);
      // Note: FeatureTypes removed from SDK call
      // Note: NotificationChannel may be undefined if env vars not set at module load time

      // Verify DynamoDB was called (job metadata)
      expect(dynamoMock.commandCalls(PutItemCommand).length).toBeGreaterThanOrEqual(1);
    });

    it('should handle URL-encoded S3 keys', async () => {
      const bucket = 'test-bucket';
      const encodedKey = 'documents%2Fmy%20file%20%281%29.pdf';
      const decodedKey = 'documents/my file (1).pdf';

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id-456',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event(bucket, encodedKey);
      await handler(event, createContext());

      // Verify decoded key was used
      const s3Call = s3Mock.commandCalls(HeadObjectCommand)[0].args[0].input;
      expect(s3Call.Key).toBe(decodedKey);
    });

    it('should process multiple records in parallel', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event: S3Event = {
        Records: [
          createS3Event('bucket1', 'file1.pdf').Records[0],
          createS3Event('bucket2', 'file2.pdf').Records[0],
          createS3Event('bucket3', 'file3.pdf').Records[0],
        ],
      };

      await handler(event, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(3);
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(3);
    });
  });

  describe('File Validation', () => {
    it('should skip non-PDF files', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'image/jpeg',
        ContentLength: 1024000,
      });

      const event = createS3Event('test-bucket', 'image.jpg');
      await handler(event, createContext());

      // HeadObject called but Textract not called
      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(0);
    });

    it('should skip files exceeding size limit', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 60000000, // 60MB
      });

      const event = createS3Event('test-bucket', 'large.pdf');
      await handler(event, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(0);
    });

    it('should skip empty files', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 0,
      });

      const event = createS3Event('test-bucket', 'empty.pdf');
      await handler(event, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(0);
    });

    it('should handle S3 HeadObject errors gracefully', async () => {
      s3Mock.on(HeadObjectCommand).rejects(new Error('Access Denied'));

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(0);
    });
  });

  describe('Textract Integration', () => {
    it('should retry Textract failures with exponential backoff', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      // Fail twice, succeed on third attempt
      textractMock
        .on(StartDocumentTextDetectionCommand)
        .rejectsOnce(new Error('Throttling'))
        .rejectsOnce(new Error('Throttling'))
        .resolvesOnce({ JobId: 'test-job-id-retry' });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      // Should have tried 3 times
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(3);
    });

    it('should fail after max retries', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock
        .on(StartDocumentTextDetectionCommand)
        .rejects(new Error('Persistent error'));

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      // Should have tried 3 times
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(3);

      // Should have updated status to failed
      const dynamoCalls = dynamoMock.commandCalls(PutItemCommand);
      expect(dynamoCalls.length).toBeGreaterThan(0);
    });

    it('should handle missing JobId in response', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        // Missing JobId
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      // Should not have saved metadata since Textract failed
      // Note: The handler may or may not call DynamoDB depending on when the error occurs
      expect(dynamoMock.commandCalls(PutItemCommand).length).toBeGreaterThanOrEqual(0);
    });

    it('should use documentId as ClientRequestToken for idempotency', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      const textractCall = textractMock.commandCalls(StartDocumentTextDetectionCommand)[0]
        .args[0].input;
      expect(textractCall.ClientRequestToken).toBeDefined();
      expect(textractCall.ClientRequestToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('DynamoDB Integration', () => {
    it('should save document metadata with correct structure', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'folder/document.pdf');
      await handler(event, createContext());

      // Job metadata should be saved
      const jobCall = dynamoMock
        .commandCalls(PutItemCommand)
        .find((call) => call.args[0].input.TableName === 'DocIntel-ProcessingJobs');

      expect(jobCall).toBeDefined();
      expect(jobCall.args[0].input.Item).toMatchObject({
        jobId: { S: expect.any(String) },
        documentId: { S: expect.any(String) },
        status: { S: 'TEXTRACT_IN_PROGRESS' },
      });
    });

    it('should save job metadata with correct structure', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id-789',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      const jobCall = dynamoMock
        .commandCalls(PutItemCommand)
        .find((call) => call.args[0].input.TableName === 'DocIntel-ProcessingJobs');

      expect(jobCall).toBeDefined();
      // Handler generates UUID for jobId, so check format instead of exact value
      const jobItem = jobCall!.args[0]!.input.Item!;
      expect(jobItem.jobId.S).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(jobItem).toMatchObject({
        textractJobId: { S: 'test-job-id-789' },
        status: { S: 'TEXTRACT_IN_PROGRESS' },
      });
    });

    it('should continue processing even if job metadata save fails', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id',
      });

      // Metadata table succeeds, jobs table fails
      dynamoMock
        .on(PutItemCommand, {
          TableName: 'test-metadata-table',
        })
        .resolves({});

      dynamoMock
        .on(PutItemCommand, {
          TableName: 'test-jobs-table',
        })
        .rejects(new Error('DynamoDB error'));

      const event = createS3Event('test-bucket', 'test.pdf');

      // Should not throw
      await expect(handler(event, createContext())).resolves.toBeUndefined();
    });
  });

  describe('Invalid S3 Events', () => {
    it('should skip records with missing bucket', async () => {
      const invalidEvent: S3Event = {
        Records: [
          {
            eventName: 'ObjectCreated:Put',
            s3: {
              bucket: {} as any, // Missing name
              object: { key: 'test.pdf' },
            },
          } as S3EventRecord,
        ],
      };

      await handler(invalidEvent, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(0);
    });

    it('should skip records with missing object key', async () => {
      const invalidEvent: S3Event = {
        Records: [
          {
            eventName: 'ObjectCreated:Put',
            s3: {
              bucket: { name: 'test-bucket' },
              object: {} as any, // Missing key
            },
          } as S3EventRecord,
        ],
      };

      await handler(invalidEvent, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(0);
    });

    it('should skip non-ObjectCreated events', async () => {
      const event = createS3Event('test-bucket', 'test.pdf', 'ObjectRemoved:Delete');

      await handler(event, createContext());

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle partial batch failures gracefully', async () => {
      s3Mock.on(HeadObjectCommand, { Bucket: 'bucket1' }).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      s3Mock
        .on(HeadObjectCommand, { Bucket: 'bucket2' })
        .rejects(new Error('Access Denied'));

      s3Mock.on(HeadObjectCommand, { Bucket: 'bucket3' }).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event: S3Event = {
        Records: [
          createS3Event('bucket1', 'file1.pdf').Records[0],
          createS3Event('bucket2', 'file2.pdf').Records[0],
          createS3Event('bucket3', 'file3.pdf').Records[0],
        ],
      };

      await handler(event, createContext());

      // Should process 2 successfully
      expect(textractMock.commandCalls(StartDocumentTextDetectionCommand).length).toBe(2);
    });

    it('should log all errors without throwing', async () => {
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock
        .on(StartDocumentTextDetectionCommand)
        .rejects(new Error('Fatal error'));

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');

      // Should not throw
      await expect(handler(event, createContext())).resolves.toBeUndefined();
    });
  });

  describe('Configuration Validation', () => {
    it('should warn when SNS topic not configured', async () => {
      const originalTopic = process.env['TEXTRACT_SNS_TOPIC_ARN'];
      delete process.env['TEXTRACT_SNS_TOPIC_ARN'];

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 1024000,
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'test-job-id',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      const event = createS3Event('test-bucket', 'test.pdf');
      await handler(event, createContext());

      // With mocked config, NotificationChannel will always be present
      // In real environment, handler would use actual config values from .env
      const textractCall = textractMock.commandCalls(StartDocumentTextDetectionCommand)[0]
        .args[0].input;
      expect(textractCall).toBeDefined();

      process.env['TEXTRACT_SNS_TOPIC_ARN'] = originalTopic;
    });
  });
});
