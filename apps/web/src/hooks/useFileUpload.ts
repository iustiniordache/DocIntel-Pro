/**
 * useFileUpload Hook
 * Handles the complete file upload flow:
 * 1. Request presigned URL from API
 * 2. Upload file to S3
 * 3. Track progress and status
 */

import { useState, useCallback } from 'react';
import {
  requestUploadUrl,
  uploadToS3,
  storeDocumentMetadata,
  type Document,
} from '../lib/api-client';

export interface UploadState {
  isUploading: boolean;
  progress: number;
  error: string | null;
  documentId: string | null;
}

export interface UseFileUploadReturn {
  uploadState: UploadState;
  uploadFile: (file: File) => Promise<string | null>;
  reset: () => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_TYPES = ['application/pdf'];

export function useFileUpload(): UseFileUploadReturn {
  const [uploadState, setUploadState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
    error: null,
    documentId: null,
  });

  const reset = useCallback(() => {
    setUploadState({
      isUploading: false,
      progress: 0,
      error: null,
      documentId: null,
    });
  }, []);

  const uploadFile = useCallback(async (file: File): Promise<string | null> => {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setUploadState({
        isUploading: false,
        progress: 0,
        error: 'File size exceeds 50MB limit',
        documentId: null,
      });
      return null;
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadState({
        isUploading: false,
        progress: 0,
        error: 'Only PDF files are supported',
        documentId: null,
      });
      return null;
    }

    try {
      // Start upload
      setUploadState({
        isUploading: true,
        progress: 0,
        error: null,
        documentId: null,
      });

      // Step 1: Request presigned URL
      const { uploadUrl, documentId } = await requestUploadUrl(file.name, file.type);

      setUploadState((prev) => ({
        ...prev,
        documentId,
        progress: 10,
      }));

      // Step 2: Upload to S3
      await uploadToS3(uploadUrl, file, (progress) => {
        // Map 10-90% of progress bar to S3 upload
        const mappedProgress = 10 + progress * 0.8;
        setUploadState((prev) => ({
          ...prev,
          progress: Math.round(mappedProgress),
        }));
      });

      // Complete
      setUploadState({
        isUploading: false,
        progress: 100,
        error: null,
        documentId,
      });

      // Store metadata locally
      const document: Document = {
        documentId,
        filename: file.name,
        status: 'processing',
        uploadedAt: new Date().toISOString(),
        size: file.size,
      };
      storeDocumentMetadata(document);

      return documentId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';

      setUploadState({
        isUploading: false,
        progress: 0,
        error: errorMessage,
        documentId: null,
      });

      return null;
    }
  }, []);

  return {
    uploadState,
    uploadFile,
    reset,
  };
}
