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
  overrides: Partial<Record<string, any>> = {},
): Promise<TestingModule> {
  // Set test environment variables
  process.env['AWS_REGION'] = overrides['AWS_REGION'] || 'us-east-1';
  process.env['AWS_ACCOUNT_ID'] = overrides['AWS_ACCOUNT_ID'] || '123456789012';
  process.env['S3_DOCUMENTS_BUCKET'] = overrides['S3_DOCUMENTS_BUCKET'] || 'test-bucket';
  process.env['S3_PRESIGNED_URL_EXPIRY'] = overrides['S3_PRESIGNED_URL_EXPIRY'] || '300';
  process.env['DYNAMODB_METADATA_TABLE'] =
    overrides['DYNAMODB_METADATA_TABLE'] || 'test-metadata-table';
  process.env['DYNAMODB_JOBS_TABLE'] =
    overrides['DYNAMODB_JOBS_TABLE'] || 'test-jobs-table';
  process.env['TEXTRACT_SNS_TOPIC_ARN'] =
    overrides['TEXTRACT_SNS_TOPIC_ARN'] ||
    'arn:aws:sns:us-east-1:123456789012:test-topic';
  process.env['TEXTRACT_ROLE_ARN'] =
    overrides['TEXTRACT_ROLE_ARN'] || 'arn:aws:iam::123456789012:role/test-role';
  process.env['LOG_LEVEL'] = overrides['LOG_LEVEL'] || 'silent';

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
export function getMockConfigService(overrides: Partial<any> = {}) {
  return {
    aws: {
      region: overrides['aws']?.['region'] || 'us-east-1',
      accountId: overrides['aws']?.['accountId'] || '123456789012',
    },
    s3: {
      documentsBucket: overrides['s3']?.['documentsBucket'] || 'test-bucket',
      presignedUrlExpiry: overrides['s3']?.['presignedUrlExpiry'] || 300,
    },
    dynamodb: {
      metadataTable: overrides['dynamodb']?.['metadataTable'] || 'test-metadata-table',
      jobsTable: overrides['dynamodb']?.['jobsTable'] || 'test-jobs-table',
    },
    textract: {
      snsTopicArn:
        overrides['textract']?.['snsTopicArn'] ||
        'arn:aws:sns:us-east-1:123456789012:test-topic',
      roleArn:
        overrides['textract']?.['roleArn'] || 'arn:aws:iam::123456789012:role/test-role',
    },
    logging: {
      level: overrides['logging']?.['level'] || 'silent',
    },
  };
}
