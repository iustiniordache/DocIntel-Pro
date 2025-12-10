/**
 * Index Handler - Indexes processed documents into OpenSearch
 *
 * Triggered by: DynamoDB Stream when document status changes to PROCESSED
 *
 * Flow:
 * 1. Receives DynamoDB stream event
 * 2. Fetches Textract results from S3
 * 3. Chunks the text into manageable pieces
 * 4. Generates embeddings using Bedrock Titan
 * 5. Indexes chunks into OpenSearch with vector embeddings
 */

import { DynamoDBStreamEvent, DynamoDBRecord, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { unmarshall, AttributeValue } from '@aws-sdk/util-dynamodb';
import pino from 'pino';

interface DocumentMetadata {
  documentId: string;
  filename: string;
  status: string;
  bucket: string;
  s3Key: string;
  pageCount?: number;
}

interface TextractBlock {
  BlockType: string;
  Text?: string;
  Page?: number;
}

interface TextractResults {
  Blocks: TextractBlock[];
}

// Configuration from environment variables
const CONFIG = {
  aws: {
    region: process.env['AWS_REGION'] || process.env['AWS_DEFAULT_REGION'] || 'us-east-1',
  },
  s3: {
    documentsBucket: process.env['S3_DOCUMENTS_BUCKET'] || '',
  },
  opensearch: {
    domain: process.env['OPENSEARCH_DOMAIN'] || '',
    indexName: process.env['OPENSEARCH_INDEX_NAME'] || 'docintel-vectors',
  },
  bedrock: {
    embeddingModel: 'amazon.titan-embed-text-v1',
  },
  chunking: {
    chunkSize: 1000, // Characters per chunk
    overlap: 100, // Overlap between chunks
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
};

// Lazy initialization of clients
let s3Client: S3Client;
let bedrockClient: BedrockRuntimeClient;
let osClient: Client;
let logger: pino.Logger;

function initializeServices() {
  if (!s3Client) {
    s3Client = new S3Client({ region: CONFIG.aws.region });
    bedrockClient = new BedrockRuntimeClient({ region: CONFIG.aws.region });

    osClient = new Client({
      ...AwsSigv4Signer({
        region: CONFIG.aws.region,
        service: 'es',
      }),
      node: CONFIG.opensearch.domain,
    });

    logger = pino({
      level: CONFIG.logging.level,
      formatters: {
        level: (label) => ({ level: label }),
      },
    });

    logger.info('Services initialized');
  }
}

/**
 * Fetch Textract results from S3
 */
async function getTextractResults(bucket: string, key: string): Promise<TextractResults> {
  const textractKey = key.replace('.pdf', '-textract.json');

  logger.info({ bucket, key: textractKey }, 'Fetching Textract results from S3');

  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: textractKey,
    }),
  );

  const body = await response.Body?.transformToString();
  if (!body) {
    throw new Error('Empty Textract results');
  }

  return JSON.parse(body);
}

/**
 * Extract text from Textract results, organized by page
 */
function extractTextByPage(textractResults: TextractResults): Map<number, string> {
  const pageTexts = new Map<number, string>();

  for (const block of textractResults.Blocks) {
    if (block.BlockType === 'LINE' && block.Text && block.Page) {
      const pageNumber = block.Page;
      const currentText = pageTexts.get(pageNumber) || '';
      pageTexts.set(pageNumber, currentText + block.Text + '\n');
    }
  }

  return pageTexts;
}

/**
 * Chunk text with overlap
 */
function chunkText(
  text: string,
  pageNumber: number,
): Array<{ text: string; pageNumber: number }> {
  const chunks: Array<{ text: string; pageNumber: number }> = [];
  const { chunkSize, overlap } = CONFIG.chunking;

  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    const chunk = text.slice(i, i + chunkSize);
    if (chunk.trim().length > 0) {
      chunks.push({ text: chunk.trim(), pageNumber });
    }
  }

  return chunks;
}

/**
 * Generate embedding using Bedrock Titan
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: CONFIG.bedrock.embeddingModel,
      body: JSON.stringify({ inputText: text }),
    }),
  );

  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

/**
 * Index chunks into OpenSearch
 */
async function indexChunks(
  documentId: string,
  filename: string,
  chunks: Array<{ text: string; pageNumber: number }>,
): Promise<void> {
  logger.info(
    { documentId, chunkCount: chunks.length },
    'Indexing chunks into OpenSearch',
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk) continue;

    const chunkId = `${documentId}-chunk-${i}`;

    logger.info(
      { chunkId, chunkIndex: i, totalChunks: chunks.length },
      'Generating embedding',
    );
    const embedding = await generateEmbedding(chunk.text);

    await osClient.index({
      index: CONFIG.opensearch.indexName,
      id: chunkId,
      body: {
        documentId,
        filename,
        chunkId,
        chunkIndex: i,
        content: chunk.text,
        embedding,
        pageNumber: chunk.pageNumber,
        createdAt: new Date().toISOString(),
      },
    });

    logger.info({ chunkId }, 'Chunk indexed successfully');
  }
}

/**
 * Process a single DynamoDB record
 */
async function processRecord(record: DynamoDBRecord): Promise<void> {
  // Only process INSERT and MODIFY events
  if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
    logger.info({ eventName: record.eventName }, 'Skipping non-INSERT/MODIFY event');
    return;
  }

  // Get new image (current state)
  const newImage = record.dynamodb?.NewImage;
  if (!newImage) {
    logger.warn('No new image in record');
    return;
  }

  // Cast to Record type for unmarshall
  const doc = unmarshall(newImage as Record<string, AttributeValue>) as DocumentMetadata;

  // Only process documents with PROCESSED status
  if (doc.status !== 'PROCESSED') {
    logger.info(
      { documentId: doc.documentId, status: doc.status },
      'Skipping non-PROCESSED document',
    );
    return;
  }

  logger.info(
    { documentId: doc.documentId, filename: doc.filename },
    'Processing document for indexing',
  );

  try {
    // Fetch Textract results
    const textractResults = await getTextractResults(doc.bucket, doc.s3Key);
    logger.info(
      { blockCount: textractResults.Blocks.length },
      'Textract results fetched',
    );

    // Extract text by page
    const pageTexts = extractTextByPage(textractResults);
    logger.info({ pageCount: pageTexts.size }, 'Text extracted from pages');

    // Chunk text from all pages
    const allChunks: Array<{ text: string; pageNumber: number }> = [];
    for (const [pageNumber, pageText] of pageTexts.entries()) {
      const pageChunks = chunkText(pageText, pageNumber);
      allChunks.push(...pageChunks);
    }

    logger.info({ chunkCount: allChunks.length }, 'Text chunked');

    // Index chunks
    await indexChunks(doc.documentId, doc.filename, allChunks);

    logger.info(
      { documentId: doc.documentId, chunkCount: allChunks.length },
      'Document indexed successfully',
    );
  } catch (error) {
    logger.error(
      {
        documentId: doc.documentId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
      'Error indexing document',
    );
    throw error;
  }
}

/**
 * Main Lambda handler
 */
export async function handler(
  event: DynamoDBStreamEvent,
  context: Context,
): Promise<void> {
  initializeServices();

  logger.info(
    {
      requestId: context.awsRequestId,
      recordCount: event.Records.length,
    },
    'Processing DynamoDB stream event',
  );

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      logger.error(
        {
          eventId: record.eventID,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to process record',
      );
      // Continue processing other records
    }
  }

  logger.info('Batch processing complete');
}
