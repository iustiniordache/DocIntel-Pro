/**
 * Tests for Textract Complete Handler
 */

import { SNSEvent, Context } from 'aws-lambda';
import { handler } from './textract-complete.handler';
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
import { marshall } from '@aws-sdk/util-dynamodb';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-textract');
jest.mock('@aws-sdk/client-dynamodb');

describe('textract-complete.handler', () => {
  let mockTextractSend: jest.Mock;
  let mockDynamoSend: jest.Mock;
  let mockContext: Context;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock TextractClient
    mockTextractSend = jest.fn();
    (TextractClient as jest.Mock).mockImplementation(() => ({
      send: mockTextractSend,
    }));

    // Mock DynamoDBClient
    mockDynamoSend = jest.fn();
    (DynamoDBClient as jest.Mock).mockImplementation(() => ({
      send: mockDynamoSend,
    }));

    // Mock Lambda context
    mockContext = {
      awsRequestId: 'test-request-id',
      functionName: 'test-function',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test',
      memoryLimitInMB: '512',
      logGroupName: '/aws/lambda/test',
      logStreamName: '2024/01/01/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      callbackWaitsForEmptyEventLoop: true,
      done: jest.fn(),
      fail: jest.fn(),
      succeed: jest.fn(),
    };

    // Set environment variables
    process.env['AWS_REGION'] = 'us-east-1';
    process.env['DYNAMODB_METADATA_TABLE'] = 'test-metadata-table';
    process.env['DYNAMODB_JOBS_TABLE'] = 'test-jobs-table';
    process.env['TEXTRACT_CONFIDENCE_THRESHOLD'] = '80';
    process.env['TEXTRACT_COST_PER_PAGE'] = '0.0015';
    process.env['LOG_LEVEL'] = 'error'; // Suppress logs in tests
  });

  afterEach(() => {
    delete process.env['AWS_REGION'];
    delete process.env['DYNAMODB_METADATA_TABLE'];
    delete process.env['DYNAMODB_JOBS_TABLE'];
    delete process.env['TEXTRACT_CONFIDENCE_THRESHOLD'];
    delete process.env['TEXTRACT_COST_PER_PAGE'];
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
      };

      // Mock DynamoDB QueryCommand (lookup job)
      mockDynamoSend.mockImplementationOnce((command) => {
        if (command instanceof QueryCommand) {
          return Promise.resolve({
            Items: [
              marshall({
                jobId,
                documentId,
                bucket: 'test-bucket',
                s3Key: 'test-key.pdf',
                status: 'TEXTRACT_IN_PROGRESS',
                createdAt: new Date().toISOString(),
                textractJobId,
              }),
            ],
          });
        }
      });

      // Mock Textract GetDocumentTextDetectionCommand (single page)
      mockTextractSend.mockImplementationOnce((command) => {
        if (command instanceof GetDocumentTextDetectionCommand) {
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

          return Promise.resolve({
            Blocks: blocks,
            DocumentMetadata: {
              Pages: 1,
            },
            JobStatus: 'SUCCEEDED',
            NextToken: undefined,
          });
        }
      });

      // Mock UpdateItemCommand (update job status)
      mockDynamoSend.mockImplementationOnce((command) => {
        if (command instanceof UpdateItemCommand) {
          return Promise.resolve({});
        }
      });

      // Mock UpdateItemCommand (update document metadata)
      mockDynamoSend.mockImplementationOnce((command) => {
        if (command instanceof UpdateItemCommand) {
          return Promise.resolve({});
        }
      });

      // Execute handler
      await handler(event, mockContext);

      // Verify DynamoDB calls
      expect(mockDynamoSend).toHaveBeenCalledTimes(3); // Query + 2 Updates

      // Verify Textract call
      expect(mockTextractSend).toHaveBeenCalledTimes(1);
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
      };

      // Mock job lookup
      mockDynamoSend.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            marshall({
              jobId,
              documentId,
              bucket: 'test-bucket',
              s3Key: 'test-key.pdf',
              status: 'TEXTRACT_IN_PROGRESS',
              createdAt: new Date().toISOString(),
              textractJobId,
            }),
          ],
        }),
      );

      // Mock paginated Textract results
      mockTextractSend
        .mockImplementationOnce(() =>
          Promise.resolve({
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
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({
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
          }),
        );

      // Mock updates
      mockDynamoSend.mockImplementation(() => Promise.resolve({}));

      await handler(event, mockContext);

      // Verify Textract was called twice (pagination)
      expect(mockTextractSend).toHaveBeenCalledTimes(2);
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
      };

      // Mock job lookup
      mockDynamoSend.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            marshall({
              jobId,
              documentId,
              bucket: 'test-bucket',
              s3Key: 'test-key.pdf',
              status: 'TEXTRACT_IN_PROGRESS',
              createdAt: new Date().toISOString(),
              textractJobId,
            }),
          ],
        }),
      );

      // Mock updates (should be called to mark as failed)
      mockDynamoSend.mockImplementation(() => Promise.resolve({}));

      await handler(event, mockContext);

      // Should NOT call Textract (job failed)
      expect(mockTextractSend).not.toHaveBeenCalled();

      // Should update job and document status to FAILED
      expect(mockDynamoSend).toHaveBeenCalledTimes(3); // Query + 2 Updates
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
      };

      // Mock job lookup - not found
      mockDynamoSend.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [],
        }),
      );

      await handler(event, mockContext);

      // Should only call DynamoDB for lookup, then exit gracefully
      expect(mockDynamoSend).toHaveBeenCalledTimes(1);
      expect(mockTextractSend).not.toHaveBeenCalled();
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
      expect(mockDynamoSend).not.toHaveBeenCalled();
      expect(mockTextractSend).not.toHaveBeenCalled();
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
      };

      // Mock job lookup
      mockDynamoSend.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            marshall({
              jobId,
              documentId,
              bucket: 'test-bucket',
              s3Key: 'test-key.pdf',
              status: 'TEXTRACT_IN_PROGRESS',
              createdAt: new Date().toISOString(),
              textractJobId,
            }),
          ],
        }),
      );

      // Mock Textract error
      mockTextractSend.mockRejectedValueOnce(new Error('Textract API error'));

      // Mock updates
      mockDynamoSend.mockImplementation(() => Promise.resolve({}));

      // Should throw error
      await expect(handler(event, mockContext)).rejects.toThrow();

      // Should still try to update status to FAILED_TEXTRACT_PROCESSING
      expect(mockDynamoSend).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({
            TableName: 'test-jobs-table',
          }),
        }),
      );
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
      };

      // Mock job lookup
      mockDynamoSend.mockImplementationOnce(() =>
        Promise.resolve({
          Items: [
            marshall({
              jobId,
              documentId,
              bucket: 'test-bucket',
              s3Key: 'test-key.pdf',
              status: 'TEXTRACT_IN_PROGRESS',
              createdAt: new Date().toISOString(),
              textractJobId,
            }),
          ],
        }),
      );

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

      mockTextractSend.mockImplementationOnce(() =>
        Promise.resolve({
          Blocks: blocks,
          DocumentMetadata: { Pages: 1 },
          JobStatus: 'SUCCEEDED',
        }),
      );

      // Mock updates
      mockDynamoSend.mockImplementation(() => Promise.resolve({}));

      await handler(event, mockContext);

      // Verify successful execution
      expect(mockTextractSend).toHaveBeenCalled();
      expect(mockDynamoSend).toHaveBeenCalledTimes(3);
    });
  });
});
