/**
 * Tests for useFileUpload hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileUpload } from './useFileUpload';
import * as apiClient from '../lib/api-client';

// Mock the dependencies
vi.mock('../lib/api-client');
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
    user: { email: 'test@example.com' },
  }),
}));
vi.mock('../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    selectedWorkspace: {
      id: 'workspace-1',
      name: 'Test Workspace',
      description: 'Test',
      ownerId: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),
}));

describe('useFileUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useFileUpload());

    expect(result.current.uploadState).toEqual({
      isUploading: false,
      progress: 0,
      error: null,
      documentId: null,
    });
  });

  it('should reset upload state', () => {
    const { result } = renderHook(() => useFileUpload());

    act(() => {
      result.current.reset();
    });

    expect(result.current.uploadState).toEqual({
      isUploading: false,
      progress: 0,
      error: null,
      documentId: null,
    });
  });

  it('should reject files larger than 50MB', async () => {
    const { result } = renderHook(() => useFileUpload());

    const largeFile = new File(['x'.repeat(51 * 1024 * 1024)], 'large.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      const documentId = await result.current.uploadFile(largeFile);
      expect(documentId).toBeNull();
    });

    expect(result.current.uploadState.error).toBe('File size exceeds 50MB limit');
  });

  it('should reject non-PDF files', async () => {
    const { result } = renderHook(() => useFileUpload());

    const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });

    await act(async () => {
      const documentId = await result.current.uploadFile(textFile);
      expect(documentId).toBeNull();
    });

    expect(result.current.uploadState.error).toBe('Only PDF files are supported');
  });

  it('should successfully upload a valid PDF', async () => {
    const mockDocumentId = 'doc-123';
    vi.mocked(apiClient.requestUploadUrl).mockResolvedValue({
      uploadUrl: 'https://s3.amazonaws.com/upload',
      documentId: mockDocumentId,
      key: 'test-key',
    });
    vi.mocked(apiClient.uploadToS3).mockResolvedValue(undefined);
    vi.mocked(apiClient.storeDocumentMetadata).mockResolvedValue({
      documentId: mockDocumentId,
      workspaceId: 'workspace-1',
      name: 'test.pdf',
      size: 1024,
      uploadedAt: new Date().toISOString(),
      status: 'processing',
    });

    const { result } = renderHook(() => useFileUpload());

    const validFile = new File(['test content'], 'test.pdf', {
      type: 'application/pdf',
    });

    let documentId: string | null = null;
    await act(async () => {
      documentId = await result.current.uploadFile(validFile);
    });

    await waitFor(() => {
      expect(documentId).toBe(mockDocumentId);
      expect(result.current.uploadState.documentId).toBe(mockDocumentId);
    });
  });

  it('should handle upload errors', async () => {
    vi.mocked(apiClient.requestUploadUrl).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useFileUpload());

    const validFile = new File(['test content'], 'test.pdf', {
      type: 'application/pdf',
    });

    await act(async () => {
      const documentId = await result.current.uploadFile(validFile);
      expect(documentId).toBeNull();
    });

    expect(result.current.uploadState.error).toBeTruthy();
  });
});
