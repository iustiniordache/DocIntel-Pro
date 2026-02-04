/**
 * Shared Authentication Utilities for Lambda Handlers
 * Extracts user identity from API Gateway events
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  username?: string;
}

/**
 * Extract user ID from Cognito authorizer claims
 * Works with both REST API and HTTP API formats
 */
export const extractUserId = (event: APIGatewayProxyEvent): string | null => {
  // REST API with Cognito User Pool authorizer
  const restApiUserId = event.requestContext?.authorizer?.['claims']?.['sub'];
  if (restApiUserId) {
    return restApiUserId as string;
  }

  // HTTP API with JWT authorizer
  const httpApiUserId = event.requestContext?.authorizer?.['jwt']?.['claims']?.['sub'];
  if (httpApiUserId) {
    return httpApiUserId as string;
  }

  // Lambda authorizer with principalId
  const lambdaAuthUserId = event.requestContext?.authorizer?.['principalId'];
  if (lambdaAuthUserId) {
    return lambdaAuthUserId as string;
  }

  return null;
};

/**
 * Extract full user info from Cognito claims
 */
export const extractUser = (event: APIGatewayProxyEvent): AuthenticatedUser | null => {
  const userId = extractUserId(event);
  if (!userId) return null;

  const claims = event.requestContext?.authorizer?.['claims'] || {};

  return {
    userId,
    email: claims['email'] as string | undefined,
    username: claims['cognito:username'] as string | undefined,
  };
};
