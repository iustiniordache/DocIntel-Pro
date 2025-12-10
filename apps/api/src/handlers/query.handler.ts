/**
 * Query Handler - RAG Inference with Claude 3 Haiku
 *
 * Flow:
 * 1. Parse and validate question from request body
 * 2. Generate embedding for question (EmbeddingService)
 * 3. Hybrid search in vector store (VectorStoreService)
 * 4. Filter chunks by similarity threshold (>0.7)
 * 5. Construct RAG prompt with source chunks
 * 6. Call Bedrock Claude 3 Haiku for answer generation
 * 7. Return answer with sources and confidence
 *
 * Architecture:
 * API Gateway → Lambda (this) → EmbeddingService → Bedrock Titan
 *                             → VectorStoreService → OpenSearch
 *                             → Bedrock Claude → Response
 */

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { NestFactory } from '@nestjs/core';
import { EmbeddingService } from '../modules/embedding/embedding.service';
import { EmbeddingModule } from '../modules/embedding/embedding.module';
import { VectorStoreService } from '../modules/vector-store/vector-store.service';
import { VectorStoreModule } from '../modules/vector-store/vector-store.module';
import { SearchResult } from '../modules/vector-store/vector-store.service';
import pino from 'pino';

// Configuration
const CONFIG = {
  aws: {
    region: process.env['AWS_REGION'] || 'us-east-1',
  },
  bedrock: {
    modelId:
      process.env['BEDROCK_LLM_MODEL_ID'] || 'anthropic.claude-3-haiku-20240307-v1:0',
    temperature: 0.3,
    maxTokens: 500,
  },
  search: {
    topK: 10,
    similarityThreshold: 0.7,
  },
  validation: {
    maxQuestionLength: 500,
  },
};

// Types
interface QueryRequest {
  question: string;
  documentId?: string;
}

interface Source {
  id: string;
  similarity: number;
  pageNumber?: number;
  content?: string;
}

interface QueryResponse {
  answer: string;
  sources: Source[];
  confidence: number;
}

interface ClaudeRequest {
  anthropic_version: string;
  max_tokens: number;
  temperature: number;
  messages: Array<{
    role: string;
    content: string;
  }>;
}

interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Logger
const logger = pino({
  level: process.env['LOG_LEVEL'] || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Service instances (lazy loaded)
let embeddingService: EmbeddingService;
let vectorStoreService: VectorStoreService;
let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Get or create EmbeddingService instance
 */
async function getEmbeddingService(): Promise<EmbeddingService> {
  if (!embeddingService) {
    const app = await NestFactory.createApplicationContext(EmbeddingModule, {
      logger: false,
    });
    embeddingService = app.get(EmbeddingService);
  }
  return embeddingService;
}

/**
 * Get or create VectorStoreService instance
 */
async function getVectorStoreService(): Promise<VectorStoreService> {
  if (!vectorStoreService) {
    const app = await NestFactory.createApplicationContext(VectorStoreModule, {
      logger: false,
    });
    vectorStoreService = app.get(VectorStoreService);
  }
  return vectorStoreService;
}

/**
 * Get or create BedrockRuntimeClient instance
 */
function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      region: CONFIG.aws.region,
    });
  }
  return bedrockClient;
}

/**
 * Validate request body
 */
function validateRequest(body: unknown): {
  valid: boolean;
  error?: string;
  data?: QueryRequest;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' };
  }

  const bodyObj = body as Record<string, unknown>;

  if (!bodyObj['question'] || typeof bodyObj['question'] !== 'string') {
    return { valid: false, error: 'Question is required and must be a string' };
  }

  const question = (bodyObj['question'] as string).trim();

  if (question.length === 0) {
    return { valid: false, error: 'Question cannot be empty' };
  }

  if (question.length > CONFIG.validation.maxQuestionLength) {
    return {
      valid: false,
      error: `Question exceeds maximum length of ${CONFIG.validation.maxQuestionLength} characters`,
    };
  }

  return {
    valid: true,
    data: {
      question,
      documentId: bodyObj['documentId'] as string | undefined,
    },
  };
}

/**
 * Construct RAG prompt with source chunks
 */
function constructPrompt(question: string, chunks: SearchResult[]): string {
  const sourceTexts = chunks
    .map((chunk, index) => {
      const sourceId = `S${index + 1}`;
      const pageInfo = chunk.metadata['page'] ? ` (Page ${chunk.metadata['page']})` : '';
      return `[${sourceId}]${pageInfo}: ${chunk.content}`;
    })
    .join('\n\n');

  return `You are a helpful AI assistant answering questions based on provided document excerpts. Your task is to provide accurate, concise answers using ONLY the information from the sources below.

Guidelines:
- Answer the question directly and concisely
- Use information ONLY from the provided sources
- Cite sources using [S1], [S2], etc. when referencing information
- If the sources don't contain enough information, say "The provided documents don't contain sufficient information to answer this question"
- Keep your answer under 500 words
- Be precise and factual

Sources:
${sourceTexts}

Question: ${question}

Answer:`;
}

/**
 * Call Claude 3 Haiku for answer generation
 */
async function generateAnswer(prompt: string): Promise<string> {
  const client = getBedrockClient();

  const requestBody: ClaudeRequest = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: CONFIG.bedrock.maxTokens,
    temperature: CONFIG.bedrock.temperature,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId: CONFIG.bedrock.modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  logger.debug({
    msg: 'Calling Claude 3 Haiku',
    modelId: CONFIG.bedrock.modelId,
    temperature: CONFIG.bedrock.temperature,
    maxTokens: CONFIG.bedrock.maxTokens,
  });

  const response = await client.send(command);

  if (!response.body) {
    throw new Error('Empty response from Bedrock');
  }

  const responseBody = JSON.parse(
    new TextDecoder().decode(response.body),
  ) as ClaudeResponse;

  logger.debug({
    msg: 'Claude response received',
    inputTokens: responseBody.usage.input_tokens,
    outputTokens: responseBody.usage.output_tokens,
    stopReason: responseBody.stop_reason,
  });

  if (responseBody.content.length === 0) {
    throw new Error('No content in Claude response');
  }

  return responseBody.content[0]?.text || '';
}

/**
 * Calculate confidence score based on chunk similarities
 */
function calculateConfidence(chunks: SearchResult[]): number {
  if (chunks.length === 0) return 0;

  // Use highest similarity score as confidence
  const maxSimilarity = Math.max(...chunks.map((c) => c.similarity_score));

  // Normalize to 0-1 range (assuming scores can be > 1 in some cases)
  return Math.min(maxSimilarity, 1.0);
}

/**
 * Format sources for response
 */
function formatSources(chunks: SearchResult[]): Source[] {
  return chunks.map((chunk, index) => ({
    id: `S${index + 1}`,
    similarity: Math.round(chunk.similarity_score * 100) / 100, // Round to 2 decimals
    pageNumber:
      chunk.metadata['page'] !== undefined && typeof chunk.metadata['page'] === 'number'
        ? (chunk.metadata['page'] as number)
        : undefined,
    content: chunk.content.substring(0, 200), // First 200 chars for preview
  }));
}

/**
 * Create error response
 */
function errorResponse(statusCode: number, message: string): APIGatewayProxyResultV2 {
  logger.error({
    msg: 'Error response',
    statusCode,
    message,
  });

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error: message,
    }),
  };
}

/**
 * Create success response
 */
function successResponse(data: QueryResponse): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(data),
  };
}

/**
 * Main handler function
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context,
): Promise<APIGatewayProxyResultV2> {
  const requestId = context.awsRequestId;

  logger.info({
    msg: 'Query request received',
    requestId,
  });

  try {
    // 1. Parse and validate request
    const body = event.body ? JSON.parse(event.body) : null;
    const validation = validateRequest(body);

    if (!validation.valid) {
      return errorResponse(400, validation.error || 'Invalid request');
    }

    if (!validation.data) {
      return errorResponse(400, 'Invalid request data');
    }

    const { question, documentId } = validation.data;

    logger.info({
      msg: 'Processing query',
      question: question.substring(0, 100),
      documentId,
      requestId,
    });

    // 2. Generate embedding for question
    const embeddingSvc = await getEmbeddingService();
    const questionEmbedding = await embeddingSvc.embedText(question);

    logger.debug({
      msg: 'Question embedding generated',
      dimensions: questionEmbedding.length,
    });

    // 3. Hybrid search in vector store
    const vectorStoreSvc = await getVectorStoreService();
    const searchResults = await vectorStoreSvc.hybridSearch(
      questionEmbedding,
      question,
      CONFIG.search.topK,
    );

    logger.info({
      msg: 'Search completed',
      resultsCount: searchResults.length,
      requestId,
    });

    // 4. Filter by documentId if specified
    let filteredResults = searchResults;
    if (documentId) {
      filteredResults = searchResults.filter((r) => r.documentId === documentId);
      logger.debug({
        msg: 'Filtered by document ID',
        documentId,
        beforeCount: searchResults.length,
        afterCount: filteredResults.length,
      });
    }

    // 5. Filter by similarity threshold
    const relevantChunks = filteredResults.filter(
      (chunk) => chunk.similarity_score >= CONFIG.search.similarityThreshold,
    );

    logger.info({
      msg: 'Filtered by similarity',
      threshold: CONFIG.search.similarityThreshold,
      relevantCount: relevantChunks.length,
      requestId,
    });

    // 6. Check if we have relevant chunks
    if (relevantChunks.length === 0) {
      return successResponse({
        answer:
          'I could not find any relevant documents to answer your question. Please try rephrasing your question or ensure that relevant documents have been uploaded and processed.',
        sources: [],
        confidence: 0,
      });
    }

    // 7. Construct prompt and generate answer
    const prompt = constructPrompt(question, relevantChunks);
    const answer = await generateAnswer(prompt);

    logger.info({
      msg: 'Answer generated',
      answerLength: answer.length,
      sourcesUsed: relevantChunks.length,
      requestId,
    });

    // 8. Format response
    const confidence = calculateConfidence(relevantChunks);
    const sources = formatSources(relevantChunks);

    const response: QueryResponse = {
      answer,
      sources,
      confidence,
    };

    logger.info({
      msg: 'Query completed successfully',
      confidence,
      sourcesCount: sources.length,
      requestId,
    });

    return successResponse(response);
  } catch (error) {
    logger.error({
      msg: 'Query handler error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      requestId,
    });

    // Check for specific error types
    if (error instanceof Error) {
      if (error.message.includes('Bedrock') || error.message.includes('Claude')) {
        return errorResponse(
          503,
          'The AI service is temporarily unavailable. Please try again later.',
        );
      }

      if (error.message.includes('embedding') || error.message.includes('search')) {
        return errorResponse(500, 'Failed to search documents. Please try again.');
      }
    }

    // Generic error response
    return errorResponse(
      500,
      'An error occurred processing your question. Please try again.',
    );
  }
}
