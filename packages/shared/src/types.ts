/**
 * Document status enumeration
 */
export enum DocumentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/**
 * Document metadata interface
 */
export interface Document {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string;
  s3Bucket: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Textract analysis result
 */
export interface TextractResult {
  documentId: string;
  text: string;
  confidence: number;
  pages: number;
  blocks: TextractBlock[];
  analyzedAt: string;
}

/**
 * Textract block interface
 */
export interface TextractBlock {
  id: string;
  type: string;
  text?: string;
  confidence?: number;
  geometry?: {
    boundingBox: {
      width: number;
      height: number;
      left: number;
      top: number;
    };
  };
}

/**
 * Bedrock embedding result
 */
export interface EmbeddingResult {
  documentId: string;
  chunkId: string;
  embedding: number[];
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Document chunk for vector embeddings
 */
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: PaginationMeta;
}
