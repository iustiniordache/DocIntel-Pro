/**
 * Shared Configuration for Lambda Handlers
 * Centralizes all environment variable access
 */

export interface HandlerConfig {
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
    workspacesTable: string;
  };
  textract: {
    snsTopicArn: string;
    roleArn: string;
    confidenceThreshold: number;
    costPerPage: number;
  };
  opensearch: {
    endpoint: string;
    indexName: string;
  };
  bedrock: {
    embeddingModelId: string;
    llmModelId: string;
    temperature: number;
    maxTokens: number;
  };
  search: {
    topK: number;
    similarityThreshold: number;
  };
  chunking: {
    chunkSize: number;
    overlap: number;
  };
  validation: {
    maxFilenameLength: number;
    maxFileSizeBytes: number;
    maxQuestionLength: number;
    rateLimitMax: number;
  };
  logging: {
    level: string;
  };
}

/**
 * Get configuration from environment variables
 * This is called once per Lambda cold start
 */
export const getConfig = (): HandlerConfig => ({
  aws: {
    region: process.env['AWS_REGION'] || 'us-east-1',
    accountId: process.env['AWS_ACCOUNT_ID'] || '',
  },
  s3: {
    documentsBucket: process.env['S3_DOCUMENTS_BUCKET'] || '',
    presignedUrlExpiry: parseInt(process.env['S3_PRESIGNED_URL_EXPIRY'] || '300', 10),
  },
  dynamodb: {
    metadataTable: process.env['DYNAMODB_METADATA_TABLE'] || '',
    jobsTable: process.env['DYNAMODB_JOBS_TABLE'] || '',
    workspacesTable: process.env['DYNAMODB_WORKSPACES_TABLE'] || '',
  },
  textract: {
    snsTopicArn: process.env['TEXTRACT_SNS_TOPIC_ARN'] || '',
    roleArn: process.env['TEXTRACT_ROLE_ARN'] || '',
    confidenceThreshold: parseFloat(process.env['TEXTRACT_CONFIDENCE_THRESHOLD'] || '80'),
    costPerPage: parseFloat(process.env['TEXTRACT_COST_PER_PAGE'] || '0.0015'),
  },
  opensearch: {
    endpoint:
      process.env['OPENSEARCH_DOMAIN'] || process.env['OPENSEARCH_ENDPOINT'] || '',
    indexName: process.env['OPENSEARCH_INDEX_NAME'] || 'docintel-vectors',
  },
  bedrock: {
    embeddingModelId:
      process.env['BEDROCK_EMBEDDING_MODEL_ID'] || 'amazon.titan-embed-text-v2:0',
    llmModelId:
      process.env['BEDROCK_LLM_MODEL_ID'] || 'anthropic.claude-3-haiku-20240307-v1:0',
    temperature: parseFloat(process.env['BEDROCK_TEMPERATURE'] || '0.3'),
    maxTokens: parseInt(process.env['BEDROCK_MAX_TOKENS'] || '500', 10),
  },
  search: {
    topK: parseInt(process.env['SEARCH_TOP_K'] || '10', 10),
    similarityThreshold: parseFloat(process.env['SEARCH_SIMILARITY_THRESHOLD'] || '0.5'),
  },
  chunking: {
    chunkSize: parseInt(process.env['CHUNK_SIZE'] || '1000', 10),
    overlap: parseInt(process.env['CHUNK_OVERLAP'] || '100', 10),
  },
  validation: {
    maxFilenameLength: 100,
    maxFileSizeBytes: 52428800, // 50MB
    maxQuestionLength: 500,
    rateLimitMax: 10, // per minute
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
});

// Singleton config instance (cached per Lambda container)
let configInstance: HandlerConfig | null = null;

export const config = (): HandlerConfig => {
  if (!configInstance) {
    configInstance = getConfig();
  }
  return configInstance;
};
