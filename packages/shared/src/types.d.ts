export declare enum DocumentStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
export interface Workspace {
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}
export interface Document {
  documentId: string;
  workspaceId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  s3Key: string;
  s3Bucket: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
export interface TextractResult {
  documentId: string;
  text: string;
  confidence: number;
  pages: number;
  blocks: TextractBlock[];
  analyzedAt: string;
}
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
export interface EmbeddingResult {
  documentId: string;
  chunkId: string;
  embedding: number[];
  text: string;
  metadata?: Record<string, unknown>;
}
export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}
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
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: PaginationMeta;
}
//# sourceMappingURL=types.d.ts.map
