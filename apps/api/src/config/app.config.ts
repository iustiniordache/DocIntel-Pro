import { registerAs } from '@nestjs/config';

export interface AppConfig {
  aws: {
    region: string;
    accountId: string;
  };
  s3: {
    documentsBucket: string;
    presignedUrlExpiry: number;
  };
  dynamodb: {
    metadataTable: string;
    jobsTable: string;
  };
  textract: {
    snsTopicArn: string;
    roleArn: string;
  };
  logging: {
    level: string;
  };
}

export default registerAs(
  'app',
  (): AppConfig => ({
    aws: {
      region: process.env['AWS_REGION'] || 'us-east-1',
      accountId: process.env['AWS_ACCOUNT_ID'] || '',
    },
    s3: {
      documentsBucket: process.env['S3_DOCUMENTS_BUCKET'] || 'docintel-documents',
      presignedUrlExpiry: parseInt(process.env['S3_PRESIGNED_URL_EXPIRY'] || '3600', 10),
    },
    dynamodb: {
      metadataTable:
        process.env['DYNAMODB_METADATA_TABLE'] || 'DocIntel-DocumentMetadata',
      jobsTable: process.env['DYNAMODB_JOBS_TABLE'] || 'DocIntel-ProcessingJobs',
    },
    textract: {
      snsTopicArn: process.env['TEXTRACT_SNS_TOPIC_ARN'] || '',
      roleArn: process.env['TEXTRACT_ROLE_ARN'] || '',
    },
    logging: {
      level: process.env['LOG_LEVEL'] || 'info',
    },
  }),
);
