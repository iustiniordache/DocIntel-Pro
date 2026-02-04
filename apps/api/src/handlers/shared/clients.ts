/**
 * Shared AWS Client Factories for Lambda Handlers
 * Provides lazy-initialized, reusable AWS SDK clients
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { TextractClient } from '@aws-sdk/client-textract';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { config } from './config';

// Singleton instances (reused across Lambda invocations)
let dynamoClient: DynamoDBClient | null = null;
let s3Client: S3Client | null = null;
let textractClient: TextractClient | null = null;
let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Get DynamoDB client (lazy initialization)
 */
export const getDynamoClient = (): DynamoDBClient => {
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({
      region: config().aws.region,
    });
  }
  return dynamoClient;
};

/**
 * Get S3 client (lazy initialization)
 */
export const getS3Client = (): S3Client => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config().aws.region,
    });
  }
  return s3Client;
};

/**
 * Get Textract client (lazy initialization)
 */
export const getTextractClient = (): TextractClient => {
  if (!textractClient) {
    textractClient = new TextractClient({
      region: config().aws.region,
    });
  }
  return textractClient;
};

/**
 * Get Bedrock Runtime client (lazy initialization)
 */
export const getBedrockClient = (): BedrockRuntimeClient => {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: config().aws.region,
    });
  }
  return bedrockClient;
};

/**
 * Reset all client singletons (for testing purposes)
 */
export const resetClients = (): void => {
  dynamoClient = null;
  s3Client = null;
  textractClient = null;
  bedrockClient = null;
};
