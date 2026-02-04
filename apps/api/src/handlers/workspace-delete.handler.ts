/**
 * Delete Workspace Handler
 * Deletes a workspace (only if it has no documents)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  config,
  extractUserId,
  getDynamoClient,
  successResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  serverError,
} from './shared';

interface Workspace {
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const cfg = config();
  const dynamoClient = getDynamoClient();

  try {
    const userId = extractUserId(event);
    if (!userId) {
      return unauthorized('User not authenticated');
    }

    const workspaceId = event.pathParameters?.['workspaceId'];
    if (!workspaceId) {
      return badRequest('Workspace ID is required');
    }

    // Query workspace to verify ownership
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: cfg.dynamodb.workspacesTable,
        IndexName: 'WorkspaceIdIndex',
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
      }),
    );

    const workspaceItem = queryResult.Items?.[0];
    if (!workspaceItem) {
      return notFound('Workspace not found');
    }

    const workspace = unmarshall(workspaceItem) as Workspace;

    if (workspace.ownerId !== userId) {
      return forbidden('Access denied');
    }

    // Check if workspace has documents
    const documentsCheck = await dynamoClient.send(
      new QueryCommand({
        TableName: cfg.dynamodb.metadataTable,
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
        Limit: 1,
      }),
    );

    if (documentsCheck.Items && documentsCheck.Items.length > 0) {
      return badRequest('Cannot delete workspace with existing documents');
    }

    // Delete workspace
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: cfg.dynamodb.workspacesTable,
        Key: {
          ownerId: { S: workspace.ownerId },
          workspaceId: { S: workspaceId },
        },
      }),
    );

    return successResponse({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    return serverError('Failed to delete workspace');
  }
};
