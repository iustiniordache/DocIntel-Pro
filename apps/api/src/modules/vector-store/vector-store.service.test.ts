import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VectorStoreService, Chunk, SearchResult } from './vector-store.service';
import { Test, TestingModule } from '@nestjs/testing';

// Mock OpenSearch client
const mockClient = {
  indices: {
    exists: vi.fn(),
    create: vi.fn(),
  },
  bulk: vi.fn(),
  search: vi.fn(),
  deleteByQuery: vi.fn(),
  close: vi.fn(),
};

// Mock the OpenSearch Client constructor
vi.mock('@opensearch-project/opensearch', () => ({
  Client: vi.fn(() => mockClient),
  Connection: class MockConnection {
    buildRequestObject(params: unknown) {
      return params;
    }
  },
}));

describe('VectorStoreService', () => {
  let service: VectorStoreService;

  // Set environment variables before tests
  process.env['OPENSEARCH_DOMAIN'] = 'https://test-domain.us-east-1.es.amazonaws.com';
  process.env['OPENSEARCH_INDEX_NAME'] = 'test-vectors';
  process.env['NODE_ENV'] = 'test';

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [VectorStoreService],
    }).compile();

    service = module.get<VectorStoreService>(VectorStoreService);
  });

  describe('Index Management', () => {
    it('should create index if it does not exist', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: false });
      mockClient.indices.create.mockResolvedValue({ body: { acknowledged: true } });

      await service.initializeIndex();

      expect(mockClient.indices.exists).toHaveBeenCalledWith({
        index: 'test-vectors',
      });

      expect(mockClient.indices.create).toHaveBeenCalledWith({
        index: 'test-vectors',
        body: expect.objectContaining({
          settings: expect.objectContaining({
            number_of_shards: 3,
            number_of_replicas: 1,
            'index.knn': true,
          }),
          mappings: expect.objectContaining({
            properties: expect.objectContaining({
              chunkId: { type: 'keyword' },
              documentId: { type: 'keyword' },
              content: expect.objectContaining({
                type: 'text',
              }),
              embedding: expect.objectContaining({
                type: 'knn_vector',
                dimension: 1024,
                method: expect.objectContaining({
                  name: 'hnsw',
                  space_type: 'cosinesimil',
                }),
              }),
            }),
          }),
        }),
      });
    });

    it('should skip creation if index already exists', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: true });

      await service.initializeIndex();

      expect(mockClient.indices.exists).toHaveBeenCalledWith({
        index: 'test-vectors',
      });
      expect(mockClient.indices.create).not.toHaveBeenCalled();
    });

    it('should only initialize once', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: true });

      await service.initializeIndex();
      await service.initializeIndex();
      await service.initializeIndex();

      expect(mockClient.indices.exists).toHaveBeenCalledTimes(1);
    });

    it('should handle index creation errors', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: false });
      mockClient.indices.create.mockRejectedValue(new Error('Index creation failed'));

      await expect(service.initializeIndex()).rejects.toThrow('Index creation failed');
    });
  });

  describe('Bulk Indexing', () => {
    const createChunk = (id: string, docId: string): Chunk => ({
      chunkId: id,
      documentId: docId,
      content: `Test content for chunk ${id}`,
      embedding: new Array(1024).fill(0.1),
      metadata: {
        page: 1,
        position: 0,
        source: 'test.pdf',
      },
    });

    beforeEach(() => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
    });

    it('should successfully index chunks', async () => {
      const chunks = [
        createChunk('chunk-1', 'doc-1'),
        createChunk('chunk-2', 'doc-1'),
        createChunk('chunk-3', 'doc-2'),
      ];

      mockClient.bulk.mockResolvedValue({
        body: {
          errors: false,
          items: [
            { index: { _id: 'chunk-1', result: 'created' } },
            { index: { _id: 'chunk-2', result: 'created' } },
            { index: { _id: 'chunk-3', result: 'created' } },
          ],
        },
      });

      const result = await service.bulkIndex(chunks);

      expect(result).toEqual({
        indexed: 3,
        skipped: 0,
        failed: 0,
        errors: [],
      });

      expect(mockClient.bulk).toHaveBeenCalledWith({
        body: expect.arrayContaining([
          expect.objectContaining({
            index: {
              _index: 'test-vectors',
              _id: 'chunk-1',
            },
          }),
          expect.objectContaining({
            chunkId: 'chunk-1',
            documentId: 'doc-1',
            content: 'Test content for chunk chunk-1',
            embedding: expect.any(Array),
            metadata: expect.any(Object),
            timestamp: expect.any(String),
          }),
        ]),
        refresh: false,
      });
    });

    it('should return empty result for empty chunks array', async () => {
      const result = await service.bulkIndex([]);

      expect(result).toEqual({
        indexed: 0,
        skipped: 0,
        failed: 0,
        errors: [],
      });

      expect(mockClient.bulk).not.toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      const chunks = [
        createChunk('chunk-1', 'doc-1'),
        createChunk('chunk-2', 'doc-1'),
        createChunk('chunk-3', 'doc-2'),
      ];

      mockClient.bulk.mockResolvedValue({
        body: {
          errors: true,
          items: [
            { index: { _id: 'chunk-1', result: 'created' } },
            {
              index: {
                _id: 'chunk-2',
                error: {
                  type: 'version_conflict_engine_exception',
                  reason: 'Document already exists',
                },
              },
            },
            { index: { _id: 'chunk-3', result: 'created' } },
          ],
        },
      });

      const result = await service.bulkIndex(chunks);

      expect(result.indexed).toBe(2);
      expect(result.failed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        chunkId: 'chunk-2',
        error: 'Document already exists',
      });
    });

    it('should handle bulk operation failure', async () => {
      const chunks = [createChunk('chunk-1', 'doc-1')];

      mockClient.bulk.mockRejectedValue(new Error('Bulk operation failed'));

      const result = await service.bulkIndex(chunks);

      expect(result.failed).toBe(1);
      expect(result.indexed).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBe('Bulk operation failed');
    });

    it('should skip duplicates based on operation result', async () => {
      const chunks = [createChunk('chunk-1', 'doc-1'), createChunk('chunk-2', 'doc-1')];

      mockClient.bulk.mockResolvedValue({
        body: {
          errors: false,
          items: [
            { index: { _id: 'chunk-1', result: 'created' } },
            { index: { _id: 'chunk-2', result: 'noop' } }, // Already exists
          ],
        },
      });

      const result = await service.bulkIndex(chunks);

      expect(result.indexed).toBe(1);
      expect(result.skipped).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  describe('Delete Operations', () => {
    beforeEach(() => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
    });

    it('should delete all chunks for a document', async () => {
      mockClient.deleteByQuery.mockResolvedValue({
        body: {
          deleted: 5,
        },
      });

      await service.deleteByDocumentId('doc-1');

      expect(mockClient.deleteByQuery).toHaveBeenCalledWith({
        index: 'test-vectors',
        body: {
          query: {
            term: {
              documentId: 'doc-1',
            },
          },
        },
      });
    });

    it('should handle delete errors', async () => {
      mockClient.deleteByQuery.mockRejectedValue(new Error('Delete failed'));

      await expect(service.deleteByDocumentId('doc-1')).rejects.toThrow('Delete failed');
    });
  });

  describe('Vector Search', () => {
    const mockQueryVector = new Array(1024).fill(0.5);

    beforeEach(() => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
    });

    it('should perform vector search successfully', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'chunk-1',
                _score: 0.95,
                _source: {
                  chunkId: 'chunk-1',
                  documentId: 'doc-1',
                  content: 'Test content 1',
                  metadata: { page: 1 },
                },
              },
              {
                _id: 'chunk-2',
                _score: 0.87,
                _source: {
                  chunkId: 'chunk-2',
                  documentId: 'doc-1',
                  content: 'Test content 2',
                  metadata: { page: 2 },
                },
              },
            ],
          },
        },
      });

      const results = await service.vectorSearch(mockQueryVector, 5);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        content: 'Test content 1',
        similarity_score: 0.95,
        metadata: { page: 1 },
      });

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-vectors',
        body: {
          size: 5,
          query: {
            knn: {
              embedding: {
                vector: mockQueryVector,
                k: 5,
              },
            },
          },
          _source: ['chunkId', 'documentId', 'content', 'metadata'],
        },
      });
    });

    it('should return empty results on search error', async () => {
      mockClient.search.mockRejectedValue(new Error('Search failed'));

      const results = await service.vectorSearch(mockQueryVector, 5);

      expect(results).toEqual([]);
    });

    it('should handle empty search results', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            hits: [],
          },
        },
      });

      const results = await service.vectorSearch(mockQueryVector, 5);

      expect(results).toEqual([]);
    });
  });

  describe('Hybrid Search', () => {
    const mockQueryVector = new Array(1024).fill(0.5);
    const queryText = 'test query';

    beforeEach(async () => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
      await service.initializeIndex();
    });

    it('should perform hybrid search with vector and keyword', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'chunk-1',
                _score: 1.25,
                _source: {
                  chunkId: 'chunk-1',
                  documentId: 'doc-1',
                  content: 'Test query content',
                  metadata: { page: 1 },
                },
              },
              {
                _id: 'chunk-2',
                _score: 0.98,
                _source: {
                  chunkId: 'chunk-2',
                  documentId: 'doc-2',
                  content: 'Related content',
                  metadata: { page: 3 },
                },
              },
            ],
          },
        },
      });

      const results = await service.hybridSearch(mockQueryVector, queryText, 10);

      expect(results).toHaveLength(2);
      expect(results[0].similarity_score).toBe(1.25);

      expect(mockClient.search).toHaveBeenCalledWith({
        index: 'test-vectors',
        body: {
          size: 10,
          query: {
            knn: {
              embedding: {
                vector: mockQueryVector,
                k: 10,
              },
            },
          },
          _source: ['chunkId', 'documentId', 'content', 'metadata'],
        },
      });
    });

    it('should use default k=5 if not specified', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: { hits: [] },
        },
      });

      await service.hybridSearch(mockQueryVector, queryText);

      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            size: 5,
          }),
        }),
      );
    });

    it('should return empty results on hybrid search error', async () => {
      mockClient.search.mockRejectedValue(new Error('Hybrid search failed'));

      const results = await service.hybridSearch(mockQueryVector, queryText, 5);

      expect(results).toEqual([]);
    });

    it('should handle missing metadata in results', async () => {
      mockClient.search.mockResolvedValue({
        body: {
          hits: {
            hits: [
              {
                _id: 'chunk-1',
                _score: 0.95,
                _source: {
                  chunkId: 'chunk-1',
                  documentId: 'doc-1',
                  content: 'Test content',
                  // metadata missing
                },
              },
            ],
          },
        },
      });

      const results = await service.hybridSearch(mockQueryVector, queryText, 5);

      expect(results).toHaveLength(1);
      expect(results[0].metadata).toEqual({});
    });
  });

  describe('Connection Management', () => {
    it('should close client connection', async () => {
      mockClient.close.mockResolvedValue(undefined);
      mockClient.indices.exists.mockResolvedValue({ body: true });

      // Initialize to create client
      await service.initializeIndex();

      await service.close();

      expect(mockClient.close).toHaveBeenCalled();
    });

    it('should handle close errors gracefully', async () => {
      mockClient.close.mockRejectedValue(new Error('Close failed'));

      // Should not throw
      await expect(service.close()).resolves.toBeUndefined();
    });

    it('should allow re-initialization after close', async () => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
      mockClient.close.mockResolvedValue(undefined);

      await service.initializeIndex();
      await service.close();

      // Reset the exists mock for second initialization
      mockClient.indices.exists.mockResolvedValue({ body: true });
      await service.initializeIndex();

      expect(mockClient.indices.exists).toHaveBeenCalledTimes(2);
    });
  });

  describe('Retry and Timeout Behavior', () => {
    beforeEach(() => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
    });

    it('should create client with correct timeout configuration', async () => {
      const { Client } = await import('@opensearch-project/opensearch');

      // Trigger client creation
      await service.initializeIndex();

      expect(Client).toHaveBeenCalledWith(
        expect.objectContaining({
          node: 'https://test-domain.us-east-1.es.amazonaws.com',
          requestTimeout: 30000,
          ssl: {
            rejectUnauthorized: false, // test environment
          },
        }),
      );
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      mockClient.indices.exists.mockResolvedValue({ body: true });
    });

    it('should handle chunks with minimal metadata', async () => {
      const chunk: Chunk = {
        chunkId: 'minimal-chunk',
        documentId: 'doc-1',
        content: 'Minimal content',
        embedding: new Array(1024).fill(0),
        metadata: {},
      };

      mockClient.bulk.mockResolvedValue({
        body: {
          errors: false,
          items: [{ index: { result: 'created' } }],
        },
      });

      const result = await service.bulkIndex([chunk]);

      expect(result.indexed).toBe(1);
    });

    it('should handle large embedding vectors', async () => {
      const largeVector = new Array(1024).fill(0).map((_, i) => Math.random());

      mockClient.search.mockResolvedValue({
        body: {
          hits: { hits: [] },
        },
      });

      const results = await service.vectorSearch(largeVector, 10);

      expect(results).toEqual([]);
      expect(mockClient.search).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            query: expect.objectContaining({
              knn: expect.objectContaining({
                embedding: expect.objectContaining({
                  vector: largeVector,
                }),
              }),
            }),
          }),
        }),
      );
    });
  });
});
