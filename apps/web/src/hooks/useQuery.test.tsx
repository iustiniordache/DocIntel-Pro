/**
 * Tests for useQuery hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useQuery } from './useQuery';
import * as apiClient from '../lib/api-client';

vi.mock('../lib/api-client');
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
  }),
}));

// Mock workspace context
const mockWorkspace = {
  workspaceId: 'workspace-123',
  name: 'Test Workspace',
  description: 'Test description',
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
  userId: 'user-123',
};

vi.mock('../contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    selectedWorkspace: mockWorkspace,
    workspaces: [mockWorkspace],
    isLoading: false,
    selectWorkspace: vi.fn(),
    createNewWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    refreshWorkspaces: vi.fn(),
  }),
}));

describe('useQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useQuery());

    expect(result.current.queryState).toEqual({
      isLoading: false,
      error: null,
      response: null,
    });
    expect(result.current.messages).toEqual([]);
  });

  it('should handle sending a message', async () => {
    const mockResponse = {
      answer: 'This is the answer',
      sources: [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          similarity: 0.95,
          content: 'Test content',
          pageNumber: 1,
          score: 0.95,
          excerpt: 'Test excerpt',
        },
      ],
      confidence: 0.9,
    };

    vi.mocked(apiClient.sendQuery).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useQuery());

    await act(async () => {
      await result.current.sendMessage('What is this about?');
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2); // User + Assistant
      expect(result.current.messages[0]?.content).toBe('What is this about?');
      expect(result.current.messages[1]?.content).toBe('This is the answer');
    });
  });

  it('should reject empty questions', async () => {
    const { result } = renderHook(() => useQuery());

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(result.current.queryState.error).toBe('Question cannot be empty');
    expect(result.current.messages).toHaveLength(0);
  });

  it('should reject questions over 500 characters', async () => {
    const { result } = renderHook(() => useQuery());

    const longQuestion = 'a'.repeat(501);

    await act(async () => {
      await result.current.sendMessage(longQuestion);
    });

    expect(result.current.queryState.error).toBe(
      'Question must be 500 characters or less',
    );
  });

  it('should handle query errors', async () => {
    vi.mocked(apiClient.sendQuery).mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useQuery());

    await act(async () => {
      await result.current.sendMessage('Test question');
    });

    await waitFor(() => {
      expect(result.current.queryState.error).toBeTruthy();
    });
  });

  it('should clear messages', () => {
    const { result } = renderHook(() => useQuery());

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
  });

  it('should reset query state', () => {
    const { result } = renderHook(() => useQuery());

    act(() => {
      result.current.reset();
    });

    expect(result.current.queryState).toEqual({
      isLoading: false,
      error: null,
      response: null,
    });
  });

  it('should pass documentId to API', async () => {
    const mockResponse = {
      answer: 'Answer',
      sources: [],
      confidence: 0.8,
    };

    vi.mocked(apiClient.sendQuery).mockResolvedValue(mockResponse);

    const { result } = renderHook(() => useQuery());

    await act(async () => {
      await result.current.sendMessage('Question');
    });

    await waitFor(() => {
      expect(apiClient.sendQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          question: 'Question',
        }),
        'mock-token',
      );
    });
  });
});
