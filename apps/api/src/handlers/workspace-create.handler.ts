/**
 * Create Workspace Handler
 * Creates a new workspace for the authenticated user
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';

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

interface CreateWorkspaceRequest {
  name: string;
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
        },
        body: JSON.stringify({
          error: 'Unauthorized',
          message: 'User not authenticated',
        }),
      };
    }

    // Parse request body
    const body: CreateWorkspaceRequest = event.body ? JSON.parse(event.body) : {};

    if (!body.name || body.name.trim().length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Workspace name is required',
        }),
      };
    }

    // Create workspace
    const workspace: Workspace = {
      workspaceId: randomUUID(),
      ownerId: userId,
      name: body.name.trim(),
      description: body.description?.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0,
    };

    // Save to DynamoDB
    await dynamoClient.send(
      new PutItemCommand({
        TableName: WORKSPACES_TABLE,
        Item: marshall(workspace),
      }),
    );

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      },
      body: JSON.stringify({ success: true, data: workspace }),
    };
  } catch (error) {
    console.error('Error creating workspace:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to create workspace',
      }),
    };
  }
};
