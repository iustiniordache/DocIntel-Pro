/**
 * Tests for FileUpload component
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FileUpload } from './FileUpload';
import React from 'react';

// Mock the useFileUpload hook
const mockUploadFile = vi.fn().mockResolvedValue('doc-123');
const mockReset = vi.fn();

vi.mock('../hooks/useFileUpload', () => ({
  useFileUpload: () => ({
    uploadState: {
      isUploading: false,
      progress: 0,
      error: null,
      documentId: null,
    },
    uploadFile: mockUploadFile,
    reset: mockReset,
  }),
}));

describe('FileUpload', () => {
  it('should render the upload zone', () => {
    render(<FileUpload />);

    expect(screen.getByText(/Upload Document/i)).toBeInTheDocument();
  });

  it('should have a file input', () => {
    render(<FileUpload />);

    const input = screen.getByLabelText(/upload/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('application/pdf');
  });
});
