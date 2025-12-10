/**
 * Documents Handler - List documents with their processing status
 *
 * GET /documents - Returns all documents with their current status from DynamoDB
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import pino from 'pino';

interface Document {
  documentId: string;
  filename: string;
  status: string;
  uploadDate: string;
  pageCount?: number;
  fileSize?: number;
  processedAt?: string;
}

interface ErrorResponse {
  error: string;
  message: string;
}

// Configuration from environment variables
const CONFIG = {
  aws: {
    region: process.env['AWS_REGION'] || 'us-east-1',
  },
  dynamodb: {
    metadataTable: process.env['DYNAMODB_METADATA_TABLE'] || '',
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
};

// Lazy initialization of AWS clients
let dynamoClient: DynamoDBClient;
let logger: pino.Logger;

function initializeServices() {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({
      region: CONFIG.aws.region,
    });

    logger = pino({
      level: CONFIG.logging.level,
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    });

    logger.info('Services initialized');
  }
}

/**
 * Map DynamoDB status to frontend-friendly status
 */
function mapStatus(dbStatus: string): string {
  const statusMap: Record<string, string> = {
    UPLOAD_PENDING: 'uploading',
    UPLOADED: 'processing',
    PROCESSING: 'processing',
    PROCESSED: 'completed',
    COMPLETED: 'completed',
    FAILED: 'failed',
  };

  return statusMap[dbStatus] || 'processing';
}

/**
 * Fetch all documents from DynamoDB
 */
async function fetchDocuments(): Promise<Document[]> {
  const command = new ScanCommand({
    TableName: CONFIG.dynamodb.metadataTable,
  });

  const response = await dynamoClient.send(command);

  if (!response.Items) {
    return [];
  }

  // Convert DynamoDB items to Document objects
  const documents = response.Items.map((item) => {
    const unmarshalled = unmarshall(item) as Record<string, unknown>;

    return {
      documentId: unmarshalled['documentId'] as string,
      filename: unmarshalled['filename'] as string,
      status: mapStatus(unmarshalled['status'] as string),
      uploadDate: unmarshalled['uploadDate'] as string,
      pageCount: unmarshalled['pageCount'] as number | undefined,
      fileSize: unmarshalled['fileSize'] as number | undefined,
      processedAt: unmarshalled['processedAt'] as string | undefined,
    };
  });

  // Sort by upload date descending (newest first)
  documents.sort((a, b) => {
    return new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
  });

  return documents;
}

/**
 * Create success response
 */
function successResponse(
  documents: Document[],
  requestId: string,
): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(documents),
  };
}

/**
 * Create error response
 */
function errorResponse(
  statusCode: number,
  error: ErrorResponse,
  requestId: string,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(error),
  };
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  initializeServices();

  const requestId = context.awsRequestId;

  logger.info(
    {
      requestId,
      method: event.httpMethod || 'UNKNOWN',
      path: event.path || 'UNKNOWN',
    },
    'Processing documents list request',
  );

  try {
    // Only support GET method
    const method = event.httpMethod;
    if (method !== 'GET') {
      return errorResponse(
        405,
        {
          error: 'METHOD_NOT_ALLOWED',
          message: 'Only GET method is supported',
        },
        requestId,
      );
    }

    // Fetch documents from DynamoDB
    const documents = await fetchDocuments();

    logger.info(
      {
        requestId,
        count: documents.length,
      },
      'Documents fetched successfully',
    );

    return successResponse(documents, requestId);
  } catch (error) {
    logger.error(
      {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      'Error fetching documents',
    );

    return errorResponse(
      500,
      {
        error: 'INTERNAL_ERROR',
        message: 'Failed to fetch documents',
      },
      requestId,
    );
  }
}
