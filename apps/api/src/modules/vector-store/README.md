# Vector Store Module

OpenSearch-based vector store service for document embeddings with hybrid search
capabilities.

## Features

- **Vector Indexing**: Store 1024-dimensional embeddings from Amazon Titan V2
- **Hybrid Search**: Combine vector similarity (kNN) with keyword matching (multi_match)
- **Bulk Operations**: Efficient bulk indexing with partial failure handling
- **Connection Management**: Singleton client pattern with automatic initialization
- **Error Resilience**: Graceful error handling, never throws on search failures

## Usage

### Import the Module

```typescript
import { VectorStoreModule } from './modules/vector-store';

@Module({
  imports: [VectorStoreModule],
})
export class AppModule {}
```

### Environment Variables

```bash
OPENSEARCH_DOMAIN=https://your-domain.us-east-1.es.amazonaws.com
OPENSEARCH_INDEX_NAME=docintel-vectors  # optional, defaults to 'docintel-vectors'
```

### Index Document Chunks

```typescript
import { VectorStoreService, Chunk } from './modules/vector-store';

const chunks: Chunk[] = [
  {
    chunkId: 'doc1-chunk1',
    documentId: 'doc1',
    content: 'This is the first chunk of text...',
    embedding: [0.1, 0.2, ...], // 1024-dimensional vector
    metadata: {
      page: 1,
      position: 0,
      source: 'document.pdf',
    },
  },
];

const result = await vectorStore.bulkIndex(chunks);
console.log(`Indexed: ${result.indexed}, Failed: ${result.failed}`);
```

### Hybrid Search

Combines vector similarity with keyword matching for best results:

```typescript
const queryVector = await embeddingService.embedText('What is the main topic?');
const results = await vectorStore.hybridSearch(
  queryVector,
  'main topic',
  k: 10
);

results.forEach(result => {
  console.log(`${result.documentId}: ${result.content}`);
  console.log(`Similarity: ${result.similarity_score}`);
});
```

### Vector-Only Search

Pure semantic search based on embedding similarity:

```typescript
const queryVector = await embeddingService.embedText('technical specifications');
const results = await vectorStore.vectorSearch(queryVector, k: 5);
```

### Delete Document Chunks

```typescript
await vectorStore.deleteByDocumentId('doc-123');
```

## Index Configuration

The service automatically creates an OpenSearch index with:

- **Vector Field**: kNN vector (1024 dimensions, cosine similarity, HNSW algorithm)
- **Text Field**: Full-text searchable content with standard analyzer
- **Metadata**: Object field for flexible document properties
- **Shards**: 3 primary shards
- **Replicas**: 1 replica per shard

### HNSW Parameters

- **ef_construction**: 128 (build quality)
- **m**: 24 (max connections per layer)
- **space_type**: cosinesimil (cosine similarity)

## Error Handling

The service follows a defensive error handling strategy:

- **Index Operations**: Throws errors (client should handle)
- **Search Operations**: Returns empty array on failure (never throws)
- **Bulk Operations**: Returns partial results with error details

```typescript
const result = await vectorStore.bulkIndex(chunks);
if (result.failed > 0) {
  result.errors.forEach((err) => {
    console.error(`Failed to index ${err.chunkId}: ${err.error}`);
  });
}
```

## Integration with Embedding Service

```typescript
import { EmbeddingService } from './modules/embedding';
import { VectorStoreService } from './modules/vector-store';

// Generate embeddings
const texts = ['chunk 1', 'chunk 2', 'chunk 3'];
const batchResult = await embeddingService.embedBatch(texts);

// Create chunks with embeddings
const chunks = texts.map((text, i) => ({
  chunkId: `doc-${i}`,
  documentId: 'my-doc',
  content: text,
  embedding: batchResult.embeddings[i],
  metadata: { position: i },
}));

// Index in OpenSearch
await vectorStore.bulkIndex(chunks);
```

## Performance Considerations

- **Batch Size**: Use bulk operations for indexing multiple chunks
- **Refresh Strategy**: Uses `refresh: false` for better write performance
- **Connection Pooling**: Singleton client reused across requests
- **Timeout**: 30-second timeout for all operations
- **Lazy Initialization**: Index created only when first needed

## Testing

Run tests with:

```bash
pnpm test vector-store.service.test.ts
```

The test suite covers:

- Index creation and management
- Bulk indexing with success and partial failures
- Vector and hybrid search operations
- Delete operations
- Error handling and edge cases
- Connection management

## Architecture

```
┌─────────────────────┐
│  Document Service   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌──────────────────┐
│ Embedding Service   │────▶│ Bedrock Titan V2 │
└──────────┬──────────┘     └──────────────────┘
           │
           ▼ (embeddings)
┌─────────────────────┐     ┌──────────────────┐
│ Vector Store Svc    │────▶│   OpenSearch     │
└─────────────────────┘     └──────────────────┘
           │
           ▼ (search)
┌─────────────────────┐
│   Query Service     │
└─────────────────────┘
```

## OpenSearch Version Compatibility

Tested with OpenSearch 2.x. Requires:

- OpenSearch with kNN plugin enabled
- `index.knn: true` setting
- HNSW algorithm support

## Security

- SSL/TLS enabled in production (`NODE_ENV=production`)
- Supports AWS Signature V4 authentication (configure in client)
- Index-level security through OpenSearch roles

## Troubleshooting

### Index Creation Fails

```
Error: [index_creation_exception] failed to create index
```

**Solution**: Ensure kNN plugin is enabled in OpenSearch:

```json
{
  "index.knn": true
}
```

### Search Returns Empty Results

- Verify index exists: `GET /docintel-vectors`
- Check embedding dimensions match (1024)
- Ensure documents were indexed: `GET /docintel-vectors/_count`

### Connection Timeout

```
Error: Request timed out
```

**Solution**: Increase timeout in environment or check OpenSearch cluster health.

## Future Enhancements

- [ ] Support for hybrid search score tuning (boost factors)
- [ ] Filtered search (by metadata fields)
- [ ] Pagination for large result sets
- [ ] Index optimization and refresh strategies
- [ ] Metrics and observability (search latency, index size)
