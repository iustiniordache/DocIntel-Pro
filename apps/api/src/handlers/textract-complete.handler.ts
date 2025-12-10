/**
 * Textract Complete Handler - Textract → Embedding Pipeline
 *
 * Flow:
 * 1. SNS notification from Textract job completion
 * 2. Fetch job metadata from DynamoDB
 * 3. Retrieve Textract results (paginated)
 * 4. Parse structured output (pages, tables, forms)
 * 5. Send to document processing pipeline (chunking + embeddings)
 * 6. Update job and document status
 *
 * Architecture:
 * Textract → SNS → Lambda (this) → Document Service → Vector DB
 */

import { SNSEvent, SNSEventRecord, Context } from 'aws-lambda';
import {
  TextractClient,
  GetDocumentTextDetectionCommand,
  GetDocumentTextDetectionResponse,
  Block,
  BlockType,
} from '@aws-sdk/client-textract';
import {
  DynamoDBClient,
  QueryCommand,
  UpdateItemCommand,
  QueryCommandInput,
  UpdateItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import pino from 'pino';

// Types
interface TextractNotification {
  JobId: string;
  Status: 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS';
  API: string;
  JobTag?: string;
  Timestamp: number;
  DocumentLocation: {
    S3ObjectName: string;
    S3Bucket: string;
  };
}

interface ProcessingJob {
  jobId: string;
  documentId: string;
  bucket: string;
  s3Key: string;
  status: string;
  createdAt: string;
  textractJobId: string;
  uploadDate?: string;
}

interface TextractPage {
  pageNumber: number;
  text: string;
  confidence: number;
}

interface TextractTable {
  pageNumber: number;
  markdown: string;
  confidence: number;
}

interface KeyValuePair {
  key: string;
  value: string;
  confidence: number;
}

interface TextractForm {
  pageNumber: number;
  keyValuePairs: KeyValuePair[];
}

interface ParsedDocument {
  pages: TextractPage[];
  tables: TextractTable[];
  forms: TextractForm[];
  plainText: string;
  pageCount: number;
  averageConfidence: number;
}

const DocumentStatus = {
  TEXTRACT_IN_PROGRESS: 'TEXTRACT_IN_PROGRESS',
  TEXTRACT_COMPLETED: 'TEXTRACT_COMPLETED',
  PROCESSED: 'PROCESSED',
  FAILED_TEXTRACT: 'FAILED_TEXTRACT',
  FAILED_TEXTRACT_PROCESSING: 'FAILED_TEXTRACT_PROCESSING',
} as const;

const JobStatus = {
  IN_PROGRESS: 'TEXTRACT_IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED_TEXTRACT: 'FAILED_TEXTRACT',
  FAILED_TEXTRACT_PROCESSING: 'FAILED_TEXTRACT_PROCESSING',
} as const;

// Configuration from environment variables
const CONFIG = {
  aws: {
    region: process.env['AWS_REGION'] || process.env['AWS_DEFAULT_REGION'] || 'us-east-1',
  },
  dynamodb: {
    metadataTable: process.env['DYNAMODB_METADATA_TABLE'] || '',
    jobsTable: process.env['DYNAMODB_JOBS_TABLE'] || '',
  },
  s3: {
    documentsBucket: process.env['S3_DOCUMENTS_BUCKET'] || '',
  },
  opensearch: {
    domain: process.env['OPENSEARCH_DOMAIN'] || '',
    indexName: process.env['OPENSEARCH_INDEX_NAME'] || 'docintel-vectors',
  },
  bedrock: {
    embeddingModel: 'amazon.titan-embed-text-v2:0',
  },
  textract: {
    confidenceThreshold: parseFloat(process.env['TEXTRACT_CONFIDENCE_THRESHOLD'] || '80'),
    costPerPage: parseFloat(process.env['TEXTRACT_COST_PER_PAGE'] || '0.0015'),
  },
  chunking: {
    chunkSize: 1000,
    overlap: 100,
  },
  logging: {
    level: process.env['LOG_LEVEL'] || 'info',
  },
};

// Lazy initialization of AWS clients
let textractClient: TextractClient;
let dynamoClient: DynamoDBClient;
let s3Client: S3Client;
let bedrockClient: BedrockRuntimeClient;
let osClient: Client;
let logger: pino.Logger;

async function initializeServices() {
  if (!textractClient) {
    textractClient = new TextractClient({
      region: CONFIG.aws.region,
    });

    dynamoClient = new DynamoDBClient({
      region: CONFIG.aws.region,
    });

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
        chunkId,
        content: chunk.text,
        embedding,
        metadata: {
          page: chunk.pageNumber,
          source: filename,
          timestamp: new Date().toISOString(),
        },
      },
    });

    logger.info({ chunkId }, 'Chunk indexed successfully');
  }
}

/**
 * Parse SNS message to extract Textract notification
 */
function parseTextractNotification(message: string): TextractNotification | null {
  try {
    const notification = JSON.parse(message) as TextractNotification;

    if (!notification.JobId || !notification.Status) {
      logger.warn({ notification }, 'Invalid Textract notification structure');
      return null;
    }

    return notification;
  } catch (error) {
    logger.error({ error, message }, 'Failed to parse Textract notification');
    return null;
  }
}

/**
 * Lookup processing job by Textract JobId
 */
async function lookupJobByTextractId(
  textractJobId: string,
): Promise<ProcessingJob | null> {
  try {
    const params: QueryCommandInput = {
      TableName: CONFIG.dynamodb.jobsTable,
      IndexName: 'TextractJobIdIndex', // GSI on textractJobId
      KeyConditionExpression: 'textractJobId = :jobId',
      ExpressionAttributeValues: marshall({
        ':jobId': textractJobId,
      }),
      Limit: 1,
    };

    const result = await dynamoClient.send(new QueryCommand(params));

    if (!result.Items || result.Items.length === 0) {
      logger.warn({ textractJobId }, 'Job not found for Textract JobId');
      return null;
    }

    const firstItem = result.Items[0];
    if (!firstItem) {
      throw new Error('Job not found in DynamoDB');
    }

    const job = unmarshall(firstItem) as ProcessingJob;
    logger.info({ jobId: job.jobId, documentId: job.documentId }, 'Job found');

    return job;
  } catch (error) {
    logger.error({ error, textractJobId }, 'Failed to lookup job');
    return null;
  }
}

/**
 * Fetch all Textract results with pagination
 */
async function fetchTextractResults(jobId: string): Promise<Block[]> {
  const allBlocks: Block[] = [];
  let nextToken: string | undefined;
  let pageCount = 0;

  logger.info({ jobId }, 'Fetching Textract results');

  try {
    do {
      const command = new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      });

      const response: GetDocumentTextDetectionResponse =
        await textractClient.send(command);

      if (response.Blocks) {
        allBlocks.push(...response.Blocks);
        pageCount++;
      }

      nextToken = response.NextToken;

      logger.info(
        { jobId, pageCount, blocksFetched: allBlocks.length, hasMore: !!nextToken },
        'Fetched Textract page',
      );
    } while (nextToken);

    logger.info(
      { jobId, totalBlocks: allBlocks.length, pages: pageCount },
      'All blocks fetched',
    );

    return allBlocks;
  } catch (error) {
    logger.error({ error, jobId }, 'Failed to fetch Textract results');
    throw new Error(
      `Failed to fetch Textract results: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Parse Textract blocks into structured document
 */
function parseTextractBlocks(blocks: Block[]): ParsedDocument {
  const pages: TextractPage[] = [];
  const tables: TextractTable[] = [];
  const forms: TextractForm[] = [];
  const pageMap = new Map<number, Block[]>();
  let totalConfidence = 0;
  let confidenceCount = 0;

  // Group blocks by page
  for (const block of blocks) {
    if (block.Page) {
      if (!pageMap.has(block.Page)) {
        pageMap.set(block.Page, []);
      }
      const pageBlocks = pageMap.get(block.Page);
      if (pageBlocks) {
        pageBlocks.push(block);
      }
    }
  }

  // Process each page
  for (const [pageNumber, pageBlocks] of pageMap.entries()) {
    // Extract text from LINE blocks (in reading order)
    const lines = pageBlocks
      .filter(
        (b) =>
          b.BlockType === BlockType.LINE &&
          (b.Confidence || 0) >= CONFIG.textract.confidenceThreshold,
      )
      .sort((a, b) => {
        // Sort by vertical position (top to bottom), then horizontal (left to right)
        const aTop = a.Geometry?.BoundingBox?.Top || 0;
        const bTop = b.Geometry?.BoundingBox?.Top || 0;
        const aLeft = a.Geometry?.BoundingBox?.Left || 0;
        const bLeft = b.Geometry?.BoundingBox?.Left || 0;

        if (Math.abs(aTop - bTop) < 0.01) {
          // Same line (vertical tolerance)
          return aLeft - bLeft;
        }
        return aTop - bTop;
      });

    const pageText = lines.map((l) => l.Text || '').join('\n');
    const pageConfidence =
      lines.reduce((sum, l) => sum + (l.Confidence || 0), 0) / (lines.length || 1);

    if (pageText.trim()) {
      pages.push({
        pageNumber,
        text: pageText,
        confidence: pageConfidence,
      });

      totalConfidence += pageConfidence;
      confidenceCount++;
    }

    // Extract tables (simplified - convert to markdown)
    const tableBlocks = pageBlocks.filter((b) => b.BlockType === BlockType.TABLE);

    for (const table of tableBlocks) {
      const markdown = convertTableToMarkdown(table, pageBlocks);
      if (markdown) {
        tables.push({
          pageNumber,
          markdown,
          confidence: table.Confidence || 0,
        });
      }
    }

    // Extract key-value pairs (forms)
    const kvPairs = extractKeyValuePairs(pageBlocks);
    if (kvPairs.length > 0) {
      forms.push({
        pageNumber,
        keyValuePairs: kvPairs,
      });
    }
  }

  const plainText = pages.map((p) => p.text).join('\n\n');
  const averageConfidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 0;

  return {
    pages,
    tables,
    forms,
    plainText,
    pageCount: pageMap.size,
    averageConfidence,
  };
}

/**
 * Convert TABLE block to markdown (simplified)
 */
function convertTableToMarkdown(tableBlock: Block, allBlocks: Block[]): string | null {
  if (!tableBlock.Relationships) return null;

  const cellBlocks = tableBlock.Relationships.flatMap((rel) =>
    rel.Ids?.map((id) => allBlocks.find((b) => b.Id === id)).filter(Boolean),
  ).filter((b): b is Block => b !== undefined && b.BlockType === BlockType.CELL);

  if (cellBlocks.length === 0) return null;

  // Group cells by row
  const rows = new Map<number, Block[]>();
  for (const cell of cellBlocks) {
    const rowIndex = cell.RowIndex || 0;
    if (!rows.has(rowIndex)) {
      rows.set(rowIndex, []);
    }
    const row = rows.get(rowIndex);
    if (row) {
      row.push(cell);
    }
  }

  // Sort rows and cells
  const sortedRows = Array.from(rows.entries())
    .sort(([a], [b]) => a - b)
    .map(([, cells]) =>
      cells.sort((a, b) => (a.ColumnIndex || 0) - (b.ColumnIndex || 0)),
    );

  // Build markdown table
  const lines: string[] = [];

  for (let i = 0; i < sortedRows.length; i++) {
    const row = sortedRows[i];
    if (!row) continue;

    const cellTexts = row.map((cell) => {
      const textIds = cell.Relationships?.find((r) => r.Type === 'CHILD')?.Ids || [];
      const texts = textIds
        .map((id) => allBlocks.find((b) => b.Id === id))
        .filter((b): b is Block => b !== undefined)
        .map((b) => b.Text || '')
        .join(' ');
      return texts.trim() || ' ';
    });

    lines.push(`| ${cellTexts.join(' | ')} |`);

    // Add header separator after first row
    if (i === 0) {
      lines.push(`| ${cellTexts.map(() => '---').join(' | ')} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Extract key-value pairs from KEY_VALUE_SET blocks
 */
function extractKeyValuePairs(blocks: Block[]): KeyValuePair[] {
  const pairs: KeyValuePair[] = [];
  const kvBlocks = blocks.filter((b) => b.BlockType === BlockType.KEY_VALUE_SET);

  for (const kvBlock of kvBlocks) {
    if (!kvBlock.EntityTypes?.includes('KEY')) continue;

    const keyText = extractTextFromBlock(kvBlock, blocks);
    const valueBlock = findValueBlock(kvBlock, blocks);
    const valueText = valueBlock ? extractTextFromBlock(valueBlock, blocks) : '';

    if (keyText && (kvBlock.Confidence || 0) >= CONFIG.textract.confidenceThreshold) {
      pairs.push({
        key: keyText,
        value: valueText,
        confidence: kvBlock.Confidence || 0,
      });
    }
  }

  return pairs;
}

/**
 * Extract text from a block by following CHILD relationships
 */
function extractTextFromBlock(block: Block, allBlocks: Block[]): string {
  const childIds = block.Relationships?.find((r) => r.Type === 'CHILD')?.Ids || [];
  const texts = childIds
    .map((id) => allBlocks.find((b) => b.Id === id))
    .filter((b): b is Block => b !== undefined)
    .map((b) => b.Text || '')
    .join(' ');

  return texts.trim();
}

/**
 * Find VALUE block for a KEY block
 */
function findValueBlock(keyBlock: Block, allBlocks: Block[]): Block | null {
  const valueIds = keyBlock.Relationships?.find((r) => r.Type === 'VALUE')?.Ids || [];
  if (valueIds.length === 0) return null;

  const valueBlock = allBlocks.find(
    (b) => b.Id === valueIds[0] && b.EntityTypes?.includes('VALUE'),
  );

  return valueBlock || null;
}

/**
 * Update processing job status
 */
async function updateJobStatus(
  jobId: string,
  status: string,
  pageCount?: number,
): Promise<void> {
  try {
    const updateExpression = pageCount
      ? 'SET #status = :status, completedAt = :completedAt, pageCount = :pageCount'
      : 'SET #status = :status, completedAt = :completedAt';

    const expressionValues: Record<string, AttributeValue> = {
      ':status': { S: status },
      ':completedAt': { S: new Date().toISOString() },
    };

    if (pageCount !== undefined) {
      expressionValues[':pageCount'] = { N: String(pageCount) };
    }

    const params: UpdateItemCommandInput = {
      TableName: CONFIG.dynamodb.jobsTable,
      Key: marshall({ jobId }),
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall(expressionValues),
    };

    await dynamoClient.send(new UpdateItemCommand(params));
    logger.info({ jobId, status, pageCount }, 'Job status updated');
  } catch (error) {
    logger.error({ error, jobId, status }, 'Failed to update job status');
    throw error;
  }
}

/**
 * Update document metadata
 */
async function updateDocumentMetadata(
  documentId: string,
  status: string,
  pageCount: number,
): Promise<void> {
  try {
    const textractCost = pageCount * CONFIG.textract.costPerPage;

    const params: UpdateItemCommandInput = {
      TableName: CONFIG.dynamodb.metadataTable,
      Key: marshall({ documentId }),
      UpdateExpression:
        'SET #status = :status, pageCount = :pageCount, textractCost = :cost, processedAt = :processedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: marshall({
        ':status': status,
        ':pageCount': pageCount,
        ':cost': textractCost,
        ':processedAt': new Date().toISOString(),
      }),
    };

    await dynamoClient.send(new UpdateItemCommand(params));
    logger.info(
      { documentId, status, pageCount, textractCost },
      'Document metadata updated',
    );
  } catch (error) {
    logger.error({ error, documentId, status }, 'Failed to update document metadata');
    throw error;
  }
}

/**
 * Process parsed document (placeholder for embedding pipeline)
 */
async function processDocumentForEmbeddings(
  parsed: ParsedDocument,
  documentId: string,
  jobId: string,
): Promise<{ chunksGenerated: number; totalTokens: number; embeddingCost: number }> {
  // TODO: Implement actual document processing pipeline
  // This will:
  // 1. Chunk the text using sliding window
  // 2. Generate embeddings via OpenAI/Azure OpenAI
  // 3. Store in vector database (Pinecone/Weaviate)
  // 4. Index for semantic search

  logger.info(
    {
      documentId,
      jobId,
      pageCount: parsed.pageCount,
      textLength: parsed.plainText.length,
    },
    'Processing document for embeddings (PLACEHOLDER)',
  );

  // Placeholder metrics
  const estimatedChunks = Math.ceil(parsed.plainText.length / 1000);
  const estimatedTokens = estimatedChunks * 500;
  const estimatedCost = estimatedTokens * 0.0001; // Example: $0.0001 per 1k tokens

  return {
    chunksGenerated: estimatedChunks,
    totalTokens: estimatedTokens,
    embeddingCost: estimatedCost,
  };
}

/**
 * Process a single SNS record
 */
async function processRecord(record: SNSEventRecord, requestId: string): Promise<void> {
  const message = record.Sns.Message;

  logger.info({ requestId, messageId: record.Sns.MessageId }, 'Processing SNS record');

  // Parse Textract notification
  const notification = parseTextractNotification(message);
  if (!notification) {
    logger.warn({ message }, 'Invalid Textract notification, skipping');
    return;
  }

  const { JobId: textractJobId, Status: textractStatus } = notification;

  logger.info(
    { textractJobId, textractStatus, requestId },
    'Textract notification received',
  );

  // Lookup job
  const job = await lookupJobByTextractId(textractJobId);
  if (!job) {
    logger.warn({ textractJobId }, 'Job not found, exiting gracefully');
    return;
  }

  const { jobId, documentId } = job;

  try {
    // Handle non-success status
    if (textractStatus !== 'SUCCEEDED') {
      logger.warn(
        { textractJobId, textractStatus, documentId, jobId },
        'Textract job failed',
      );

      await updateJobStatus(jobId, JobStatus.FAILED_TEXTRACT);
      await updateDocumentMetadata(documentId, DocumentStatus.FAILED_TEXTRACT, 0);

      return;
    }

    // Fetch Textract results
    const blocks = await fetchTextractResults(textractJobId);

    // Parse structured output
    const parsed = parseTextractBlocks(blocks);

    logger.info(
      {
        documentId,
        jobId,
        pageCount: parsed.pageCount,
        averageConfidence: parsed.averageConfidence.toFixed(2),
        tablesFound: parsed.tables.length,
        formsFound: parsed.forms.length,
      },
      'Textract results parsed',
    );

    // Store Textract results to S3 for reference
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: CONFIG.s3.documentsBucket,
          Key: `${job.s3Key.replace('.pdf', '')}-textract.json`,
          Body: JSON.stringify({ Blocks: blocks }),
          ContentType: 'application/json',
        }),
      );
      logger.info(
        { documentId, s3Key: `${job.s3Key.replace('.pdf', '')}-textract.json` },
        'Textract results stored to S3',
      );
    } catch (error) {
      logger.warn({ error, documentId }, 'Failed to store Textract results to S3');
    }

    // Get filename from metadata
    const filename = job.s3Key.split('/').pop() || 'unknown.pdf';

    // Chunk text by page
    const allChunks: Array<{ text: string; pageNumber: number }> = [];
    for (const page of parsed.pages) {
      const pageChunks = chunkText(page.text, page.pageNumber);
      allChunks.push(...pageChunks);
    }

    logger.info({ documentId, chunkCount: allChunks.length }, 'Text chunked');

    // Index chunks into OpenSearch
    await indexChunks(documentId, filename, allChunks);

    logger.info(
      { documentId, chunkCount: allChunks.length },
      'Document indexed successfully',
    );

    // Process for embeddings (legacy - can be removed if not needed)
    const embedMetrics = await processDocumentForEmbeddings(parsed, documentId, jobId);

    logger.info(
      {
        documentId,
        jobId,
        chunksGenerated: embedMetrics.chunksGenerated,
        totalTokens: embedMetrics.totalTokens,
        embeddingCost: embedMetrics.embeddingCost.toFixed(4),
      },
      'Document processed for embeddings',
    );

    // Update statuses
    await updateJobStatus(jobId, JobStatus.COMPLETED, parsed.pageCount);
    await updateDocumentMetadata(documentId, DocumentStatus.PROCESSED, parsed.pageCount);

    logger.info(
      { documentId, jobId, pageCount: parsed.pageCount },
      'Document processing completed successfully',
    );
  } catch (error) {
    logger.error(
      { error, documentId, jobId, textractJobId },
      'Failed to process Textract results',
    );

    // Mark as failed
    await updateJobStatus(jobId, JobStatus.FAILED_TEXTRACT_PROCESSING);
    await updateDocumentMetadata(
      documentId,
      DocumentStatus.FAILED_TEXTRACT_PROCESSING,
      0,
    );

    throw error;
  }
}

/**
 * Main Lambda handler
 */
export async function handler(event: SNSEvent, context: Context): Promise<void> {
  await initializeServices();

  const requestId = context.awsRequestId;

  logger.info(
    { requestId, recordCount: event.Records?.length || 0 },
    'Processing SNS event',
  );

  // Process all records in parallel
  const results = await Promise.allSettled(
    (event.Records || []).map((record) => processRecord(record, requestId)),
  );

  // Log results
  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  logger.info(
    { requestId, total: event.Records?.length || 0, succeeded, failed },
    'SNS event processing completed',
  );

  // Log individual failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error(
        { recordIndex: index, error: result.reason, record: event.Records?.[index] },
        'Record processing failed',
      );
    }
  });
}
