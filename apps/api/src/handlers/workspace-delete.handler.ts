/**
 * Delete Workspace Handler
 * Deletes a workspace (only if it has no documents)
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  QueryCommand,
  DeleteItemCommand,
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
const METADATA_TABLE = process.env['DYNAMODB_METADATA_TABLE'] || '';

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

    const workspaceItem = queryResult.Items[0];
    if (!workspaceItem) {
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

    const workspace = unmarshall(workspaceItem) as Workspace;

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

    // Check if workspace has documents
    const documentsCheck = await dynamoClient.send(
      new QueryCommand({
        TableName: METADATA_TABLE,
        KeyConditionExpression: 'workspaceId = :workspaceId',
        ExpressionAttributeValues: {
          ':workspaceId': { S: workspaceId },
        },
        Limit: 1,
      }),
    );

    if (documentsCheck.Items && documentsCheck.Items.length > 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Cannot delete workspace with existing documents',
        }),
      };
    }

    // Delete workspace
    await dynamoClient.send(
      new DeleteItemCommand({
        TableName: WORKSPACES_TABLE,
        Key: {
          ownerId: { S: workspace.ownerId },
          workspaceId: { S: workspaceId },
        },
      }),
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        success: true,
        message: 'Workspace deleted successfully',
      }),
    };
  } catch (error) {
    console.error('Error deleting workspace:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to delete workspace',
      }),
    };
  }
};
