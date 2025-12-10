'use client';

/**
 * FileUpload Component
 * Drag-and-drop zone for uploading PDF documents
 * Features:
 * - Drag and drop support
 * - File size validation (50MB max)
 * - Progress bar during upload
 * - Success/error states
 */

import React, { useCallback, useState } from 'react';
import { Upload, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useFileUpload } from '../hooks/useFileUpload';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn, formatBytes } from '../lib/utils';

export interface FileUploadProps {
  onUploadComplete?: (documentId: string) => void;
  onUploadError?: (error: string) => void;
}

export function FileUpload({ onUploadComplete, onUploadError }: FileUploadProps) {
  const { uploadState, uploadFile, reset } = useFileUpload();
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const pdfFile = files.find((file) => file.type === 'application/pdf');

      if (!pdfFile) {
        onUploadError?.('Please upload a PDF file');
        return;
      }

      setSelectedFile(pdfFile);
      const documentId = await uploadFile(pdfFile);

      if (documentId) {
        onUploadComplete?.(documentId);
      } else if (uploadState.error) {
        onUploadError?.(uploadState.error);
      }
    },
    [uploadFile, uploadState.error, onUploadComplete, onUploadError],
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      if (!file) return;

      setSelectedFile(file);

      const documentId = await uploadFile(file);

      if (documentId) {
        onUploadComplete?.(documentId);
      } else if (uploadState.error) {
        onUploadError?.(uploadState.error);
      }
    },
    [uploadFile, uploadState.error, onUploadComplete, onUploadError],
  );

  const handleReset = useCallback(() => {
    reset();
    setSelectedFile(null);
    setIsDragOver(false);
  }, [reset]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Upload Document</CardTitle>
        <CardDescription>Upload a PDF document for processing (max 50MB)</CardDescription>
      </CardHeader>
      <CardContent>
        {!uploadState.isUploading && uploadState.progress === 0 && !uploadState.error && (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={cn(
              'relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
              isDragOver
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/50',
            )}
          >
            <label
              htmlFor="file-upload"
              className="flex flex-col items-center justify-center w-full h-full cursor-pointer"
            >
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-12 h-12 mb-4 text-muted-foreground" />
                <p className="mb-2 text-sm text-muted-foreground">
                  <span className="font-semibold">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-muted-foreground">PDF files only (max 50MB)</p>
              </div>
              <input
                id="file-upload"
                type="file"
                className="hidden"
                accept="application/pdf"
                onChange={handleFileSelect}
              />
            </label>
          </div>
        )}

        {uploadState.isUploading && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">Uploading document...</p>
                {selectedFile && (
                  <p className="text-xs text-muted-foreground">
                    {selectedFile.name} ({formatBytes(selectedFile.size)})
                  </p>
                )}
              </div>
            </div>
            <Progress value={uploadState.progress} className="w-full" />
            <p className="text-sm text-muted-foreground text-center">
              {uploadState.progress}% complete
            </p>
          </div>
        )}

        {uploadState.progress === 100 && !uploadState.error && (
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <CheckCircle className="w-16 h-16 text-green-500" />
            <div className="text-center">
              <p className="text-lg font-semibold">Upload successful!</p>
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  {selectedFile.name} is now being processed
                </p>
              )}
              {uploadState.documentId && (
                <p className="text-xs text-muted-foreground mt-1 font-mono">
                  ID: {uploadState.documentId.slice(0, 8)}...
                </p>
              )}
            </div>
            <Button onClick={handleReset} variant="outline">
              Upload Another Document
            </Button>
          </div>
        )}

        {uploadState.error && (
          <div className="flex flex-col items-center justify-center space-y-4 py-8">
            <XCircle className="w-16 h-16 text-destructive" />
            <div className="text-center">
              <p className="text-lg font-semibold text-destructive">Upload failed</p>
              <p className="text-sm text-muted-foreground mt-2">{uploadState.error}</p>
            </div>
            <Button onClick={handleReset} variant="outline">
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
