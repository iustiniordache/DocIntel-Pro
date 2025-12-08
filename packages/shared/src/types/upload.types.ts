/**
 * Upload request and response types for DocIntel Pro
 */

export interface UploadRequestBody {
  filename: string;
  contentType?: string;
}

export interface UploadResponse {
  uploadUrl: string;
  documentId: string;
  s3Key: string;
  expiresIn: number;
}

export interface DocumentMetadata {
  documentId: string;
  filename: string;
  s3Key: string;
  status: DocumentStatus;
  uploadDate: string;
  contentType?: string;
  fileSize?: number;
  lastModified?: string;
}

export enum DocumentStatus {
  UPLOAD_PENDING = 'UPLOAD_PENDING',
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface UploadError {
  error: string;
  message: string;
  code?: string;
}
