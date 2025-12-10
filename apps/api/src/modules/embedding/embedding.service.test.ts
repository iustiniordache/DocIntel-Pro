import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingService } from './embedding.service';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const bedrockMock = mockClient(BedrockRuntimeClient);

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(async () => {
    bedrockMock.reset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [EmbeddingService],
    }).compile();

    service = module.get<EmbeddingService>(EmbeddingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('embedText', () => {
    it('should generate embedding for valid text', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i / 1024);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 25,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      const result = await service.embedText('Test document content');

      expect(result).toEqual(mockEmbedding);
      expect(result.length).toBe(1024);
      expect(bedrockMock.calls().length).toBe(1);
      expect(bedrockMock.call(0).args[0].input.modelId).toBeDefined();
    });

    it('should throw error for empty text', async () => {
      await expect(service.embedText('')).rejects.toThrow('Input text cannot be empty');
      await expect(service.embedText('   ')).rejects.toThrow(
        'Input text cannot be empty',
      );
    });

    it('should retry on transient errors', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, () => 0.5);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 10,
          }),
        ),
      };

      // First two calls fail with throttling, third succeeds
      bedrockMock
        .on(InvokeModelCommand)
        .rejectsOnce({ name: 'ThrottlingException', message: 'Rate exceeded' })
        .rejectsOnce({ name: 'ThrottlingException', message: 'Rate exceeded' })
        .resolves(mockResponse);

      const result = await service.embedText('Test text');

      expect(result).toEqual(mockEmbedding);
      expect(bedrockMock.calls().length).toBe(3);
    }, 10000); // Increase timeout for retries

    it('should throw after max retries exceeded', async () => {
      bedrockMock
        .on(InvokeModelCommand)
        .rejects({ name: 'ThrottlingException', message: 'Rate exceeded' });

      await expect(service.embedText('Test text')).rejects.toThrow();
      expect(bedrockMock.calls().length).toBe(4); // Initial + 3 retries
    }, 15000);

    it('should not retry on hard errors', async () => {
      bedrockMock
        .on(InvokeModelCommand)
        .rejects({ name: 'ValidationException', message: 'Invalid input' });

      await expect(service.embedText('Test text')).rejects.toThrow();
      expect(bedrockMock.calls().length).toBe(1); // No retries
    });

    it('should handle empty response body', async () => {
      bedrockMock.on(InvokeModelCommand).resolves({ body: undefined });

      await expect(service.embedText('Test text')).rejects.toThrow(
        'Empty response body from Bedrock',
      );
    });

    it('should invoke with correct model parameters', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: Array.from({ length: 1024 }, () => 0.5),
            inputTextTokenCount: 10,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      await service.embedText('Test document');

      const calls = bedrockMock.calls();
      expect(calls.length).toBe(1);

      const command = calls[0].args[0] as any;
      const requestBody = JSON.parse(command.input.body);

      expect(requestBody).toEqual({
        inputText: 'Test document',
        dimensions: 1024,
        normalize: true,
      });
      expect(command.input.contentType).toBe('application/json');
      expect(command.input.accept).toBe('application/json');
    });
  });

  describe('embedBatch', () => {
    it('should process batch of texts successfully', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, (_, i) => i / 1024);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 20,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      const texts = ['Text 1', 'Text 2', 'Text 3'];
      const result = await service.embedBatch(texts);

      expect(result.embeddings.length).toBe(3);
      expect(result.embeddings[0]).toEqual(mockEmbedding);
      expect(result.successCount).toBe(3);
      expect(result.failureCount).toBe(0);
      expect(result.totalTokens).toBe(60); // 20 * 3
      expect(result.estimatedCost).toBeGreaterThan(0);
      expect(bedrockMock.calls().length).toBe(3);
    });

    it('should skip empty texts', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, () => 0.5);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 15,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      const texts = ['Valid text', '', '   ', 'Another valid text', ''];
      const result = await service.embedBatch(texts);

      expect(result.embeddings.length).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
      expect(bedrockMock.calls().length).toBe(2);
    });

    it('should continue on individual failures', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, () => 0.5);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 10,
          }),
        ),
      };

      bedrockMock
        .on(InvokeModelCommand)
        .resolvesOnce(mockResponse) // First succeeds
        .rejectsOnce({ name: 'ValidationException', message: 'Invalid' }) // Second fails
        .resolvesOnce(mockResponse); // Third succeeds

      const texts = ['Text 1', 'Text 2', 'Text 3'];
      const result = await service.embedBatch(texts);

      expect(result.embeddings.length).toBe(3);
      expect(result.embeddings[0]).toEqual(mockEmbedding);
      expect(result.embeddings[1]).toEqual([]); // Failed text gets empty array
      expect(result.embeddings[2]).toEqual(mockEmbedding);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(1);
      expect(result.totalTokens).toBe(20); // Only successful embeddings counted
    });

    it('should handle empty batch', async () => {
      const result = await service.embedBatch([]);

      expect(result.embeddings.length).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.estimatedCost).toBe(0);
      expect(bedrockMock.calls().length).toBe(0);
    });

    it('should handle batch with only empty texts', async () => {
      const result = await service.embedBatch(['', '   ', '']);

      expect(result.embeddings.length).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(3);
      expect(bedrockMock.calls().length).toBe(0);
    });

    it('should process large batches in chunks', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, () => 0.5);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 5,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      // Create 50 texts (default batch size is 16, so should process in 4 batches)
      const texts = Array.from({ length: 50 }, (_, i) => `Text ${i + 1}`);
      const result = await service.embedBatch(texts);

      expect(result.embeddings.length).toBe(50);
      expect(result.successCount).toBe(50);
      expect(result.failureCount).toBe(0);
      expect(result.totalTokens).toBe(250); // 5 * 50
      expect(bedrockMock.calls().length).toBe(50);
    });

    it('should calculate costs correctly', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: Array.from({ length: 1024 }, () => 0.5),
            inputTextTokenCount: 1000,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      const texts = ['Text 1', 'Text 2'];
      const result = await service.embedBatch(texts);

      expect(result.totalTokens).toBe(2000);
      // Cost = (2000 / 1_000_000) * 0.02 = 0.00004
      expect(result.estimatedCost).toBeCloseTo(0.00004, 6);
    });
  });

  describe('getConfig', () => {
    it('should return current configuration', () => {
      const config = service.getConfig();

      expect(config).toHaveProperty('modelId');
      expect(config).toHaveProperty('region');
      expect(config).toHaveProperty('maxRetries');
      expect(config).toHaveProperty('batchSize');
      expect(config).toHaveProperty('costPerMillionTokens');
      expect(config.maxRetries).toBe(3);
      expect(config.batchSize).toBe(16);
      expect(config.costPerMillionTokens).toBe(0.02);
    });

    it('should return immutable config', () => {
      const config = service.getConfig();
      const originalBatchSize = config.batchSize;

      // Attempt to modify
      (config as any).batchSize = 999;

      // Get fresh config
      const freshConfig = service.getConfig();
      expect(freshConfig.batchSize).toBe(originalBatchSize);
    });
  });

  describe('error handling', () => {
    it('should identify transient errors correctly', async () => {
      const transientErrors = [
        { name: 'ThrottlingException', message: 'Rate exceeded' },
        {
          name: 'ServiceUnavailableException',
          message: 'Service temporarily unavailable',
        },
        { name: 'InternalServerException', message: 'Internal error' },
        { name: 'RequestTimeout', message: 'Request timed out' },
        { name: 'Error', message: 'Connection timeout occurred' },
        { name: 'Error', message: 'ECONNRESET' },
      ];

      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: Array.from({ length: 1024 }, () => 0.5),
            inputTextTokenCount: 10,
          }),
        ),
      };

      for (const error of transientErrors) {
        bedrockMock.reset();
        bedrockMock.on(InvokeModelCommand).rejectsOnce(error).resolves(mockResponse);

        await service.embedText('Test text');

        // Should retry once
        expect(bedrockMock.calls().length).toBe(2);
      }
    }, 10000);

    it('should not retry non-transient errors', async () => {
      const hardErrors = [
        { name: 'ValidationException', message: 'Invalid input' },
        { name: 'AccessDeniedException', message: 'Access denied' },
        { name: 'ResourceNotFoundException', message: 'Model not found' },
      ];

      for (const error of hardErrors) {
        bedrockMock.reset();
        bedrockMock.on(InvokeModelCommand).rejects(error);

        await expect(service.embedText('Test text')).rejects.toThrow();

        // Should not retry
        expect(bedrockMock.calls().length).toBe(1);
      }
    });
  });

  describe('observability', () => {
    it('should track metrics for successful embeddings', async () => {
      const mockEmbedding = Array.from({ length: 1024 }, () => 0.5);
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: mockEmbedding,
            inputTextTokenCount: 100,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      const loggerSpy = vi.spyOn(service['logger'], 'log');

      await service.embedText('Test document with more content');

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Embedding generated successfully',
          actualTokens: 100,
          dimensions: 1024,
          latencyMs: expect.any(Number),
          estimatedCost: expect.any(Number),
        }),
      );
    });

    it('should log batch processing metrics', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            embedding: Array.from({ length: 1024 }, () => 0.5),
            inputTextTokenCount: 50,
          }),
        ),
      };

      bedrockMock.on(InvokeModelCommand).resolves(mockResponse);

      const loggerSpy = vi.spyOn(service['logger'], 'log');

      await service.embedBatch(['Text 1', 'Text 2', 'Text 3']);

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'Batch embedding completed',
          totalTexts: 3,
          successCount: 3,
          failureCount: 0,
          totalTokens: 150,
          estimatedCost: expect.any(Number),
          latencyMs: expect.any(Number),
          avgLatencyPerText: expect.any(Number),
        }),
      );
    });
  });
});
