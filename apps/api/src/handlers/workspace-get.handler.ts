/**
 * Get Workspace Handler
 * Retrieves a single workspace by ID (with ownership verification)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  config,
  extractUserId,
  getDynamoClient,
  successResponse,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
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
  try {
    const userId = extractUserId(event);
    if (!userId) {
      return unauthorized();
    }

    const workspaceId = event.pathParameters?.['workspaceId'];
    if (!workspaceId) {
      return badRequest('Workspace ID is required');
    }

    const result = await getDynamoClient().send(
      new QueryCommand({
        TableName: config().dynamodb.workspacesTable,
        IndexName: 'WorkspaceIdIndex',
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
      }),
    );

    if (!result.Items || result.Items.length === 0) {
      return notFound('Workspace not found');
    }

    const workspaceItem = result.Items[0];
    if (!workspaceItem) {
      return notFound('Workspace not found');
    }

    const workspace = unmarshall(workspaceItem) as Workspace;

    if (workspace.ownerId !== userId) {
      return forbidden();
    }

    return successResponse(workspace);
  } catch (error) {
    console.error('Error getting workspace:', error);
    return serverError('Failed to get workspace');
  }
};
