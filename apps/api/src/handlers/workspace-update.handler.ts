/**
 * Update Workspace Handler
 * Updates workspace name and/or description
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

interface Workspace {
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}

const dynamoClient = new DynamoDBClient({
  region: process.env['AWS_REGION'] || 'us-east-1',
});
const WORKSPACES_TABLE = process.env['DYNAMODB_WORKSPACES_TABLE'] || '';

interface UpdateWorkspaceRequest {
  name?: string;
  description?: string;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  try {
    // Extract user ID from Cognito authorizer (REST API format)
    const userId = event.requestContext?.authorizer?.['claims']?.['sub'] as string;
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'User not authenticated',
        }),
      };
    }

    // Get workspace ID from path parameters
    const workspaceId = event.pathParameters?.['workspaceId'];
    if (!workspaceId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Workspace ID is required',
        }),
      };
    }

    // Parse request body
    const body: UpdateWorkspaceRequest = event.body ? JSON.parse(event.body) : {};

    if (!body.name && !body.description) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'At least one field (name or description) is required',
        }),
      };
    }

    // Query workspace to verify ownership
    const queryResult = await dynamoClient.send(
      new QueryCommand({
        TableName: WORKSPACES_TABLE,
        IndexName: 'WorkspaceIdIndex',
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
      }),
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({ error: 'Not Found', message: 'Workspace not found' }),
      };
    }

    const workspace = unmarshall(queryResult.Items[0]) as Workspace;

    // Verify ownership
    if (workspace.ownerId !== userId) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({ error: 'Forbidden', message: 'Access denied' }),
      };
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

    // Update workspace
    await dynamoClient.send(
      new UpdateItemCommand({
        TableName: WORKSPACES_TABLE,
        Key: {
          ownerId: { S: workspace.ownerId },
          workspaceId: { S: workspaceId },
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      }),
    );

    // Return updated workspace
    const updatedWorkspace: Workspace = {
      ...workspace,
      ...(body.name && { name: body.name.trim() }),
      ...(body.description !== undefined && { description: body.description.trim() }),
      updatedAt: new Date().toISOString(),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({ success: true, data: updatedWorkspace }),
    };
  } catch (error) {
    console.error('Error updating workspace:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to update workspace',
      }),
    };
  }
};
