/**
 * List Workspaces Handler
 * Returns all workspaces owned by the authenticated user
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
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
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'User not authenticated',
        }),
      };
    }

    // Query workspaces by ownerId
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: WORKSPACES_TABLE,
        KeyConditionExpression: 'ownerId = :ownerId',
        ExpressionAttributeValues: {
          ':ownerId': { S: userId },
        },
      }),
    );

    const workspaces: Workspace[] = (result.Items || []).map((item) =>
      unmarshall(item),
    ) as Workspace[];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: JSON.stringify({ success: true, data: workspaces }),
    };
  } catch (error) {
    console.error('Error listing workspaces:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to list workspaces',
      }),
    };
  }
};
