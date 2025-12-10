import { describe, it, expect, beforeEach, vi } from 'vitest';
import { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handler } from './query.handler';
import * as embeddingModule from '../modules/embedding/embedding.service';
import * as vectorStoreModule from '../modules/vector-store/vector-store.service';

// Mock AWS SDK
const mockBedrockSend = vi.fn();
vi.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: vi.fn(() => ({
    send: mockBedrockSend,
  })),
  InvokeModelCommand: vi.fn((input) => input),
}));

// Mock NestJS
const mockEmbeddingService = {
  embedText: vi.fn(),
};

const mockVectorStoreService = {
  hybridSearch: vi.fn(),
};

vi.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: vi.fn((module) => {
      if (module.name === 'EmbeddingModule') {
        return Promise.resolve({
          get: vi.fn(() => mockEmbeddingService),
        });
      }
      if (module.name === 'VectorStoreModule') {
        return Promise.resolve({
          get: vi.fn(() => mockVectorStoreService),
        });
      }
      return Promise.resolve({
        get: vi.fn(),
      });
    }),
  },
}));

describe('Query Handler', () => {
  let mockContext: Context;

  // Set environment variables
  process.env['AWS_REGION'] = 'us-east-1';
  process.env['LOG_LEVEL'] = 'error'; // Suppress logs in tests

  beforeEach(() => {
    vi.clearAllMocks();

    mockContext = {
      requestId: 'test-request-id',
      functionName: 'query-handler',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:query',
      memoryLimitInMB: '512',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/query',
      logStreamName: '2024/01/01/[$LATEST]test',
      getRemainingTimeInMillis: () => 30000,
      callbackWaitsForEmptyEventLoop: true,
      done: vi.fn(),
      fail: vi.fn(),
      succeed: vi.fn(),
    };
  });

  // Helper to create API Gateway event
  function createEvent(body: any): APIGatewayProxyEventV2 {
    return {
      version: '2.0',
      routeKey: 'POST /query',
      rawPath: '/query',
      rawQueryString: '',
      headers: {
        'content-type': 'application/json',
      },
      requestContext: {
        accountId: '123456789012',
        apiId: 'test-api',
        domainName: 'test.execute-api.us-east-1.amazonaws.com',
        domainPrefix: 'test',
        http: {
          method: 'POST',
          path: '/query',
          protocol: 'HTTP/1.1',
          sourceIp: '1.2.3.4',
          userAgent: 'test-agent',
        },
        requestId: 'test-request-id',
        routeKey: 'POST /query',
        stage: '$default',
        time: '01/Jan/2024:00:00:00 +0000',
        timeEpoch: 1704067200000,
      },
      body: JSON.stringify(body),
      isBase64Encoded: false,
    };
  }

  // Helper to create mock search results
  function createSearchResult(
    chunkId: string,
    similarity: number,
    content: string,
    page?: number,
  ) {
    return {
      chunkId,
      documentId: 'doc-123',
      content,
      similarity_score: similarity,
      metadata: page ? { page } : {},
    };
  }

  describe('Request Validation', () => {
    it('should return 400 if body is missing', async () => {
      const event = createEvent(null);
      event.body = '';

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Request body is required');
    });

    it('should return 400 if question is missing', async () => {
      const event = createEvent({ documentId: 'doc-123' });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Question is required');
    });

    it('should return 400 if question is empty', async () => {
      const event = createEvent({ question: '   ' });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('cannot be empty');
    });

    it('should return 400 if question exceeds max length', async () => {
      const longQuestion = 'a'.repeat(501);
      const event = createEvent({ question: longQuestion });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('exceeds maximum length');
    });

    it('should accept valid question', async () => {
      const event = createEvent({ question: 'What is the main topic?' });

      // Mock successful flow
      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([]);

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
    });
  });

  describe('RAG Flow', () => {
    it('should successfully generate answer with relevant chunks', async () => {
      const question = 'What is artificial intelligence?';
      const event = createEvent({ question });

      // Mock embedding
      const mockEmbedding = new Array(1024).fill(0.5);
      mockEmbeddingService.embedText.mockResolvedValue(mockEmbedding);

      // Mock search results with high similarity
      const searchResults = [
        createSearchResult(
          'chunk-1',
          0.95,
          'Artificial intelligence (AI) is the simulation of human intelligence by machines.',
          1,
        ),
        createSearchResult(
          'chunk-2',
          0.88,
          'AI systems can learn from data and make decisions autonomously.',
          2,
        ),
        createSearchResult(
          'chunk-3',
          0.75,
          'Machine learning is a subset of artificial intelligence.',
          3,
        ),
      ];
      mockVectorStoreService.hybridSearch.mockResolvedValue(searchResults);

      // Mock Claude response
      const mockClaudeResponse = {
        id: 'msg-123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Artificial intelligence (AI) is the simulation of human intelligence by machines [S1]. These systems can learn from data and make autonomous decisions [S2].',
          },
        ],
        model: 'claude-3-haiku-20240307',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 150,
          output_tokens: 50,
        },
      };

      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.answer).toBeDefined();
      expect(body.answer.toLowerCase()).toContain('artificial intelligence');
      expect(body.sources).toHaveLength(3);
      expect(body.sources[0].id).toBe('S1');
      expect(body.sources[0].similarity).toBeGreaterThanOrEqual(0.75);
      expect(body.sources[0].pageNumber).toBe(1);
      expect(body.confidence).toBeGreaterThan(0.7);

      // Verify service calls
      expect(mockEmbeddingService.embedText).toHaveBeenCalledWith(question);
      expect(mockVectorStoreService.hybridSearch).toHaveBeenCalledWith(
        mockEmbedding,
        question,
        10,
      );
      expect(mockBedrockSend).toHaveBeenCalled();
    });

    it('should filter by documentId when provided', async () => {
      const question = 'Test question';
      const documentId = 'doc-specific';
      const event = createEvent({ question, documentId });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));

      // Return results for multiple documents
      const searchResults = [
        {
          ...createSearchResult('chunk-1', 0.9, 'Content 1'),
          documentId: 'doc-specific',
        },
        { ...createSearchResult('chunk-2', 0.85, 'Content 2'), documentId: 'doc-other' },
        {
          ...createSearchResult('chunk-3', 0.8, 'Content 3'),
          documentId: 'doc-specific',
        },
      ];
      mockVectorStoreService.hybridSearch.mockResolvedValue(searchResults);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Answer based on filtered chunks' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Should only have 2 sources from doc-specific
      expect(body.sources).toHaveLength(2);
      expect(body.sources.every((s: any) => s.id.startsWith('S'))).toBe(true);
    });

    it('should return message when no relevant chunks found', async () => {
      const question = 'Unrelated question';
      const event = createEvent({ question });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));

      // Return results with low similarity
      const searchResults = [
        createSearchResult('chunk-1', 0.3, 'Irrelevant content'),
        createSearchResult('chunk-2', 0.2, 'Another irrelevant content'),
      ];
      mockVectorStoreService.hybridSearch.mockResolvedValue(searchResults);

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.answer).toContain('could not find any relevant documents');
      expect(body.sources).toHaveLength(0);
      expect(body.confidence).toBe(0);

      // Claude should not be called
      expect(mockBedrockSend).not.toHaveBeenCalled();
    });

    it('should return message when no chunks match documentId filter', async () => {
      const question = 'Test question';
      const event = createEvent({ question, documentId: 'non-existent-doc' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));

      const searchResults = [
        createSearchResult('chunk-1', 0.9, 'Content from other doc'),
      ];
      mockVectorStoreService.hybridSearch.mockResolvedValue(searchResults);

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      expect(body.answer).toContain('could not find any relevant documents');
      expect(body.sources).toHaveLength(0);
    });
  });

  describe('Similarity Filtering', () => {
    it('should filter chunks below 0.5 similarity threshold', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));

      // Mix of high and low similarity results
      const searchResults = [
        createSearchResult('chunk-1', 0.95, 'Very relevant'),
        createSearchResult('chunk-2', 0.72, 'Somewhat relevant'),
        createSearchResult('chunk-3', 0.52, 'Somewhat relevant'),
        createSearchResult('chunk-4', 0.45, 'Less relevant'), // Below threshold
        createSearchResult('chunk-5', 0.3, 'Not relevant'), // Below threshold
      ];
      mockVectorStoreService.hybridSearch.mockResolvedValue(searchResults);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Answer' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Should only include chunks with similarity >= 0.5
      expect(body.sources).toHaveLength(3);
      expect(body.sources[0].similarity).toBeGreaterThanOrEqual(0.5);
      expect(body.sources[1].similarity).toBeGreaterThanOrEqual(0.5);
      expect(body.sources[2].similarity).toBeGreaterThanOrEqual(0.5);
    });
  });

  describe('Error Handling', () => {
    it('should handle embedding service errors', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockRejectedValue(
        new Error('Embedding service unavailable'),
      );

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('An error occurred');
    });

    it('should handle vector store errors', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockRejectedValue(
        new Error('Search service unavailable'),
      );

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('An error occurred');
    });

    it('should handle Bedrock Claude errors', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.9, 'Content'),
      ]);

      mockBedrockSend.mockRejectedValue(new Error('Bedrock service unavailable'));

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('AI service is temporarily unavailable');
    });

    it('should handle empty Bedrock response', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.9, 'Content'),
      ]);

      mockBedrockSend.mockResolvedValue({
        body: null,
      });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(503);
    });

    it('should handle malformed Bedrock response', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.9, 'Content'),
      ]);

      const malformedResponse = {
        content: [], // Empty content array
        usage: { input_tokens: 100, output_tokens: 0 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(malformedResponse)),
      });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(503);
    });

    it('should never throw unhandled errors', async () => {
      const event = createEvent({ question: 'Test question' });

      // Simulate unexpected error
      mockEmbeddingService.embedText.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      // Should not throw
      const response = await handler(event, mockContext);

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.body).toBeDefined();
    });
  });

  describe('Response Format', () => {
    it('should return proper response structure', async () => {
      const event = createEvent({ question: 'Test question' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.92, 'Test content', 5),
      ]);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Test answer' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);

      expect(response.statusCode).toBe(200);
      expect(response.headers).toHaveProperty('Content-Type', 'application/json');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin', '*');

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('answer');
      expect(body).toHaveProperty('sources');
      expect(body).toHaveProperty('confidence');

      expect(Array.isArray(body.sources)).toBe(true);
      expect(body.sources[0]).toHaveProperty('id');
      expect(body.sources[0]).toHaveProperty('similarity');
      expect(body.sources[0]).toHaveProperty('pageNumber');
      expect(body.sources[0]).toHaveProperty('content');
    });

    it('should round similarity scores to 2 decimal places', async () => {
      const event = createEvent({ question: 'Test' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.923456, 'Content'),
      ]);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Answer' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);
      const body = JSON.parse(response.body);

      expect(body.sources[0].similarity).toBe(0.92);
    });

    it('should truncate content preview to 200 characters', async () => {
      const event = createEvent({ question: 'Test' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));

      const longContent = 'a'.repeat(500);
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.9, longContent),
      ]);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Answer' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);
      const body = JSON.parse(response.body);

      expect(body.sources[0].content.length).toBe(200);
    });
  });

  describe('Confidence Calculation', () => {
    it('should use highest similarity as confidence', async () => {
      const event = createEvent({ question: 'Test' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 0.95, 'Content 1'),
        createSearchResult('chunk-2', 0.85, 'Content 2'),
        createSearchResult('chunk-3', 0.75, 'Content 3'),
      ]);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Answer' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);
      const body = JSON.parse(response.body);

      expect(body.confidence).toBe(0.95);
    });

    it('should cap confidence at 1.0', async () => {
      const event = createEvent({ question: 'Test' });

      mockEmbeddingService.embedText.mockResolvedValue(new Array(1024).fill(0.5));
      mockVectorStoreService.hybridSearch.mockResolvedValue([
        createSearchResult('chunk-1', 1.5, 'Content'), // Score > 1
      ]);

      const mockClaudeResponse = {
        content: [{ type: 'text', text: 'Answer' }],
        usage: { input_tokens: 100, output_tokens: 30 },
      };
      mockBedrockSend.mockResolvedValue({
        body: new TextEncoder().encode(JSON.stringify(mockClaudeResponse)),
      });

      const response = await handler(event, mockContext);
      const body = JSON.parse(response.body);

      expect(body.confidence).toBe(1.0);
    });
  });
});
