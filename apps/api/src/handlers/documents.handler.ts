/**
 * Documents Handler - List documents with their processing status
 *
 * GET /documents - Returns all documents with their current status from DynamoDB
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  config,
  extractUserId,
  getDynamoClient,
  getLogger,
  successResponse,
  unauthorized,
  errorResponse,
} from './shared';

interface Document {
  documentId: string;
  filename: string;
  status: string;
  uploadDate: string;
  pageCount?: number;
  fileSize?: number;
  processedAt?: string;
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
  const cfg = config();
  const dynamoClient = getDynamoClient();

  // If no workspaceId provided, return empty array
  if (!workspaceId) {
    return [];
  }

  // Verify workspace ownership
  const workspaceCheck = await dynamoClient.send(
    new QueryCommand({
      TableName: cfg.dynamodb.workspacesTable,
      IndexName: 'WorkspaceIdIndex',
      KeyConditionExpression: 'workspaceId = :workspaceId',
      ExpressionAttributeValues: marshall({
        ':workspaceId': workspaceId,
      }),
    }),
  );

  const workspaceItem = workspaceCheck.Items?.[0];
  if (!workspaceItem) {
    return [];
  }

  const workspace = unmarshall(workspaceItem);
  if (workspace['ownerId'] !== userId) {
    // User doesn't own this workspace
    return [];
  }

  // Fetch documents for the workspace
  const documentsResponse = await dynamoClient.send(
    new QueryCommand({
      TableName: cfg.dynamodb.metadataTable,
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
 * Main Lambda handler
 */
export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  const logger = getLogger();
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
    const userId = extractUserId(event);
    if (!userId) {
      return unauthorized('User not authenticated');
    }

    // Only support GET method
    if (event.httpMethod !== 'GET') {
      return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET method is supported');
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

    return successResponse(documents);
  } catch (error) {
    logger.error(
      {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      'Error fetching documents',
    );

    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to fetch documents');
  }
}
