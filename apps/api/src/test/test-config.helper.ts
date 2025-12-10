/**
 * Test configuration for handlers using NestJS config
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AppConfigService } from '../config/app-config.service';
import appConfig from '../config/app.config';

/**
 * Create a test module with mocked config values
 */
export async function createTestConfigModule(
  overrides: Partial<Record<string, unknown>> = {},
): Promise<TestingModule> {
  // Set test environment variables
  process.env['AWS_REGION'] =
    (overrides['AWS_REGION'] as string | undefined) || 'us-east-1';
  process.env['AWS_ACCOUNT_ID'] =
    (overrides['AWS_ACCOUNT_ID'] as string | undefined) || '123456789012';
  process.env['S3_DOCUMENTS_BUCKET'] =
    (overrides['S3_DOCUMENTS_BUCKET'] as string | undefined) || 'test-bucket';
  process.env['S3_PRESIGNED_URL_EXPIRY'] =
    (overrides['S3_PRESIGNED_URL_EXPIRY'] as string | undefined) || '300';
  process.env['DYNAMODB_METADATA_TABLE'] =
    (overrides['DYNAMODB_METADATA_TABLE'] as string | undefined) || 'test-metadata-table';
  process.env['DYNAMODB_JOBS_TABLE'] =
    (overrides['DYNAMODB_JOBS_TABLE'] as string | undefined) || 'test-jobs-table';
  process.env['TEXTRACT_SNS_TOPIC_ARN'] =
    (overrides['TEXTRACT_SNS_TOPIC_ARN'] as string | undefined) ||
    'arn:aws:sns:us-east-1:123456789012:test-topic';
  process.env['TEXTRACT_ROLE_ARN'] =
    (overrides['TEXTRACT_ROLE_ARN'] as string | undefined) ||
    'arn:aws:iam::123456789012:role/test-role';
  process.env['LOG_LEVEL'] = (overrides['LOG_LEVEL'] as string | undefined) || 'silent';

  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        load: [appConfig],
        isGlobal: true,
      }),
    ],
    providers: [AppConfigService],
  }).compile();

  return module;
}

/**
 * Get mocked config service for testing
 */
export function getMockConfigService(overrides: Partial<Record<string, unknown>> = {}) {
  const aws = overrides['aws'] as Record<string, unknown> | undefined;
  const s3 = overrides['s3'] as Record<string, unknown> | undefined;
  const dynamodb = overrides['dynamodb'] as Record<string, unknown> | undefined;
  const textract = overrides['textract'] as Record<string, unknown> | undefined;
  const logging = overrides['logging'] as Record<string, unknown> | undefined;

  return {
    aws: {
      region: (aws?.['region'] as string | undefined) || 'us-east-1',
      accountId: (aws?.['accountId'] as string | undefined) || '123456789012',
    },
    s3: {
      documentsBucket: (s3?.['documentsBucket'] as string | undefined) || 'test-bucket',
      presignedUrlExpiry: (s3?.['presignedUrlExpiry'] as number | undefined) || 300,
    },
    dynamodb: {
      metadataTable:
        (dynamodb?.['metadataTable'] as string | undefined) || 'test-metadata-table',
      jobsTable: (dynamodb?.['jobsTable'] as string | undefined) || 'test-jobs-table',
    },
    textract: {
      snsTopicArn:
        (textract?.['snsTopicArn'] as string | undefined) ||
        'arn:aws:sns:us-east-1:123456789012:test-topic',
      roleArn:
        (textract?.['roleArn'] as string | undefined) ||
        'arn:aws:iam::123456789012:role/test-role',
    },
    logging: {
      level: (logging?.['level'] as string | undefined) || 'silent',
    },
  };
}
