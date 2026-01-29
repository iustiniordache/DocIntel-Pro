/**
 * Documents Handler - List documents with their processing status
 *
 * GET /documents - Returns all documents with their current status from DynamoDB
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
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
    workspacesTable: process.env['DYNAMODB_WORKSPACES_TABLE'] || '',
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
    TEXTRACT_PENDING: 'processing',
    TEXTRACT_IN_PROGRESS: 'processing',
    TEXTRACT_COMPLETED: 'completed',
    TEXTRACT_FAILED: 'failed',
  };

  return statusMap[dbStatus] || 'processing';
}

/**
 * Fetch documents from DynamoDB for a specific workspace
 */
async function fetchDocuments(userId: string, workspaceId?: string): Promise<Document[]> {
  // If no workspaceId provided, return empty array
  if (!workspaceId) {
    return [];
  }

  // Verify workspace ownership
  const workspaceCheck = await dynamoClient.send(
    new QueryCommand({
      TableName: CONFIG.dynamodb.workspacesTable,
      IndexName: 'WorkspaceIdIndex',
      KeyConditionExpression: 'workspaceId = :workspaceId',
      ExpressionAttributeValues: marshall({
        ':workspaceId': workspaceId,
      }),
    }),
  );

  if (!workspaceCheck.Items || workspaceCheck.Items.length === 0) {
    return [];
  }

  const workspace = unmarshall(workspaceCheck.Items[0]);
  if (workspace['ownerId'] !== userId) {
    // User doesn't own this workspace
    return [];
  }

  // Fetch documents for the workspace
  const documentsResponse = await dynamoClient.send(
    new QueryCommand({
      TableName: CONFIG.dynamodb.metadataTable,
      KeyConditionExpression: 'workspaceId = :workspaceId',
      ExpressionAttributeValues: marshall({
        ':workspaceId': workspaceId,
      }),
    }),
  );

  if (!documentsResponse.Items) {
    return [];
  }

  const documents = documentsResponse.Items.map((item) => {
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
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
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
    // Extract user ID from Cognito authorizer
    const userId = event.requestContext?.authorizer?.['claims']?.['sub'] as string;
    if (!userId) {
      return errorResponse(
        401,
        {
          error: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
        requestId,
      );
    }

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

    // Get workspaceId from query parameters
    const workspaceId = event.queryStringParameters?.['workspaceId'];

    // Fetch documents from DynamoDB for the selected workspace
    const documents = await fetchDocuments(userId, workspaceId);

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
