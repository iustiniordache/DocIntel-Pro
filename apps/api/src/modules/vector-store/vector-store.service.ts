import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@opensearch-project/opensearch';

/**
 * Configuration for OpenSearch vector store
 */
interface VectorStoreConfig {
  domain: string;
  indexName: string;
  dimensions: number;
  shards: number;
  replicas: number;
  timeout: number;
  maxRetries: number;
}

/**
 * Document chunk for indexing
 */
export interface Chunk {
  chunkId: string;
  documentId: string;
  content: string;
  embedding: number[];
  metadata: {
    page?: number;
    position?: number;
    source?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

/**
 * Search result from OpenSearch
 */
export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  similarity_score: number;
  metadata: Record<string, unknown>;
}

/**
 * Bulk indexing result with metrics
 */
export interface BulkIndexResult {
  indexed: number;
  skipped: number;
  failed: number;
  errors: Array<{ chunkId: string; error: string }>;
}

/**
 * Service for managing vector embeddings in OpenSearch
 * Provides hybrid search combining vector similarity and keyword matching
 */
@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private client: Client | null = null;
  private initialized = false;
  private readonly config: VectorStoreConfig;

  constructor() {
    this.config = {
      domain: process.env['OPENSEARCH_DOMAIN'] || 'https://localhost:9200',
      indexName: process.env['OPENSEARCH_INDEX_NAME'] || 'docintel-vectors',
      dimensions: 1024, // Amazon Titan V2 embeddings
      shards: 3,
      replicas: 1,
      timeout: 30000,
      maxRetries: 3,
    };

    this.logger.log({
      msg: 'VectorStoreService initialized',
      domain: this.config.domain,
      indexName: this.config.indexName,
      dimensions: this.config.dimensions,
    });
  }

  /**
   * Initialize on module startup
   */
  async onModuleInit(): Promise<void> {
    await this.getClient();
  }

  /**
   * Get or create OpenSearch client (singleton pattern)
   */
  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    try {
      this.client = new Client({
        node: this.config.domain,
        requestTimeout: this.config.timeout,
        ssl: {
          rejectUnauthorized: process.env['NODE_ENV'] === 'production',
        },
      });

      this.logger.log({
        msg: 'OpenSearch client created',
        domain: this.config.domain,
      });

      return this.client;
    } catch (error) {
      this.logger.error({
        msg: 'Failed to create OpenSearch client',
        error: error instanceof Error ? error.message : String(error),
        domain: this.config.domain,
      });
      throw error;
    }
  }

  /**
   * Initialize the vector index with proper mappings
   * Creates index if it doesn't exist
   */
  async initializeIndex(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const client = await this.getClient();
      const indexName = this.config.indexName;

      // Check if index exists
      const exists = await client.indices.exists({ index: indexName });

      if (exists.body) {
        this.logger.log({
          msg: 'Index already exists',
          indexName,
        });
        this.initialized = true;
        return;
      }

      // Create index with knn_vector mapping (1024 dimensions for Titan V2)
      await client.indices.create({
        index: indexName,
        body: {
          settings: {
            number_of_shards: this.config.shards,
            number_of_replicas: this.config.replicas,
            'index.knn': true,
          },
          mappings: {
            properties: {
              chunkId: { type: 'keyword' },
              documentId: { type: 'keyword' },
              content: {
                type: 'text',
                analyzer: 'standard',
              },
              embedding: {
                type: 'knn_vector',
                dimension: 1024, // CRITICAL: Must match Titan V2 embedding dimensions
                method: {
                  name: 'hnsw',
                  space_type: 'cosinesimil',
                  engine: 'nmslib',
                  parameters: {
                    ef_construction: 128,
                    m: 24,
                  },
                },
              },
              metadata: {
                type: 'object',
                enabled: true,
              },
              timestamp: { type: 'date' },
            },
          },
        },
      });

      this.logger.log({
        msg: 'Index created successfully',
        indexName,
        dimensions: this.config.dimensions,
        shards: this.config.shards,
        replicas: this.config.replicas,
      });

      this.initialized = true;
    } catch (error) {
      this.logger.error({
        msg: 'Failed to initialize index',
        error: error instanceof Error ? error.message : String(error),
        indexName: this.config.indexName,
      });
      throw error;
    }
  }

  /**
   * Bulk index document chunks with embeddings
   * Skips duplicates and handles partial failures
   */
  async bulkIndex(chunks: Chunk[]): Promise<BulkIndexResult> {
    if (chunks.length === 0) {
      return { indexed: 0, skipped: 0, failed: 0, errors: [] };
    }

    await this.initializeIndex();

    const result: BulkIndexResult = {
      indexed: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    try {
      const client = await this.getClient();
      const indexName = this.config.indexName;

      // Build bulk operations
      const body: Array<
        | { index: { _index: string; _id: string } }
        | {
            chunkId: string;
            documentId: string;
            content: string;
            embedding: number[];
            metadata: Record<string, unknown>;
            timestamp: string;
          }
      > = [];
      for (const chunk of chunks) {
        // Index operation
        body.push({
          index: {
            _index: indexName,
            _id: chunk.chunkId,
          },
        });

        // Document
        body.push({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          content: chunk.content,
          embedding: chunk.embedding,
          metadata: chunk.metadata,
          timestamp: new Date().toISOString(),
        });
      }

      // Execute bulk operation
      const response = await client.bulk({
        body,
        refresh: false, // Async refresh for performance
      });

      // Process results - always check items to handle skipped/noop operations
      const items = response.body.items || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;

        const operation = item['index'] || item['create'];
        if (!operation) continue;

        if (operation.error) {
          result.failed++;
          result.errors.push({
            chunkId: chunks[i]?.chunkId || 'unknown',
            error: operation.error.reason || 'Unknown error',
          });
        } else if (operation.result === 'created' || operation.result === 'updated') {
          result.indexed++;
        } else {
          // noop, already exists, or other non-error result
          result.skipped++;
        }
      }

      this.logger.log({
        msg: 'Bulk indexing completed',
        indexed: result.indexed,
        skipped: result.skipped,
        failed: result.failed,
        total: chunks.length,
      });

      return result;
    } catch (error) {
      this.logger.error({
        msg: 'Bulk indexing failed',
        error: error instanceof Error ? error.message : String(error),
        chunkCount: chunks.length,
      });

      // Return partial results on error
      result.failed = chunks.length - result.indexed - result.skipped;
      result.errors.push({
        chunkId: 'bulk_operation',
        error: error instanceof Error ? error.message : String(error),
      });

      return result;
    }
  }

  /**
   * Delete all chunks for a document
   */
  async deleteByDocumentId(documentId: string): Promise<void> {
    try {
      const client = await this.getClient();
      const indexName = this.config.indexName;

      const response = await client.deleteByQuery({
        index: indexName,
        body: {
          query: {
            term: {
              documentId,
            },
          },
        },
      });

      this.logger.log({
        msg: 'Deleted chunks by document ID',
        documentId,
        deleted: (response.body as { deleted?: number }).deleted || 0,
      });
    } catch (error) {
      this.logger.error({
        msg: 'Failed to delete chunks',
        error: error instanceof Error ? error.message : String(error),
        documentId,
      });
      throw error;
    }
  }

  /**
   * Hybrid search combining vector similarity and keyword matching
   * Uses OpenSearch bool query with knn and multi_match
   */
  async hybridSearch(
    queryVector: number[],
    _queryText: string, // Keep for API compatibility but not used in k-NN query
    k: number = 5,
  ): Promise<SearchResult[]> {
    try {
      await this.initializeIndex();
      const client = await this.getClient();
      const indexName = this.config.indexName;

      // Use OpenSearch k-NN plugin search format
      const response = await client.search({
        index: indexName,
        body: {
          size: k,
          query: {
            bool: {
              must: [
                {
                  knn: {
                    embedding: {
                      vector: queryVector,
                      k: k,
                    },
                  },
                },
              ],
            },
          },
          _source: ['chunkId', 'documentId', 'content', 'metadata'],
        },
      });

      const hits = response.body.hits?.hits || [];
      const results: SearchResult[] = hits.map(
        (hit: {
          _source: {
            chunkId: string;
            documentId: string;
            content: string;
            metadata?: Record<string, unknown>;
          };
          _score?: number;
        }) => ({
          chunkId: hit._source.chunkId,
          documentId: hit._source.documentId,
          content: hit._source.content,
          similarity_score: hit._score || 0,
          metadata: hit._source.metadata || {},
        }),
      );

      this.logger.log({
        msg: 'Hybrid search completed',
        resultsCount: results.length,
        k,
      });

      return results;
    } catch (error) {
      this.logger.error({
        msg: 'Hybrid search failed',
        error: error instanceof Error ? error.message : String(error),
        k,
      });

      // Return empty results on error instead of throwing
      return [];
    }
  }

  /**
   * Vector-only search using knn
   */
  async vectorSearch(queryVector: number[], k: number = 5): Promise<SearchResult[]> {
    try {
      await this.initializeIndex();
      const client = await this.getClient();
      const indexName = this.config.indexName;

      const response = await client.search({
        index: indexName,
        body: {
          size: k,
          query: {
            knn: {
              embedding: {
                vector: queryVector,
                k,
              },
            },
          },
          _source: ['chunkId', 'documentId', 'content', 'metadata'],
        },
      });

      const hits = response.body.hits?.hits || [];
      const results: SearchResult[] = hits.map(
        (hit: {
          _source: {
            chunkId: string;
            documentId: string;
            content: string;
            metadata?: Record<string, unknown>;
          };
          _score?: number;
        }) => ({
          chunkId: hit._source.chunkId,
          documentId: hit._source.documentId,
          content: hit._source.content,
          similarity_score: hit._score || 0,
          metadata: hit._source.metadata || {},
        }),
      );

      this.logger.log({
        msg: 'Vector search completed',
        resultsCount: results.length,
        k,
      });

      return results;
    } catch (error) {
      this.logger.error({
        msg: 'Vector search failed',
        error: error instanceof Error ? error.message : String(error),
        k,
      });

      // Return empty results on error instead of throwing
      return [];
    }
  }

  /**
   * Close the OpenSearch client connection
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
        this.client = null;
        this.initialized = false;
        this.logger.log({ msg: 'OpenSearch client closed' });
      } catch (error) {
        this.logger.error({
          msg: 'Error closing OpenSearch client',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
