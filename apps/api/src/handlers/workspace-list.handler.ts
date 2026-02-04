/**
 * List Workspaces Handler
 * Returns all workspaces owned by the authenticated user
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

    const result = await getDynamoClient().send(
      new QueryCommand({
        TableName: config().dynamodb.workspacesTable,
        KeyConditionExpression: 'ownerId = :ownerId',
        ExpressionAttributeValues: {
          ':ownerId': { S: userId },
        },
      }),
    );

    const workspaces: Workspace[] = (result.Items || []).map((item) =>
      unmarshall(item),
    ) as Workspace[];

    return successResponse(workspaces);
  } catch (error) {
    console.error('Error listing workspaces:', error);
    return serverError('Failed to list workspaces');
  }
};
