/**
 * Manual Document Indexing Script
 *
 * This script indexes a processed document into OpenSearch:
 * 1. Fetches document from DynamoDB
 * 2. Retrieves Textract results from S3
 * 3. Chunks the text
 * 4. Generates embeddings using Bedrock
 * 5. Indexes into OpenSearch
 *
 * Usage: ts-node scripts/index-document.ts <documentId>
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const REGION = 'us-east-1';
const METADATA_TABLE = 'DocIntel-DocumentMetadata';
const OPENSEARCH_ENDPOINT =
  'https://search-docintel-vectors-dev-ndhlxs7oks7frhkm6odabfziua.us-east-1.es.amazonaws.com';
const INDEX_NAME = 'docintel-vectors';

const dynamoClient = new DynamoDBClient({ region: REGION });
const s3Client = new S3Client({ region: REGION });
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

const osClient = new Client({
  ...AwsSigv4Signer({
    region: REGION,
    service: 'es',
  }),
  node: OPENSEARCH_ENDPOINT,
});

async function getDocument(documentId: string) {
  const result = await dynamoClient.send(
    new GetItemCommand({
      TableName: METADATA_TABLE,
      Key: { documentId: { S: documentId } },
    }),
  );

  if (!result.Item) {
    throw new Error(`Document ${documentId} not found`);
  }

  return unmarshall(result.Item);
}

async function getTextractResults(bucket: string, key: string) {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key.replace('.pdf', '-textract.json'),
    }),
  );

  const body = await response.Body?.transformToString();
  return JSON.parse(body || '{}');
}

function chunkText(text: string, chunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: 'amazon.titan-embed-text-v1',
      body: JSON.stringify({ inputText: text }),
    }),
  );

  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.embedding;
}

async function indexDocument(documentId: string) {
  console.warn(`Fetching document ${documentId}...`);
  const doc: { bucket: string; s3Key: string; filename: string } =
    await getDocument(documentId);

  console.warn(`Fetching Textract results from S3...`);
  const textractResults = await getTextractResults(doc.bucket, doc.s3Key);

  // Extract text from Textract results
  let fullText = '';
  if (textractResults.Blocks) {
    fullText = textractResults.Blocks.filter(
      (block: { BlockType: string; Text?: string }) => block.BlockType === 'LINE',
    )
      .map((block: { Text?: string }) => block.Text)
      .join('\n');
  }

  console.warn(`Extracted ${fullText.length} characters`);
  console.warn(`Chunking text...`);
  const chunks = chunkText(fullText);
  console.warn(`Created ${chunks.length} chunks`);

  console.warn(`Indexing chunks into OpenSearch...`);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    console.warn(`  Chunk ${i + 1}/${chunks.length}...`);

    const embedding = await generateEmbedding(chunk);

    await osClient.index({
      index: INDEX_NAME,
      body: {
        documentId,
        filename: doc.filename,
        chunkId: `${documentId}-chunk-${i}`,
        chunkIndex: i,
        content: chunk,
        embedding,
        pageNumber: Math.floor(i / 2) + 1, // Rough estimate
        createdAt: new Date().toISOString(),
      },
    });
  }

  console.warn(`✅ Successfully indexed ${chunks.length} chunks`);
}

// Main execution
const documentId = process.argv[2];
if (!documentId) {
  console.error('Usage: ts-node scripts/index-document.ts <documentId>');
  process.exit(1);
}

indexDocument(documentId)
  .then(() => {
    console.warn('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
