/**
 * Tests for DocumentManagement component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DocumentManagement } from './DocumentManagement';
import React from 'react';
import * as apiClient from '../lib/api-client';

vi.mock('../lib/api-client');

const mockDocuments = [
  {
    documentId: 'doc-1',
    filename: 'test.pdf',
    status: 'completed' as const,
    uploadedAt: new Date('2024-01-15').toISOString(),
    size: 1024000,
  },
  {
    documentId: 'doc-2',
    filename: 'another.pdf',
    status: 'processing' as const,
    uploadedAt: new Date('2024-01-16').toISOString(),
    size: 2048000,
  },
];

vi.mock('../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    selectedWorkspace: {
      workspaceId: 'workspace-1',
      name: 'Test Workspace',
      description: 'Test',
      ownerId: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),
}));

describe('DocumentManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.listDocuments).mockResolvedValue(mockDocuments);
  });

  it('should render document management component', async () => {
    render(<DocumentManagement />);

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument();
    });
  });

  it('should load documents from API', async () => {
    render(<DocumentManagement />);

    await waitFor(() => {
      expect(apiClient.listDocuments).toHaveBeenCalled();
    });
  });

  it('should render documents heading', async () => {
    render(<DocumentManagement />);

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument();
    });
  });

  it('should display document status', async () => {
    render(<DocumentManagement />);

    await waitFor(() => {
      expect(screen.getByText(/completed/i)).toBeInTheDocument();
      expect(screen.getByText(/processing/i)).toBeInTheDocument();
    });
  });

  it('should display file sizes', async () => {
    render(<DocumentManagement />);

    await waitFor(() => {
      // The formatBytes function will format these
      expect(screen.getByText(/MB/i)).toBeInTheDocument();
    });
  });

  it('should handle empty document list', async () => {
    vi.mocked(apiClient.listDocuments).mockResolvedValue([]);
    render(<DocumentManagement />);

    await waitFor(() => {
      expect(screen.getByText(/no documents/i)).toBeInTheDocument();
    });
  });

  it('should handle document loading error', async () => {
    vi.mocked(apiClient.listDocuments).mockRejectedValue(new Error('Failed to load'));
    render(<DocumentManagement />);

    await waitFor(() => {
      // Component should handle error gracefully
      expect(apiClient.listDocuments).toHaveBeenCalled();
    });
  });

  it('should accept onDocumentSelect prop', async () => {
    const onDocumentSelect = vi.fn();
    render(<DocumentManagement onDocumentSelect={onDocumentSelect} />);

    await waitFor(() => {
      expect(apiClient.listDocuments).toHaveBeenCalled();
    });
  });
});
