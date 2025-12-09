import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';

/**
 * Module for text embedding functionality using AWS Bedrock
 */
@Module({
  providers: [EmbeddingService],
  exports: [EmbeddingService],
})
export class EmbeddingModule {}
