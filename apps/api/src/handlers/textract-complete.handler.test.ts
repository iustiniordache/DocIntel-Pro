/**
 * Tests for Textract Complete Handler
 */

import { SNSEvent, Context } from 'aws-lambda';
import {
  TextractClient,
  GetDocumentTextDetectionCommand,
  Block,
  BlockType,
} from '@aws-sdk/client-textract';
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { marshall } from '@aws-sdk/util-dynamodb';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';

// Setup mocks
const textractMock = mockClient(TextractClient);
const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const bedrockMock = mockClient(BedrockRuntimeClient);

// Mock OpenSearch client
const mockOpenSearchClient = {
  indices: {
    exists: vi.fn().mockResolvedValue({ body: true }),
    create: vi.fn().mockResolvedValue({ body: { acknowledged: true } }),
  },
  index: vi.fn().mockResolvedValue({
    body: {
      _id: 'test-chunk-id',
      result: 'created',
    },
  }),
  bulk: vi.fn().mockResolvedValue({
    body: {
      errors: false,
      items: [{ index: { _id: 'chunk-1', status: 201 } }],
    },
  }),
  search: vi.fn().mockResolvedValue({
    body: {
      hits: {
        total: { value: 1 },
        hits: [
          {
            _id: 'chunk-1',
            _score: 0.95,
            _source: {
              documentId: 'test-doc-id',
              chunkId: 'chunk-1',
              content: 'Test content from document',
              embedding: Array(1024).fill(0.5),
              metadata: { page: 1 },
            },
          },
        ],
      },
    },
  }),
  delete: vi.fn().mockResolvedValue({ body: { result: 'deleted' } }),
  deleteByQuery: vi.fn().mockResolvedValue({
    body: { deleted: 1 },
  }),
};

// Mock @opensearch-project/opensearch
vi.mock('@opensearch-project/opensearch', () => ({
  Client: vi.fn(() => mockOpenSearchClient),
}));

vi.mock('@opensearch-project/opensearch/aws', () => ({
  AwsSigv4Signer: vi.fn(() => ({})),
}));

// Set environment variables BEFORE importing handler
process.env['AWS_REGION'] = 'us-east-1';
process.env['DYNAMODB_METADATA_TABLE'] = 'test-metadata-table';
process.env['DYNAMODB_JOBS_TABLE'] = 'test-jobs-table';
process.env['TEXTRACT_CONFIDENCE_THRESHOLD'] = '80';
process.env['TEXTRACT_COST_PER_PAGE'] = '0.0015';
process.env['OPENSEARCH_DOMAIN'] = 'https://test-domain.us-east-1.es.amazonaws.com';
process.env['OPENSEARCH_INDEX_NAME'] = 'test-vectors';
process.env['BEDROCK_EMBEDDING_MODEL_ID'] = 'amazon.titan-embed-text-v2:0';
process.env['S3_BUCKET_NAME'] = 'test-bucket';
process.env['LOG_LEVEL'] = 'error'; // Suppress logs in tests

describe('textract-complete.handler', () => {
  let handler: any;
  let mockContext: Context;

  beforeAll(async () => {
    // Import handler after env vars are set
    const module = await import('./textract-complete.handler');
    handler = module.handler;
  });

  beforeEach(() => {
    // Reset mocks
    textractMock.reset();
    dynamoMock.reset();
    s3Mock.reset();
    bedrockMock.reset();
    mockOpenSearchClient.index.mockClear();
    mockOpenSearchClient.bulk.mockClear();
    mockOpenSearchClient.search.mockClear();
    mockOpenSearchClient.delete.mockClear();
    mockOpenSearchClient.deleteByQuery.mockClear();

    // Mock S3 PutObjectCommand for storing Textract results
    s3Mock.on(PutObjectCommand).resolves({});

    // Mock Bedrock InvokeModelCommand for embeddings
    const mockEmbedding = Array(1024).fill(0.5);
    const embeddingResponse = JSON.stringify({
      embedding: mockEmbedding,
    });
    const encoded = new TextEncoder().encode(embeddingResponse);
    bedrockMock.on(InvokeModelCommand).resolves({
      body: Object.assign(encoded, {
        transformToString: () => embeddingResponse,
      }),
    });

    // Mock Lambda context
    mockContext = {
      awsRequestId: 'test-request-id',
      functionName: 'test-function',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
      memoryLimitInMB: '512',
      logGroupName: '/aws/lambda/test',
      logStreamName: '2024/01/01/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      callbackWaitsForEmptyEventLoop: true,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };
  });

  afterEach(() => {
    delete process.env['AWS_REGION'];
    delete process.env['DYNAMODB_METADATA_TABLE'];
    delete process.env['DYNAMODB_JOBS_TABLE'];
    delete process.env['TEXTRACT_CONFIDENCE_THRESHOLD'];
    delete process.env['TEXTRACT_COST_PER_PAGE'];
    delete process.env['OPENSEARCH_DOMAIN'];
    delete process.env['OPENSEARCH_INDEX_NAME'];
    delete process.env['BEDROCK_EMBEDDING_MODEL_ID'];
    delete process.env['LOG_LEVEL'];
  });

  describe('Success Path', () => {
    it('should process Textract completion notification successfully', async () => {
      const documentId = 'test-doc-id';
      const jobId = 'test-job-id';
      const textractJobId = 'textract-job-123';

      // Mock SNS event
      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Textract Job Complete',
              Message: JSON.stringify({
                JobId: textractJobId,
                Status: 'SUCCEEDED',
                API: 'StartDocumentTextDetection',
                Timestamp: Date.now(),
                DocumentLocation: {
                  S3ObjectName: 'test-user-123/workspace-123/test-key.pdf',
                  S3Bucket: 'test-bucket',
                },
              }),
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      // Mock DynamoDB QueryCommand (lookup job)
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          marshall({
            jobId,
            documentId,
            bucket: 'test-bucket',
            s3Key: 'test-user-123/workspace-123/test-key.pdf',
            status: 'TEXTRACT_IN_PROGRESS',
            createdAt: new Date().toISOString(),
            textractJobId,
          }),
        ],
      });

      // Mock Textract GetDocumentTextDetectionCommand (single page)
      const blocks: Block[] = [
        {
          BlockType: BlockType.PAGE,
          Id: 'page-1',
          Page: 1,
          Confidence: 99.5,
        },
        {
          BlockType: BlockType.LINE,
          Id: 'line-1',
          Page: 1,
          Text: 'This is a test document.',
          Confidence: 98.5,
          Geometry: {
            BoundingBox: {
              Width: 0.5,
              Height: 0.02,
              Left: 0.1,
              Top: 0.1,
            },
          },
        },
        {
          BlockType: BlockType.LINE,
          Id: 'line-2',
          Page: 1,
          Text: 'It contains multiple lines of text.',
          Confidence: 99.0,
          Geometry: {
            BoundingBox: {
              Width: 0.6,
              Height: 0.02,
              Left: 0.1,
              Top: 0.15,
            },
          },
        },
      ];

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        Blocks: blocks,
        DocumentMetadata: {
          Pages: 1,
        },
        JobStatus: 'SUCCEEDED',
        NextToken: undefined,
      });

      // Mock UpdateItemCommand (update job status and document metadata)
      dynamoMock.on(UpdateItemCommand).resolves({});

      // Execute handler
      await handler(event, mockContext);

      // Verify DynamoDB calls
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(2);

      // Verify Textract call
      expect(textractMock.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(1);
    });

    it('should handle paginated Textract results', async () => {
      const documentId = 'test-doc-id';
      const jobId = 'test-job-id';
      const textractJobId = 'textract-job-123';

      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Textract Job Complete',
              Message: JSON.stringify({
                JobId: textractJobId,
                Status: 'SUCCEEDED',
                API: 'StartDocumentTextDetection',
                Timestamp: Date.now(),
                DocumentLocation: {
                  S3ObjectName: 'test-user-123/workspace-123/test-key.pdf',
                  S3Bucket: 'test-bucket',
                },
              }),
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      // Mock job lookup
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          marshall({
            jobId,
            documentId,
            bucket: 'test-bucket',
            s3Key: 'test-user-123/workspace-123/test-key.pdf',
            status: 'TEXTRACT_IN_PROGRESS',
            createdAt: new Date().toISOString(),
            textractJobId,
          }),
        ],
      });

      // Mock paginated Textract results
      textractMock
        .on(GetDocumentTextDetectionCommand)
        .resolvesOnce({
          Blocks: [
            {
              BlockType: BlockType.PAGE,
              Id: 'page-1',
              Page: 1,
              Confidence: 99.5,
            },
            {
              BlockType: BlockType.LINE,
              Id: 'line-1',
              Page: 1,
              Text: 'Page 1 content',
              Confidence: 98.5,
              Geometry: {
                BoundingBox: { Width: 0.5, Height: 0.02, Left: 0.1, Top: 0.1 },
              },
            },
          ],
          NextToken: 'token-123',
        })
        .resolvesOnce({
          Blocks: [
            {
              BlockType: BlockType.PAGE,
              Id: 'page-2',
              Page: 2,
              Confidence: 99.3,
            },
            {
              BlockType: BlockType.LINE,
              Id: 'line-2',
              Page: 2,
              Text: 'Page 2 content',
              Confidence: 98.0,
              Geometry: {
                BoundingBox: { Width: 0.5, Height: 0.02, Left: 0.1, Top: 0.1 },
              },
            },
          ],
          NextToken: undefined,
        });

      // Mock updates
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, mockContext);

      // Verify Textract was called twice (pagination)
      expect(textractMock.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(2);
    });
  });

  describe('Failure Paths', () => {
    it('should handle Textract job failure', async () => {
      const documentId = 'test-doc-id';
      const jobId = 'test-job-id';
      const textractJobId = 'textract-job-123';

      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Textract Job Failed',
              Message: JSON.stringify({
                JobId: textractJobId,
                Status: 'FAILED',
                API: 'StartDocumentTextDetection',
                Timestamp: Date.now(),
                DocumentLocation: {
                  S3ObjectName: 'test-user-123/workspace-123/test-key.pdf',
                  S3Bucket: 'test-bucket',
                },
              }),
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      // Mock job lookup
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          marshall({
            jobId,
            documentId,
            bucket: 'test-bucket',
            s3Key: 'test-user-123/workspace-123/test-key.pdf',
            status: 'TEXTRACT_IN_PROGRESS',
            createdAt: new Date().toISOString(),
            textractJobId,
          }),
        ],
      });

      // Mock updates (should be called to mark as failed)
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, mockContext);

      // Should NOT call Textract (job failed)
      expect(textractMock.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(0);

      // Should update job and document status to FAILED
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(2);
    });

    it('should handle job not found gracefully', async () => {
      const textractJobId = 'textract-job-123';

      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Textract Job Complete',
              Message: JSON.stringify({
                JobId: textractJobId,
                Status: 'SUCCEEDED',
                API: 'StartDocumentTextDetection',
                Timestamp: Date.now(),
                DocumentLocation: {
                  S3ObjectName: 'test-user-123/workspace-123/test-key.pdf',
                  S3Bucket: 'test-bucket',
                },
              }),
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      // Mock job lookup - not found
      dynamoMock.on(QueryCommand).resolves({
        Items: [],
      });

      await handler(event, mockContext);

      // Should only call DynamoDB for lookup, then exit gracefully
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(1);
      expect(textractMock.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(0);
    });

    it('should handle invalid SNS message format', async () => {
      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Invalid Message',
              Message: 'Invalid JSON message',
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      await handler(event, mockContext);

      // Should not call any AWS services
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(0);
      expect(textractMock.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(0);
    });

    it('should handle Textract API errors', async () => {
      const documentId = 'test-doc-id';
      const jobId = 'test-job-id';
      const textractJobId = 'textract-job-123';

      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Textract Job Complete',
              Message: JSON.stringify({
                JobId: textractJobId,
                Status: 'SUCCEEDED',
                API: 'StartDocumentTextDetection',
                Timestamp: Date.now(),
                DocumentLocation: {
                  S3ObjectName: 'test-user-123/workspace-123/test-key.pdf',
                  S3Bucket: 'test-bucket',
                },
              }),
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      // Mock job lookup
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          marshall({
            jobId,
            documentId,
            bucket: 'test-bucket',
            s3Key: 'test-user-123/workspace-123/test-key.pdf',
            status: 'TEXTRACT_IN_PROGRESS',
            createdAt: new Date().toISOString(),
            textractJobId,
          }),
        ],
      });

      // Mock Textract error
      textractMock
        .on(GetDocumentTextDetectionCommand)
        .rejects(new Error('Textract API error'));

      // Mock updates
      dynamoMock.on(UpdateItemCommand).resolves({});

      // Handler should not throw (uses Promise.allSettled)
      await handler(event, mockContext);

      // Should still try to update status to FAILED_TEXTRACT_PROCESSING
      expect(dynamoMock.commandCalls(UpdateItemCommand).length).toBeGreaterThan(0);
    });
  });

  describe('Table Parsing', () => {
    it('should parse tables into markdown format', async () => {
      const documentId = 'test-doc-id';
      const jobId = 'test-job-id';
      const textractJobId = 'textract-job-123';

      const event: SNSEvent = {
        Records: [
          {
            EventSource: 'aws:sns',
            EventVersion: '1.0',
            EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
            Sns: {
              Type: 'Notification',
              MessageId: 'message-id-123',
              TopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
              Subject: 'Textract Job Complete',
              Message: JSON.stringify({
                JobId: textractJobId,
                Status: 'SUCCEEDED',
                API: 'StartDocumentTextDetection',
                Timestamp: Date.now(),
                DocumentLocation: {
                  S3ObjectName: 'test-user-123/workspace-123/test-key.pdf',
                  S3Bucket: 'test-bucket',
                },
              }),
              Timestamp: new Date().toISOString(),
              SignatureVersion: '1',
              Signature: 'signature',
              SigningCertUrl: 'https://cert-url',
              UnsubscribeUrl: 'https://unsubscribe-url',
              MessageAttributes: {},
            },
          },
        ],
      };

      // Mock job lookup
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          marshall({
            jobId,
            documentId,
            bucket: 'test-bucket',
            s3Key: 'test-user-123/workspace-123/test-key.pdf',
            status: 'TEXTRACT_IN_PROGRESS',
            createdAt: new Date().toISOString(),
            textractJobId,
          }),
        ],
      });

      // Mock Textract response with table
      const blocks: Block[] = [
        {
          BlockType: BlockType.PAGE,
          Id: 'page-1',
          Page: 1,
          Confidence: 99.5,
        },
        {
          BlockType: BlockType.TABLE,
          Id: 'table-1',
          Page: 1,
          Confidence: 95.0,
          Relationships: [
            {
              Type: 'CHILD',
              Ids: ['cell-1', 'cell-2', 'cell-3', 'cell-4'],
            },
          ],
        },
        {
          BlockType: BlockType.CELL,
          Id: 'cell-1',
          RowIndex: 1,
          ColumnIndex: 1,
          Page: 1,
          Relationships: [{ Type: 'CHILD', Ids: ['word-1'] }],
        },
        {
          BlockType: BlockType.CELL,
          Id: 'cell-2',
          RowIndex: 1,
          ColumnIndex: 2,
          Page: 1,
          Relationships: [{ Type: 'CHILD', Ids: ['word-2'] }],
        },
        {
          BlockType: BlockType.CELL,
          Id: 'cell-3',
          RowIndex: 2,
          ColumnIndex: 1,
          Page: 1,
          Relationships: [{ Type: 'CHILD', Ids: ['word-3'] }],
        },
        {
          BlockType: BlockType.CELL,
          Id: 'cell-4',
          RowIndex: 2,
          ColumnIndex: 2,
          Page: 1,
          Relationships: [{ Type: 'CHILD', Ids: ['word-4'] }],
        },
        {
          BlockType: BlockType.WORD,
          Id: 'word-1',
          Text: 'Header1',
          Page: 1,
        },
        {
          BlockType: BlockType.WORD,
          Id: 'word-2',
          Text: 'Header2',
          Page: 1,
        },
        {
          BlockType: BlockType.WORD,
          Id: 'word-3',
          Text: 'Value1',
          Page: 1,
        },
        {
          BlockType: BlockType.WORD,
          Id: 'word-4',
          Text: 'Value2',
          Page: 1,
        },
      ];

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        Blocks: blocks,
        DocumentMetadata: { Pages: 1 },
        JobStatus: 'SUCCEEDED',
      });

      // Mock updates
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, mockContext);

      // Verify successful execution
      expect(textractMock.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(QueryCommand)).toHaveLength(1);
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(2);
    });
  });
});
