# Embedding Service

AWS Bedrock-based text embedding service using Amazon Titan Embeddings V2.

## Features

- **Single & Batch Embedding**: Generate embeddings for individual texts or process
  multiple texts in batches
- **Automatic Retries**: Exponential backoff retry logic for transient errors (throttling,
  timeouts)
- **Cost Tracking**: Automatic token estimation and cost calculation ($0.02 per 1M tokens)
- **Observability**: Structured logging with metrics (tokens, cost, latency) and X-Ray
  trace support
- **Error Handling**: Graceful handling of failures in batch operations

## Configuration

### Environment Variables

- `BEDROCK_EMBEDDING_MODEL_ID`: Model to use (default: `amazon.titan-embed-text-v2:0`)
- `AWS_REGION`: AWS region for Bedrock (default: `us-east-1`)

## Usage

### Basic Usage

```typescript
import { EmbeddingService } from './modules/embedding';

// Single text embedding
const embedding = await embeddingService.embedText('Your text here');
// Returns: number[] (1024-dimensional vector)

// Batch embedding
const result = await embeddingService.embedBatch([
  'First text',
  'Second text',
  'Third text',
]);
// Returns: EmbeddingBatchResult {
//   embeddings: number[][],
//   totalTokens: number,
//   estimatedCost: number,
//   successCount: number,
//   failureCount: number
// }
```

### Integration with NestJS

```typescript
import { Module } from '@nestjs/common';
import { EmbeddingModule } from './modules/embedding';

@Module({
  imports: [EmbeddingModule],
})
export class AppModule {}
```

## API

### `embedText(text: string): Promise<number[]>`

Generates a 1024-dimensional embedding vector for the provided text.

**Parameters:**

- `text`: Input text to embed (cannot be empty)

**Returns:** Promise<number[]> - 1024-dimensional embedding vector

**Throws:** Error if text is empty or Bedrock request fails

### `embedBatch(texts: string[]): Promise<EmbeddingBatchResult>`

Generates embeddings for multiple texts in batches of 16.

**Parameters:**

- `texts`: Array of texts to embed

**Returns:** Promise<EmbeddingBatchResult> with:

- `embeddings`: Array of embedding vectors (empty array for failed texts)
- `totalTokens`: Total tokens processed
- `estimatedCost`: Estimated cost in USD
- `successCount`: Number of successful embeddings
- `failureCount`: Number of failed embeddings

**Behavior:**

- Empty/whitespace texts are skipped
- Failed embeddings are logged but don't stop batch processing
- Empty arrays are used as placeholders for failed texts

### `getConfig(): Readonly<EmbeddingConfig>`

Returns the current service configuration.

## Error Handling

### Transient Errors (Retried)

- ThrottlingException
- ServiceUnavailableException
- InternalServerException
- RequestTimeout / TimeoutError
- Connection errors (ECONNRESET, ETIMEDOUT)

**Retry Strategy:**

- Max retries: 3
- Exponential backoff: 1s, 2s, 4s (with ±20% jitter)
- Max delay: 30s

### Hard Errors (Not Retried)

- ValidationException
- AccessDeniedException
- ResourceNotFoundException

## Performance

### Batch Processing

- Default batch size: 16 texts per batch
- Parallel processing within each batch
- Continues processing on individual failures

### Token Estimation

- Rough estimate: `Math.ceil(text.length / 4)`
- Actual tokens returned in response

### Cost Calculation

- Model: Amazon Titan Embeddings V2
- Rate: $0.02 per 1 million tokens
- Formula: `(tokens / 1_000_000) * 0.02`

## Observability

### Structured Logs

```json
{
  "msg": "Embedding generated",
  "actualTokens": 100,
  "estimatedTokens": 95,
  "dimensions": 1024,
  "latencyMs": 234,
  "estimatedCost": 0.000002
}
```

### Metrics Tracked

- Token count (estimated & actual)
- Cost per request
- Latency per request
- Success/failure rates
- Batch processing stats

## Testing

Run tests with:

```bash
pnpm test embedding.service.test
```

Test coverage includes:

- ✅ Single text embedding
- ✅ Batch processing
- ✅ Empty text handling
- ✅ Retry logic (transient errors)
- ✅ Hard error handling
- ✅ Cost calculation
- ✅ Observability metrics

## Dependencies

- `@aws-sdk/client-bedrock-runtime`: AWS Bedrock SDK
- `@smithy/node-http-handler`: HTTP handler for SDK
- `@nestjs/common`: NestJS framework
- `pino`: Structured logging

## Model Details

### Amazon Titan Embeddings V2

- Model ID: `amazon.titan-embed-text-v2:0`
- Vector dimensions: 1024
- Max input tokens: 8,192
- Normalization: Enabled
- Output: L2-normalized vectors

## License

Private - DocIntel Pro
