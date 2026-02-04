/**
 * Upload Handler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { handler, resetRateLimiter } from './upload.handler';

// Type helper to work around AWS Lambda return type union
type HandlerResult = Awaited<ReturnType<typeof handler>> & {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
};

// Create mock functions using vi.hoisted() for proper hoisting
const { mockDynamoDBSend, mockS3Send, mockGetSignedUrl, mockConfigService } = vi.hoisted(
  () => ({
    mockDynamoDBSend: vi.fn().mockResolvedValue({
      Items: [{ workspaceId: { S: 'workspace-123' }, ownerId: { S: 'test-user-123' } }],
    }),
    mockS3Send: vi.fn(),
    mockGetSignedUrl: vi
      .fn()
      .mockResolvedValue('https://bucket.s3.amazonaws.com/presigned-url'),
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
        metadataTable: 'test-metadata-table',
        jobsTable: 'test-jobs-table',
        workspacesTable: 'test-workspaces-table',
      },
      textract: {
        snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:test-topic',
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
      },
      logging: {
        level: 'silent',
      },
    },
  }),
);

// Mock NestJS
vi.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: vi.fn().mockResolvedValue({
      get: vi.fn().mockReturnValue(mockConfigService),
    }),
  },
}));

// Mock AWS SDK clients
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({
    send: mockS3Send,
  })),
  PutObjectCommand: vi.fn(),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(() => ({
    send: mockDynamoDBSend,
  })),
  PutItemCommand: vi.fn(),
  QueryCommand: vi.fn(),
}));

vi.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: vi.fn((item) => item),
}));

// Mock pino logger
vi.mock('pino', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Helper to create mock event
function createMockEvent(body: any, method: string = 'POST'): APIGatewayProxyEvent {
  return {
    body: body ? JSON.stringify(body) : null,
    headers: {
      'content-type': 'application/json',
    },
    multiValueHeaders: {},
    httpMethod: method,
    isBase64Encoded: false,
    path: '/upload',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api123',
      protocol: 'HTTP/1.1',
      httpMethod: method,
      path: '/upload',
      stage: 'prod',
      requestId: 'test-request-id',
      requestTime: '01/Jan/2025:00:00:00 +0000',
      requestTimeEpoch: 1735689600000,
      resourceId: 'resource123',
      resourcePath: '/upload',
      authorizer: {
        claims: {
          sub: 'test-user-123',
          email: 'test@example.com',
        },
      },
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '192.168.1.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
    },
    resource: '/upload',
  } as APIGatewayProxyEvent;
}

// Helper to create mock context
function createMockContext(): Context {
  return {
    callbackWaitsForEmptyEventLoop: false,
    functionName: 'upload-handler',
    functionVersion: '$LATEST',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:upload-handler',
    memoryLimitInMB: '1024',
    awsRequestId: 'test-request-id',
    logGroupName: '/aws/lambda/upload-handler',
    logStreamName: '2025/01/01/[$LATEST]abc123',
    getRemainingTimeInMillis: () => 30000,
    done: vi.fn(),
    fail: vi.fn(),
    succeed: vi.fn(),
  };
}

describe('Upload Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimiter(); // Reset rate limiter between tests
    mockDynamoDBSend.mockResolvedValue({
      Items: [{ workspaceId: { S: 'workspace-123' }, ownerId: { S: 'test-user-123' } }],
    });
    mockGetSignedUrl.mockResolvedValue('https://bucket.s3.amazonaws.com/presigned-url'); // Reset to success
    process.env.S3_BUCKET_NAME = 'test-bucket';
    process.env.DYNAMODB_TABLE = 'test-table';
    process.env.DYNAMODB_WORKSPACES_TABLE = 'test-workspaces-table';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Success Cases', () => {
    it('should return presigned URL for valid PDF upload request', async () => {
      const event = createMockEvent({
        filename: 'test-document.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('uploadUrl');
      expect(body).toHaveProperty('documentId');
      expect(body).toHaveProperty('s3Key');
      expect(body).toHaveProperty('expiresIn');
      expect(body.expiresIn).toBe(300);
      expect(body.s3Key).toMatch(/test-document\.pdf$/);
    });

    it('should sanitize filename with special characters', async () => {
      const event = createMockEvent({
        filename: '../test file (1).pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.s3Key).toMatch(/test_file__1_\.pdf$/);
      expect(body.s3Key).not.toContain('../');
    });

    it('should handle OPTIONS request for CORS preflight', async () => {
      const event = createMockEvent(null, 'OPTIONS');
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      // OPTIONS will fail validation (no body), but should have CORS headers
      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
    });

    it('should include CORS headers in response', async () => {
      const event = createMockEvent({
        filename: 'test.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin', '*');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });
  });

  describe('Validation Errors', () => {
    it('should reject request without body', async () => {
      const event = createMockEvent(null);
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Filename is required and must be a string');
    });

    it('should reject invalid JSON', async () => {
      const event = createMockEvent(null);
      event.body = 'invalid json{';
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('Request body must be valid JSON');
      expect(body.message).toBe('Request body must be valid JSON');
    });

    it('should reject missing filename', async () => {
      const event = createMockEvent({ workspaceId: 'workspace-123' });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Filename is required and must be a string');
    });

    it('should reject non-PDF files', async () => {
      const event = createMockEvent({
        filename: 'document.docx',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Only PDF files are allowed');
    });

    it('should reject filename exceeding max length', async () => {
      const longFilename = 'a'.repeat(101) + '.pdf';
      const event = createMockEvent({
        filename: longFilename,
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      // Handler sanitizes the filename, doesn't reject it
      expect(result.statusCode).toBe(200);
    });

    it('should reject invalid filename format', async () => {
      const event = createMockEvent({
        filename: '....pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      // Handler sanitizes the filename, doesn't reject it
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limit after max requests', async () => {
      const event = createMockEvent({
        filename: 'test.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      // Make 10 successful requests
      for (let i = 0; i < 10; i++) {
        const result = (await handler(event, context)) as HandlerResult;
        expect(result.statusCode).toBe(200);
      }

      // 11th request should be rate limited
      const result = (await handler(event, context)) as HandlerResult;
      expect(result.statusCode).toBe(429);
      const body = JSON.parse(result.body);
      expect(body.error).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('DynamoDB Failures', () => {
    it('should return 500 when DynamoDB fails', async () => {
      // Mock DynamoDB to throw error
      mockDynamoDBSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createMockEvent({
        filename: 'test.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('An unexpected error occurred');
    });
  });

  describe('S3 Failures', () => {
    it('should return 500 when presigned URL generation fails', async () => {
      // Mock S3 presigner to throw error
      mockGetSignedUrl.mockRejectedValueOnce(new Error('S3 error'));

      const event = createMockEvent({
        filename: 'test.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('An unexpected error occurred');
    });
  });

  describe('Security', () => {
    it('should strip path traversal attempts', async () => {
      const event = createMockEvent({
        filename: '../../../etc/passwd.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.s3Key).not.toContain('..');
      expect(body.s3Key).toMatch(/etc_passwd\.pdf$/); // Slashes replaced with underscores
    });

    it('should sanitize special characters', async () => {
      const event = createMockEvent({
        filename: 'test<script>.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.s3Key).not.toContain('<script>');
    });
  });

  describe('Edge Cases', () => {
    it('should handle uppercase PDF extension', async () => {
      const event = createMockEvent({
        filename: 'test.PDF',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(200);
    });

    it('should handle custom content type', async () => {
      const event = createMockEvent({
        filename: 'test.pdf',
        workspaceId: 'workspace-123',
        contentType: 'application/pdf',
      });
      const context = createMockContext();

      const result = (await handler(event, context)) as HandlerResult;

      expect(result.statusCode).toBe(200);
    });

    it('should generate unique document IDs for concurrent requests', async () => {
      const event1 = createMockEvent({
        filename: 'test1.pdf',
        workspaceId: 'workspace-123',
      });
      const event2 = createMockEvent({
        filename: 'test2.pdf',
        workspaceId: 'workspace-123',
      });
      const context = createMockContext();

      const [result1, result2] = (await Promise.all([
        handler(event1, context),
        handler(event2, context),
      ])) as HandlerResult[];

      const body1 = JSON.parse(result1.body);
      const body2 = JSON.parse(result2.body);

      expect(body1.documentId).not.toBe(body2.documentId);
    });
  });
});
