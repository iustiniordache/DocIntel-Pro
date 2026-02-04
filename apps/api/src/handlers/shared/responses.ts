/**
 * Shared Response Utilities for Lambda Handlers
 * Provides consistent HTTP response formatting with CORS headers
 */

import { APIGatewayProxyResult } from 'aws-lambda';

/** Standard CORS headers for all responses */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

/** Base headers for JSON responses */
const JSON_HEADERS = {
  'Content-Type': 'application/json',
  ...CORS_HEADERS,
};

/**
 * Create a success response with data
 * Returns data directly at top level for backward compatibility
 */
export const successResponse = <T>(data: T, statusCode = 200): APIGatewayProxyResult => ({
  statusCode,
  headers: JSON_HEADERS,
  body: JSON.stringify(data),
});

/**
 * Create a created response (201)
 */
export const createdResponse = <T>(data: T): APIGatewayProxyResult =>
  successResponse(data, 201);

/**
 * Create an error response
 */
export const errorResponse = (
  statusCode: number,
  error: string,
  message: string,
  details?: Record<string, unknown>,
): APIGatewayProxyResult => ({
  statusCode,
  headers: JSON_HEADERS,
  body: JSON.stringify({
    error,
    message,
    ...(details && { details }),
  }),
});

/**
 * Common error response shortcuts
 */
export const unauthorized = (message = 'User not authenticated'): APIGatewayProxyResult =>
  errorResponse(401, 'Unauthorized', message);

export const forbidden = (message = 'Access denied'): APIGatewayProxyResult =>
  errorResponse(403, 'Forbidden', message);

export const notFound = (message = 'Resource not found'): APIGatewayProxyResult =>
  errorResponse(404, 'Not Found', message);

export const badRequest = (message: string): APIGatewayProxyResult =>
  errorResponse(400, message, message);

export const serverError = (message = 'Internal server error'): APIGatewayProxyResult =>
  errorResponse(500, 'INTERNAL_ERROR', message);

export const serviceUnavailable = (
  message = 'AI service is temporarily unavailable',
): APIGatewayProxyResult => errorResponse(503, 'SERVICE_UNAVAILABLE', message);
