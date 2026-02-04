/**
 * Update Workspace Handler
 * Updates workspace name and/or description
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  QueryCommand,
  UpdateItemCommand,
  AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  config,
  extractUserId,
  getDynamoClient,
  wrappedSuccessResponse,
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

interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
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

    const body: UpdateWorkspaceRequest = event.body ? JSON.parse(event.body) : {};

    if (!body.name && !body.description) {
      return badRequest('At least one field (name or description) is required');
    }

    // Query workspace to verify ownership
    const queryResult = await getDynamoClient().send(
      new QueryCommand({
        TableName: config().dynamodb.workspacesTable,
        IndexName: 'WorkspaceIdIndex',
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
      }),
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return notFound('Workspace not found');
    }

    const workspaceItem = queryResult.Items[0];
    if (!workspaceItem) {
      return notFound('Workspace not found');
    }

    const workspace = unmarshall(workspaceItem) as Workspace;

    if (workspace.ownerId !== userId) {
      return forbidden();
    }

    // Build update expression
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, AttributeValue> = {};

    if (body.name) {
      updateExpressions.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = { S: body.name.trim() };
    }

    if (body.description !== undefined) {
      updateExpressions.push('#description = :description');
      expressionAttributeNames['#description'] = 'description';
      expressionAttributeValues[':description'] = { S: body.description.trim() };
    }

    updateExpressions.push('#updatedAt = :updatedAt');
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = { S: new Date().toISOString() };

    await getDynamoClient().send(
      new UpdateItemCommand({
        TableName: config().dynamodb.workspacesTable,
        Key: {
          ownerId: { S: workspace.ownerId },
          workspaceId: { S: workspaceId },
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    );

    const updatedWorkspace: Workspace = {
      ...workspace,
      ...(body.name && { name: body.name.trim() }),
      ...(body.description !== undefined && { description: body.description.trim() }),
      updatedAt: new Date().toISOString(),
    };

    return wrappedSuccessResponse(updatedWorkspace);
  } catch (error) {
    console.error('Error updating workspace:', error);
    return serverError('Failed to update workspace');
  }
};
