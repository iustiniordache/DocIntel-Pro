/**
 * Create Workspace Handler
 * Creates a new workspace for the authenticated user
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';
import {
  config,
  extractUserId,
  getDynamoClient,
  createdResponse,
  unauthorized,
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

interface CreateWorkspaceRequest {
  name: string;
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

    const body: CreateWorkspaceRequest = event.body ? JSON.parse(event.body) : {};

    if (!body.name || body.name.trim().length === 0) {
      return badRequest('Workspace name is required');
    }

    const workspace: Workspace = {
      workspaceId: randomUUID(),
      ownerId: userId,
      name: body.name.trim(),
      description: body.description?.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      documentCount: 0,
    };

    await getDynamoClient().send(
      new PutItemCommand({
        TableName: config().dynamodb.workspacesTable,
        Item: marshall(workspace),
      }),
    );

    return createdResponse(workspace);
  } catch (error) {
    console.error('Error creating workspace:', error);
    return serverError('Failed to create workspace');
  }
};
