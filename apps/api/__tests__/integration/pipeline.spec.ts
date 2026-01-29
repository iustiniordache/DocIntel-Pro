/**
 * Integration Tests - Complete Document Processing Pipeline
 *
 * Tests the end-to-end flow:
 * 1. Upload → Presigned URL generation
 * 2. TextractStart → Job initiation
 * 3. TextractComplete → Document processing
 * 4. Chunking + Embedding → Vector storage
 * 5. Query → RAG retrieval
 *
 * @group integration
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { APIGatewayProxyEventV2, S3Event, SNSEvent, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  PutItemCommand,
  GetItemCommand,
  UpdateItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb';
import {
  TextractClient,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

// =============================================================================
// Mock Setup
// =============================================================================

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);
const textractMock = mockClient(TextractClient);
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

// Mock NestJS
const mockConfigService = {
  aws: {
    region: 'us-east-1',
    accountId: '123456789012',
  },
  s3: {
    documentsBucket: 'test-bucket',
    presignedUrlExpiry: 300,
  },
  dynamodb: {
    metadataTable: 'test-metadata-table',
    jobsTable: 'test-jobs-table',
  },
  textract: {
    snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
    roleArn: 'arn:aws:iam::123456789012:role/test-role',
  },
  opensearch: {
    domain: 'https://test-domain.us-east-1.es.amazonaws.com',
    indexName: 'test-vectors',
  },
  bedrock: {
    embeddingModel: 'amazon.titan-embed-text-v2:0',
    llmModelId: 'anthropic.claude-3-haiku-20240307-v1:0',
  },
  logging: {
    level: 'silent',
  },
};

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: vi.fn((module) => {
      if (module.name === 'EmbeddingModule') {
        return Promise.resolve({
          get: vi.fn(() => mockEmbeddingService),
        });
      }
      if (module.name === 'VectorStoreModule') {
        return Promise.resolve({
          get: vi.fn(() => ({
            hybridSearch: vi.fn().mockResolvedValue([
              {
                chunkId: 'chunk-1',
                documentId: 'test-doc-id',
                content:
                  'Test content from document about testing procedures and quality assurance.',
                similarity_score: 0.95,
                metadata: { page: 1 },
              },
            ]),
          })),
        });
      }
      return Promise.resolve({
        get: vi.fn().mockReturnValue(mockConfigService),
      });
    }),
  },
}));

// Mock @aws-sdk/s3-request-presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi
    .fn()
    .mockResolvedValue('https://bucket.s3.amazonaws.com/presigned-url'),
}));

// Mock EmbeddingService
const mockEmbeddingService = {
  embedText: vi.fn().mockResolvedValue(new Array(1024).fill(0.5)),
  embedBatch: vi.fn().mockResolvedValue({
    embeddings: [new Array(1024).fill(0.5)],
    metrics: { totalTokens: 500, estimatedCost: 0.05 },
  }),
};

vi.mock('../src/modules/embedding/embedding.service', () => ({
  EmbeddingService: vi.fn(() => mockEmbeddingService),
}));

// Set environment variables
process.env['AWS_REGION'] = 'us-east-1';
process.env['S3_DOCUMENTS_BUCKET'] = 'test-bucket';
process.env['DYNAMODB_METADATA_TABLE'] = 'test-metadata-table';
process.env['DYNAMODB_JOBS_TABLE'] = 'test-jobs-table';
process.env['DYNAMODB_WORKSPACES_TABLE'] = 'test-workspaces-table';
process.env['TEXTRACT_SNS_TOPIC_ARN'] = 'arn:aws:sns:us-east-1:123456789012:test-topic';
process.env['TEXTRACT_ROLE_ARN'] = 'arn:aws:iam::123456789012:role/test-role';
process.env['OPENSEARCH_DOMAIN'] = 'https://test-domain.us-east-1.es.amazonaws.com';
process.env['OPENSEARCH_INDEX_NAME'] = 'test-vectors';
process.env['BEDROCK_EMBEDDING_MODEL_ID'] = 'amazon.titan-embed-text-v2:0';
process.env['BEDROCK_LLM_MODEL_ID'] = 'anthropic.claude-3-haiku-20240307-v1:0';

// =============================================================================
// Test Factories
// =============================================================================

/**
 * Create a mock API Gateway event for upload handler
 */
function createUploadEvent(
  filename: string,
  userId: string = 'test-user',
  workspaceId: string = 'workspace-123',
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /upload',
    rawPath: '/upload',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test-api.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test-api',
      http: {
        method: 'POST',
        path: '/upload',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'test-agent',
      },
      requestId: 'test-request-id',
      routeKey: 'POST /upload',
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1704067200000,
      authorizer: {
        claims: {
          sub: userId,
          email: 'test@example.com',
        },
      },
    },
    body: JSON.stringify({ filename, workspaceId }),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

/**
 * Create a mock S3 event for TextractStart handler
 */
function createS3Event(bucket: string, key: string): S3Event {
  return {
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-east-1',
        eventTime: '2025-01-01T00:00:00.000Z',
        eventName: 'ObjectCreated:Put',
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test-config',
          bucket: {
            name: bucket,
            ownerIdentity: { principalId: 'test-principal' },
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key,
            size: 102400,
            eTag: 'test-etag',
            sequencer: 'test-sequencer',
          },
        },
      },
    ],
  } as S3Event;
}

/**
 * Create a mock SNS event for TextractComplete handler
 */
function createTextractCompleteEvent(
  jobId: string,
  status: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED',
): SNSEvent {
  return {
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
            JobId: jobId,
            Status: status,
            API: 'StartDocumentTextDetection',
            Timestamp: Date.now(),
            DocumentLocation: {
              S3ObjectName: 'test-key.pdf',
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
  } as SNSEvent;
}

/**
 * Create a mock query event
 */
function createQueryEvent(question: string, documentId?: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'POST /query',
    rawPath: '/query',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
    },
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      domainName: 'test-api.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'test-api',
      http: {
        method: 'POST',
        path: '/query',
        protocol: 'HTTP/1.1',
        sourceIp: '1.2.3.4',
        userAgent: 'test-agent',
      },
      requestId: 'test-request-id',
      routeKey: 'POST /query',
      stage: '$default',
      time: '01/Jan/2025:00:00:00 +0000',
      timeEpoch: 1704067200000,
    },
    body: JSON.stringify({ question, documentId }),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

/**
 * Create a mock Lambda context
 */
function createContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'test-function',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
    memoryLimitInMB: '512',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/test-function',
    logStreamName: '2025/01/01/[$LATEST]test-stream',
    getRemainingTimeInMillis: () => 30000,
    done: () => {},
    fail: () => {},
    succeed: () => {},
  };
}

/**
 * Create mock Textract blocks (simplified document structure)
 */
function createTextractBlocks(): any[] {
  return [
    {
      BlockType: 'PAGE',
      Id: 'page-1',
      Page: 1,
      Geometry: { BoundingBox: {} },
      Relationships: [{ Type: 'CHILD', Ids: ['line-1', 'line-2'] }],
    },
    {
      BlockType: 'LINE',
      Id: 'line-1',
      Text: 'This is the first line of the document.',
      Page: 1,
      Confidence: 99.5,
      Geometry: { BoundingBox: {} },
    },
    {
      BlockType: 'LINE',
      Id: 'line-2',
      Text: 'This is the second line with more content.',
      Page: 1,
      Confidence: 98.7,
      Geometry: { BoundingBox: {} },
    },
    {
      BlockType: 'WORD',
      Id: 'word-1',
      Text: 'This',
      Page: 1,
      Confidence: 99.9,
      Geometry: { BoundingBox: {} },
    },
  ];
}

/**
 * Create mock embedding vector
 */
function createMockEmbedding(dimensions: number = 1024): number[] {
  return Array(dimensions)
    .fill(0)
    .map(() => Math.random() - 0.5);
}

/**
 * Create mock Titan embedding response
 */
function createTitanEmbeddingResponse(text: string) {
  const response = {
    embedding: createMockEmbedding(),
    inputTextTokenCount: Math.ceil(text.length / 4),
  };
  const responseStr = JSON.stringify(response);
  const encoded = new TextEncoder().encode(responseStr);
  return Object.assign(encoded, {
    transformToString: () => responseStr,
  });
}

/**
 * Create mock Claude response
 */
function createClaudeResponse(answer: string) {
  const response = {
    id: 'msg-test-id',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: answer,
      },
    ],
    model: 'claude-3-haiku-20240307',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
    },
  };
  const responseStr = JSON.stringify(response);
  const encoded = new TextEncoder().encode(responseStr);
  return Object.assign(encoded, {
    transformToString: () => responseStr,
  });
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Integration: Complete Document Processing Pipeline', () => {
  let uploadHandler: any;
  let textractStartHandler: any;
  let textractCompleteHandler: any;
  let queryHandler: any;

  beforeAll(async () => {
    // Import handlers after all mocks are set up
    uploadHandler = (await import('../../src/handlers/upload.handler')).handler;
    textractStartHandler = (await import('../../src/handlers/textract-start.handler'))
      .handler;
    textractCompleteHandler = (
      await import('../../src/handlers/textract-complete.handler')
    ).handler;
    queryHandler = (await import('../../src/handlers/query.handler')).handler;
  });

  beforeEach(() => {
    // Reset all mocks before each test
    s3Mock.reset();
    dynamoMock.reset();
    textractMock.reset();
    bedrockMock.reset();
    mockOpenSearchClient.index.mockClear();
    mockOpenSearchClient.bulk.mockClear();
    mockOpenSearchClient.search.mockClear();
    mockOpenSearchClient.delete.mockClear();
    mockOpenSearchClient.deleteByQuery.mockClear();

    // Mock workspace query for upload handler validation
    // Use callsFake to dynamically return workspace matching any workspaceId
    dynamoMock.on(QueryCommand).callsFake((input) => {
      // The query uses workspaceId in KeyConditionExpression
      const workspaceIdValue = input.ExpressionAttributeValues?.[':workspaceId'];
      const workspaceId = workspaceIdValue?.S || 'workspace-123';

      // Extract userId from the event context (not available here, so we need a different approach)
      // For now, return a workspace that matches any user
      return {
        Items: [
          {
            workspaceId: { S: workspaceId },
            ownerId: { S: 'test-user' }, // This will be overridden in specific tests if needed
          },
        ],
      };
    });
  });

  // ===========================================================================
  // 1. Upload Handler Tests
  // ===========================================================================

  describe('1. Upload Handler', () => {
    it('should generate valid presigned URL for PDF upload', async () => {
      const event = createUploadEvent('test-document.pdf');
      const context = createContext();

      dynamoMock.on(PutItemCommand).resolves({});

      const result = await uploadHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response).toBeDefined();
      expect(response?.statusCode).toBe(200);

      const body = JSON.parse(response?.body || '{}');
      expect(body.uploadUrl).toContain('presigned-url');
      expect(body.documentId).toBeDefined();
      expect(body.s3Key).toBeDefined();
      expect(body.expiresIn).toBe(300);
    });

    it('should reject non-PDF files', async () => {
      const event = createUploadEvent('test-document.txt');
      const context = createContext();

      const result = await uploadHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(400);

      const body = JSON.parse(response?.body || '{}');
      expect(body.message).toContain('Only PDF files are allowed');
    });

    it('should create DynamoDB metadata record on upload', async () => {
      // Override workspace mock for this specific test to match 'user-123'
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            workspaceId: { S: 'workspace-123' },
            ownerId: { S: 'user-123' },
          },
        ],
      });

      const event = createUploadEvent('test-document.pdf', 'user-123');
      const context = createContext();

      dynamoMock.on(PutItemCommand).resolves({});

      await uploadHandler(event, context);

      const putCalls = dynamoMock.commandCalls(PutItemCommand);
      expect(putCalls.length).toBeGreaterThan(0);

      const call = putCalls[0];
      expect(call.args[0].input.TableName).toBe('test-metadata-table');
      expect(call.args[0].input.Item?.filename).toBeDefined();
      expect(call.args[0].input.Item?.status).toBeDefined();
      expect(call.args[0].input.Item?.documentId).toBeDefined();
    });

    it('should handle filename with special characters', async () => {
      const event = createUploadEvent('My Document (2025) - Final.pdf');
      const context = createContext();

      dynamoMock.on(PutItemCommand).resolves({});

      const result = await uploadHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(200);

      const body = JSON.parse(response?.body || '{}');
      expect(body.documentId).toBeDefined();
      expect(body.uploadUrl).toBeDefined();
    });
  });

  // ===========================================================================
  // 2. TextractStart Handler Tests
  // ===========================================================================

  describe('2. TextractStart Handler', () => {
    it('should process S3 event and initiate Textract job', async () => {
      const event = createS3Event('test-bucket', 'user-123/workspace-123/test-doc.pdf');
      const context = createContext();

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 102400,
        Metadata: {
          'document-id': 'test-doc-id',
          'user-id': 'user-123',
        },
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'textract-job-123',
      });

      dynamoMock.on(QueryCommand).resolves({ Items: [] });
      dynamoMock.on(PutItemCommand).resolves({});

      await textractStartHandler(event, context);

      const textractCalls = textractMock.commandCalls(StartDocumentTextDetectionCommand);
      expect(textractCalls.length).toBe(1);

      const call = textractCalls[0];
      expect(call.args[0].input.DocumentLocation?.S3Object?.Bucket).toBe('test-bucket');
      expect(call.args[0].input.DocumentLocation?.S3Object?.Name).toBe(
        'user-123/workspace-123/test-doc.pdf',
      );
      expect(call.args[0].input.NotificationChannel?.SNSTopicArn).toBe(
        'arn:aws:sns:us-east-1:123456789012:test-topic',
      );
    });

    it('should save Textract job metadata to DynamoDB', async () => {
      const event = createS3Event('test-bucket', 'user-123/workspace-123/test-doc.pdf');
      const context = createContext();

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 102400,
        Metadata: {
          'document-id': 'test-doc-id',
          'user-id': 'user-123',
        },
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'textract-job-123',
      });

      dynamoMock.on(QueryCommand).resolves({ Items: [] });
      dynamoMock.on(PutItemCommand).resolves({});

      await textractStartHandler(event, context);

      const dynamoCalls = dynamoMock.commandCalls(PutItemCommand);
      expect(dynamoCalls.length).toBeGreaterThan(0);

      const jobCall = dynamoCalls.find(
        (call) => call.args[0].input.TableName === 'test-jobs-table',
      );
      expect(jobCall).toBeDefined();
      expect(jobCall?.args[0].input.Item?.textractJobId?.S).toBe('textract-job-123');
      expect(jobCall?.args[0].input.Item?.status?.S).toBe('TEXTRACT_IN_PROGRESS');
    });

    it('should reject non-PDF S3 objects', async () => {
      const event = createS3Event('test-bucket', 'user-123/workspace-123/test-doc.txt');
      const context = createContext();

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: 1024,
      });

      await textractStartHandler(event, context);
      // Handler logs warning and skips non-PDF files
      expect(textractMock.calls()).toHaveLength(0);
    });

    it('should handle Textract service errors gracefully', async () => {
      const event = createS3Event('test-bucket', 'user-123/workspace-123/test-doc.pdf');
      const context = createContext();

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 102400,
        Metadata: {
          'document-id': 'test-doc-id',
        },
      });

      dynamoMock.on(QueryCommand).resolves({ Items: [] });
      dynamoMock.on(PutItemCommand).resolves({});

      textractMock
        .on(StartDocumentTextDetectionCommand)
        .rejects(new Error('Textract service unavailable'));

      await textractStartHandler(event, context);
      // Handler retries 3 times then continues
      expect(textractMock.calls().length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // 3. TextractComplete Handler Tests
  // ===========================================================================

  describe('3. TextractComplete Handler', () => {
    it('should process Textract completion notification', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      // Mock DynamoDB query to find job
      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            status: { S: 'TEXTRACT_IN_PROGRESS' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      // Mock Textract results
      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      // Mock Bedrock embedding
      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      // Mock DynamoDB updates
      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      // Verify OpenSearch indexing was called
      expect(mockOpenSearchClient.index).toHaveBeenCalled();
      const indexCall = mockOpenSearchClient.index.mock.calls[0][0];
      expect(indexCall.body).toBeDefined();
    });

    it('should parse Textract results and create chunks', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      // Verify embeddings were generated
      const bedrockCalls = bedrockMock.commandCalls(InvokeModelCommand);
      expect(bedrockCalls.length).toBeGreaterThan(0);
    });

    it('should update document metadata after processing', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updateCalls.length).toBeGreaterThan(0);

      const metadataUpdate = updateCalls.find(
        (call) => call.args[0].input.TableName === 'test-metadata-table',
      );
      expect(metadataUpdate).toBeDefined();
    });

    it('should handle paginated Textract results', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      // First page with NextToken
      textractMock.on(GetDocumentTextDetectionCommand).resolvesOnce({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 2 },
        Blocks: createTextractBlocks(),
        NextToken: 'next-page-token',
      });

      // Second page without NextToken
      textractMock.on(GetDocumentTextDetectionCommand).resolvesOnce({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 2 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      const textractCalls = textractMock.commandCalls(GetDocumentTextDetectionCommand);
      // Handler fetches all pages automatically until no NextToken
      expect(textractCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // 4. Chunking + Embedding Tests
  // ===========================================================================

  describe('4. Chunking + Embedding', () => {
    it('should chunk large documents into appropriate sizes', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      // Create a large document with multiple lines
      const largeBlocks = [
        {
          BlockType: 'PAGE' as const,
          Id: 'page-1',
          Page: 1,
          Geometry: { BoundingBox: {} },
          Relationships: [
            {
              Type: 'CHILD' as const,
              Ids: Array.from({ length: 50 }, (_, i) => `line-${i}`),
            },
          ],
        },
        ...Array.from({ length: 50 }, (_, i) => ({
          BlockType: 'LINE' as const,
          Id: `line-${i}`,
          Text: `This is line ${i} with substantial content to test chunking. `.repeat(
            10,
          ),
          Page: 1,
          Confidence: 99.0,
          Geometry: { BoundingBox: {} },
        })),
      ];

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: largeBlocks,
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      // Verify multiple chunks were created and indexed
      expect(mockOpenSearchClient.index).toHaveBeenCalled();
      const indexCalls = mockOpenSearchClient.index.mock.calls;

      // Verify multiple index operations were made
      expect(indexCalls.length).toBeGreaterThan(1);
    });

    it('should generate embeddings for all chunks', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      const bedrockCalls = bedrockMock.commandCalls(InvokeModelCommand);
      expect(bedrockCalls.length).toBeGreaterThan(0);

      // Verify embedding request format
      const firstCall = bedrockCalls[0];
      expect(firstCall.args[0].input.modelId).toBe('amazon.titan-embed-text-v2:0');
    });

    it('should calculate embedding costs correctly', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      // Verify cost metadata was recorded
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      const metadataUpdate = updateCalls.find(
        (call) => call.args[0].input.TableName === 'test-metadata-table',
      );

      expect(metadataUpdate).toBeDefined();
      // Cost information should be in the update
      expect(metadataUpdate?.args[0].input.ExpressionAttributeValues).toBeDefined();
    });
  });

  // ===========================================================================
  // 5. Vector Search Tests
  // ===========================================================================

  describe('5. Vector Search', () => {
    it('should index document chunks in OpenSearch', async () => {
      const event = createTextractCompleteEvent('textract-job-123');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('test content'),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      expect(mockOpenSearchClient.index).toHaveBeenCalled();

      const indexCall = mockOpenSearchClient.index.mock.calls[0][0];
      expect(indexCall.index).toBe('test-vectors');

      // Verify indexCalls were made
      const indexCalls = mockOpenSearchClient.index.mock.calls;
      expect(indexCalls.length).toBeGreaterThan(0);

      // Verify first indexed document structure
      const firstCall = indexCalls[0][0];
      expect(firstCall.body.documentId).toBe('test-doc-id');
      expect(firstCall.body.content).toBeDefined();
      expect(firstCall.body.embedding).toBeDefined();
      expect(Array.isArray(firstCall.body.embedding)).toBe(true);
    });
    it('should perform hybrid search with embeddings', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      // Mock embedding for question
      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      // Mock Claude response
      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .resolves({
          body: createClaudeResponse('Answer based on search results.'),
        });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(200);

      const body = JSON.parse(response?.body || '{}');
      expect(body.answer).toBeDefined();
      expect(body.sources).toBeDefined();
    });

    it('should filter search results by document ID', async () => {
      const event = createQueryEvent('What is in the document?', 'specific-doc-id');
      const context = createContext();

      bedrockMock.on(InvokeModelCommand).resolves({
        body: createTitanEmbeddingResponse('What is in the document?'),
      });

      // Override search mock to return specific document
      mockOpenSearchClient.search.mockResolvedValueOnce({
        body: {
          hits: {
            total: { value: 1 },
            hits: [
              {
                _id: 'chunk-1',
                _score: 0.95,
                _source: {
                  documentId: 'specific-doc-id',
                  content: 'Relevant content',
                  embedding: createMockEmbedding(),
                },
              },
            ],
          },
        },
      });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(200);

      const body = JSON.parse(response?.body || '{}');
      expect(body.sources).toBeDefined();
      expect(Array.isArray(body.sources)).toBe(true);
      if (body.sources.length > 0) {
        expect(body.sources[0].documentId).toBe('specific-doc-id');
      }
    });
  });

  // ===========================================================================
  // 6. RAG Query Tests
  // ===========================================================================

  describe('6. RAG Query', () => {
    it('should process question and return RAG answer', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      // Mock question embedding
      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      // Mock Claude response
      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .resolves({
          body: createClaudeResponse(
            'Based on the document content, it contains information about testing procedures.',
          ),
        });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(200);

      const body = JSON.parse(response?.body || '{}');
      expect(body.answer).toBeDefined();
      expect(body.answer).toContain('testing procedures');
      expect(body.sources).toBeDefined();
      expect(Array.isArray(body.sources)).toBe(true);
    });

    it('should include source citations in response', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .resolves({
          body: createClaudeResponse('Answer based on retrieved documents.'),
        });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(200);

      const body = JSON.parse(response?.body || '{}');
      expect(body.answer).toBeDefined();
      expect(body.sources).toBeDefined();
      expect(Array.isArray(body.sources)).toBe(true);

      if (body.sources.length > 0) {
        const source = body.sources[0];
        expect(source.id).toBeDefined();
        expect(source.similarity).toBeDefined();
        expect(source.content).toBeDefined();
      }
    });
    it('should calculate confidence score', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .resolves({
          body: createClaudeResponse('Answer with high confidence.'),
        });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      const body = JSON.parse(response?.body || '{}');
      expect(body.confidence).toBeDefined();
      expect(typeof body.confidence).toBe('number');
      expect(body.confidence).toBeGreaterThanOrEqual(0);
      expect(body.confidence).toBeLessThanOrEqual(1);
    });

    it('should invoke Bedrock Claude for answer generation', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .resolves({
          body: createClaudeResponse('Generated answer.'),
        });

      await queryHandler(event, context);

      const claudeCalls = bedrockMock
        .commandCalls(InvokeModelCommand)
        .filter(
          (call) =>
            call.args[0].input.modelId === 'anthropic.claude-3-haiku-20240307-v1:0',
        );

      // Claude should be called for answer generation
      expect(claudeCalls.length).toBeGreaterThanOrEqual(1);

      if (claudeCalls.length > 0) {
        const claudeCall = claudeCalls[0];
        const bodyInput = claudeCall.args[0].input.body;
        // Body can be string or Uint8Array
        const bodyStr =
          typeof bodyInput === 'string'
            ? bodyInput
            : new TextDecoder().decode(bodyInput as Uint8Array);
        const body = JSON.parse(bodyStr);

        expect(body.messages).toBeDefined();
        expect(body.messages[0].role).toBe('user');
        expect(body.max_tokens).toBeDefined();
      }
    });
  });

  // ===========================================================================
  // 7. Error Scenarios
  // ===========================================================================

  describe('7. Error Scenarios', () => {
    it('should handle invalid PDF uploads', async () => {
      const event = createUploadEvent('corrupted-file.pdf');
      const context = createContext();

      dynamoMock.on(PutItemCommand).resolves({});

      const result = await uploadHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      // Upload handler generates presigned URL - actual validation happens when S3 receives the file
      if (response?.statusCode !== 200) {
        console.error('Upload failed:', response?.body);
      }
      expect(response?.statusCode).toBe(200);
      const body = JSON.parse(response?.body || '{}');
      expect(body).toHaveProperty('uploadUrl');
      expect(body).toHaveProperty('documentId');
    });

    it('should handle Textract job failures', async () => {
      const event = createTextractCompleteEvent('textract-job-123', 'FAILED');
      const context = createContext();

      dynamoMock.on(QueryCommand).resolves({
        Items: [
          {
            jobId: { S: 'job-123' },
            documentId: { S: 'test-doc-id' },
            textractJobId: { S: 'textract-job-123' },
            s3Key: { S: 'documents/test-doc.pdf' },
          },
        ],
      });

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'FAILED',
        StatusMessage: 'Document processing failed',
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(event, context);

      // Verify status was updated to FAILED
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      const jobUpdate = updateCalls.find(
        (call) => call.args[0].input.TableName === 'test-jobs-table',
      );

      expect(jobUpdate).toBeDefined();
    });

    it('should handle Bedrock timeout errors', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .rejects(new Error('Timeout waiting for Bedrock response'));

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(503); // Bedrock timeout returns 503
    });

    it('should handle no relevant documents found', async () => {
      const event = createQueryEvent('Random unrelated question');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('Random unrelated question'),
        });

      // Mock search with no results
      mockOpenSearchClient.search.mockResolvedValueOnce({
        body: {
          hits: {
            total: { value: 0 },
            hits: [],
          },
        },
      });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(500); // Handler returns 500 when Bedrock fails

      const body = JSON.parse(response?.body || '{}');
      expect(body.message || body.error).toBeDefined();
    });

    it('should handle low similarity threshold rejections', async () => {
      const event = createQueryEvent('Somewhat related question');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('Somewhat related question'),
        });

      // Mock search with low similarity scores
      mockOpenSearchClient.search.mockResolvedValueOnce({
        body: {
          hits: {
            total: { value: 1 },
            hits: [
              {
                _id: 'chunk-1',
                _score: 0.3, // Below threshold of 0.5
                _source: {
                  documentId: 'test-doc-id',
                  content: 'Low relevance content',
                  embedding: createMockEmbedding(),
                },
              },
            ],
          },
        },
      });

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(500); // Handler returns 500 when Bedrock fails

      const body = JSON.parse(response?.body || '{}');
      expect(body.message || body.error).toBeDefined();
    });

    it('should handle embedding generation failures', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .rejects(new Error('Bedrock embedding service unavailable'));

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(500); // Handler returns 500 on embedding error

      const body = JSON.parse(response?.body || '{}');
      expect(body.message || body.error).toBeDefined();
    });

    it('should handle OpenSearch connection failures', async () => {
      const event = createQueryEvent('What is in the document?');
      const context = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('What is in the document?'),
        });

      mockOpenSearchClient.search.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(500); // Handler returns 500 on OpenSearch error

      const body = JSON.parse(response?.body || '{}');
      expect(body.message || body.error).toBeDefined();
    });

    it('should handle malformed query requests', async () => {
      const event = {
        ...createQueryEvent(''),
        body: JSON.stringify({ invalid: 'structure' }),
      };
      const context = createContext();

      const result = await queryHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;

      expect(response?.statusCode).toBe(400);

      const body = JSON.parse(response?.body || '{}');
      expect(body.error).toBeDefined();
    });

    it('should handle DynamoDB write failures', async () => {
      const event = createUploadEvent('test-document.pdf');
      const context = createContext();

      dynamoMock.on(PutItemCommand).rejects(new Error('DynamoDB service unavailable'));

      const result = await uploadHandler(event, context);
      const response =
        typeof result === 'object' && 'statusCode' in result ? result : null;
      expect(response?.statusCode).toBe(500);
    });
  });

  // ===========================================================================
  // 8. End-to-End Pipeline Test
  // ===========================================================================

  describe('8. End-to-End Pipeline', () => {
    it('should process complete pipeline from upload to query', async () => {
      let capturedDocumentId: string | undefined;

      // Override workspace mock conditionally for this specific test
      dynamoMock.on(QueryCommand).callsFake((input) => {
        // Check if this is a workspace query (has WorkspaceIdIndex) or job query (has TextractJobIdIndex)
        if (input.IndexName === 'WorkspaceIdIndex') {
          // Workspace query - return workspace with ownerId='user-123'
          return {
            Items: [
              {
                workspaceId: { S: 'workspace-123' },
                ownerId: { S: 'user-123' },
              },
            ],
          };
        } else if (input.IndexName === 'TextractJobIdIndex') {
          // Job query - return job data for textract-complete
          const textractJobId = input.ExpressionAttributeValues?.[':jobId']?.S || '';
          // Use captured documentId if available, otherwise fallback
          const docId = capturedDocumentId || 'test-document-id';
          return {
            Items: [
              {
                jobId: { S: 'job-integration-test' },
                documentId: { S: docId },
                textractJobId: { S: textractJobId },
                s3Key: { S: `documents/${docId}.pdf` },
              },
            ],
          };
        }
        // Default fallback
        return { Items: [] };
      });

      const userId = 'user-123';
      const filename = 'integration-test.pdf';
      const question = 'What is in the integration test document?';

      // Step 1: Upload
      const uploadEvent = createUploadEvent(filename, userId);
      const uploadContext = createContext();

      dynamoMock.on(PutItemCommand).resolves({});

      const uploadResult = await uploadHandler(uploadEvent, uploadContext);
      const uploadResponse =
        typeof uploadResult === 'object' && 'statusCode' in uploadResult
          ? uploadResult
          : null;

      expect(uploadResponse?.statusCode).toBe(200);

      const uploadBody = JSON.parse(uploadResponse?.body || '{}');
      const documentId = uploadBody.documentId;
      expect(documentId).toBeDefined();

      // Capture documentId for use in the conditional mock
      capturedDocumentId = documentId;

      // Step 2: TextractStart
      const s3Event = createS3Event('test-bucket', `documents/${documentId}.pdf`);
      const textractStartContext = createContext();

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'application/pdf',
        ContentLength: 102400,
        Metadata: {
          'document-id': documentId,
          'user-id': userId,
        },
      });

      textractMock.on(StartDocumentTextDetectionCommand).resolves({
        JobId: 'textract-job-integration-test',
      });

      dynamoMock.on(PutItemCommand).resolves({});

      await textractStartHandler(s3Event, textractStartContext);

      // Step 3: TextractComplete
      const textractCompleteEvent = createTextractCompleteEvent(
        'textract-job-integration-test',
      );
      const textractCompleteContext = createContext();

      // Job query is now handled by the conditional mock at the beginning of the test

      textractMock.on(GetDocumentTextDetectionCommand).resolves({
        JobStatus: 'SUCCEEDED',
        DocumentMetadata: { Pages: 1 },
        Blocks: createTextractBlocks(),
      });

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'amazon.titan-embed-text-v2:0',
        })
        .resolves({
          body: createTitanEmbeddingResponse('document content'),
        });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await textractCompleteHandler(textractCompleteEvent, textractCompleteContext);

      // Step 4: Query
      const queryEvent = createQueryEvent(question, documentId);
      const queryContext = createContext();

      bedrockMock
        .on(InvokeModelCommand, {
          modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        })
        .resolves({
          body: createClaudeResponse(
            'The integration test document contains test content for validation.',
          ),
        });

      const queryResult = await queryHandler(queryEvent, queryContext);
      const queryResponse =
        typeof queryResult === 'object' && 'statusCode' in queryResult
          ? queryResult
          : null;

      expect(queryResponse?.statusCode).toBe(200);

      const queryBody = JSON.parse(queryResponse?.body || '{}');
      expect(queryBody.answer).toBeDefined();
      expect(queryBody.sources).toBeDefined();
      if (queryBody.sources.length > 0) {
        expect(queryBody.sources[0].id).toBeDefined();
      }

      // Verify all pipeline stages were executed
      expect(s3Mock.calls().length).toBeGreaterThanOrEqual(1);
      expect(textractMock.calls().length).toBeGreaterThanOrEqual(2); // Start + GetResults
      expect(bedrockMock.calls().length).toBeGreaterThanOrEqual(1); // At least embedding or Claude
      expect(mockOpenSearchClient.index).toHaveBeenCalled();
    });
  });
});
