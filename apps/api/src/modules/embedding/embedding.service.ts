import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';

/**
 * Configuration for the embedding service
 */
interface EmbeddingConfig {
  modelId: string;
  region: string;
  maxRetries: number;
  batchSize: number;
  costPerMillionTokens: number;
}

/**
 * Embedding request payload for Bedrock Titan models
 */
interface TitanEmbeddingRequest {
  inputText: string;
  dimensions?: number;
  normalize?: boolean;
}

/**
 * Embedding response from Bedrock Titan models
 */
interface TitanEmbeddingResponse {
  embedding: number[];
  inputTextTokenCount: number;
}

/**
 * Batch embedding result with metrics
 */
export interface EmbeddingBatchResult {
  embeddings: number[][];
  totalTokens: number;
  estimatedCost: number;
  successCount: number;
  failureCount: number;
}

/**
 * Service for generating text embeddings using AWS Bedrock
 * Supports Amazon Titan Embeddings V2 model
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: BedrockRuntimeClient;
  private readonly config: EmbeddingConfig;

  constructor() {
    this.config = {
      modelId:
        process.env['BEDROCK_EMBEDDING_MODEL_ID'] || 'amazon.titan-embed-text-v2:0',
      region: process.env['AWS_REGION'] || 'us-east-1',
      maxRetries: 3,
      batchSize: 16,
      costPerMillionTokens: 0.02, // $0.02 per 1M tokens for Titan V2
    };

    this.client = new BedrockRuntimeClient({
      region: this.config.region,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: 30000,
        socketTimeout: 30000,
      }),
    });

    this.logger.log({
      msg: 'EmbeddingService initialized',
      modelId: this.config.modelId,
      region: this.config.region,
      batchSize: this.config.batchSize,
    });
  }

  /**
   * Generate embedding for a single text
   * @param text Input text to embed
   * @returns 1024-dimensional embedding vector
   */
  async embedText(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Input text cannot be empty');
    }

    const startTime = Date.now();
    const estimatedTokens = this.estimateTokens(text);

    this.logger.debug({
      msg: 'Generating embedding',
      textLength: text.length,
      estimatedTokens,
    });

    try {
      const result = await this.invokeWithRetry(text, 0);
      const latency = Date.now() - startTime;

      this.logger.log({
        msg: 'Embedding generated',
        actualTokens: result.inputTextTokenCount,
        estimatedTokens,
        dimensions: result.embedding.length,
        latencyMs: latency,
        estimatedCost: this.calculateCost(result.inputTextTokenCount),
      });

      return result.embedding;
    } catch (error) {
      this.logger.error({
        msg: 'Failed to generate embedding',
        error: error instanceof Error ? error.message : String(error),
        textLength: text.length,
      });
      throw error;
    }
  }

  /**
   * Generate embeddings for multiple texts in batches
   * @param texts Array of texts to embed
   * @returns Batch result with embeddings and metrics
   */
  async embedBatch(texts: string[]): Promise<EmbeddingBatchResult> {
    const startTime = Date.now();
    const validTexts = texts.filter((t) => t && t.trim().length > 0);

    if (validTexts.length === 0) {
      this.logger.warn('No valid texts to embed in batch');
      return {
        embeddings: [],
        totalTokens: 0,
        estimatedCost: 0,
        successCount: 0,
        failureCount: texts.length,
      };
    }

    this.logger.log({
      msg: 'Starting batch embedding',
      totalTexts: texts.length,
      validTexts: validTexts.length,
      skippedTexts: texts.length - validTexts.length,
    });

    const embeddings: number[][] = [];
    let totalTokens = 0;
    let successCount = 0;
    let failureCount = 0;

    // Process in batches
    for (let i = 0; i < validTexts.length; i += this.config.batchSize) {
      const batch = validTexts.slice(i, i + this.config.batchSize);
      const batchNumber = Math.floor(i / this.config.batchSize) + 1;
      const totalBatches = Math.ceil(validTexts.length / this.config.batchSize);

      this.logger.debug({
        msg: 'Processing batch',
        batchNumber,
        totalBatches,
        batchSize: batch.length,
      });

      // Process batch items in parallel
      const batchResults = await Promise.allSettled(
        batch.map(async (text) => {
          try {
            const result = await this.invokeWithRetry(text, 0);
            return {
              embedding: result.embedding,
              tokens: result.inputTextTokenCount,
            };
          } catch (error) {
            this.logger.warn({
              msg: 'Failed to embed text in batch',
              error: error instanceof Error ? error.message : String(error),
              textLength: text.length,
            });
            throw error;
          }
        }),
      );

      // Collect results
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          embeddings.push(result.value.embedding);
          totalTokens += result.value.tokens;
          successCount++;
        } else {
          failureCount++;
          // Add empty embedding as placeholder to maintain array alignment
          embeddings.push([]);
        }
      }
    }

    const totalLatency = Date.now() - startTime;
    const estimatedCost = this.calculateCost(totalTokens);

    this.logger.log({
      msg: 'Batch embedding completed',
      totalTexts: texts.length,
      successCount,
      failureCount,
      totalTokens,
      estimatedCost,
      latencyMs: totalLatency,
      avgLatencyPerText: Math.round(totalLatency / texts.length),
    });

    return {
      embeddings,
      totalTokens,
      estimatedCost,
      successCount,
      failureCount,
    };
  }

  /**
   * Invoke Bedrock model with exponential backoff retry
   */
  private async invokeWithRetry(
    text: string,
    attempt: number,
  ): Promise<TitanEmbeddingResponse> {
    try {
      const requestBody: TitanEmbeddingRequest = {
        inputText: text,
        dimensions: 1024,
        normalize: true,
      };

      const input: InvokeModelCommandInput = {
        modelId: this.config.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      };

      const command = new InvokeModelCommand(input);
      const response = await this.client.send(command);

      if (!response.body) {
        throw new Error('Empty response body from Bedrock');
      }

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body),
      ) as TitanEmbeddingResponse;

      return responseBody;
    } catch (error) {
      const isTransient = this.isTransientError(error);

      if (isTransient && attempt < this.config.maxRetries) {
        const delay = this.calculateBackoffDelay(attempt);

        this.logger.warn({
          msg: 'Retrying after transient error',
          attempt: attempt + 1,
          maxRetries: this.config.maxRetries,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error),
        });

        await this.sleep(delay);
        return this.invokeWithRetry(text, attempt + 1);
      }

      // Hard error or max retries exceeded
      this.logger.error({
        msg: 'Failed to invoke Bedrock model',
        attempt: attempt + 1,
        isTransient,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Determine if error is transient and should be retried
   */
  private isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const errorName = error.name;
    const errorMessage = error.message.toLowerCase();

    // AWS SDK transient errors
    const transientErrors = [
      'ThrottlingException',
      'ServiceUnavailableException',
      'InternalServerException',
      'RequestTimeout',
      'TimeoutError',
    ];

    if (transientErrors.some((e) => errorName.includes(e))) {
      return true;
    }

    // Check message for transient indicators
    const transientIndicators = [
      'throttl',
      'rate limit',
      'timeout',
      'temporarily unavailable',
      'service unavailable',
      'connection',
      'econnreset',
      'etimedout',
    ];

    return transientIndicators.some((indicator) => errorMessage.includes(indicator));
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    // Add jitter: ±20%
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  /**
   * Estimate token count from text length
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Calculate cost based on token count
   */
  private calculateCost(tokens: number): number {
    return (tokens / 1_000_000) * this.config.costPerMillionTokens;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<EmbeddingConfig> {
    return { ...this.config };
  }
}
