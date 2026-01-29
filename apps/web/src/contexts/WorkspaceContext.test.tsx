/**
 * Tests for WorkspaceContext
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext';
import * as workspaceClient from '@/lib/workspace-client';
import React from 'react';

vi.mock('@/lib/workspace-client');
vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    getIdToken: vi.fn().mockResolvedValue('mock-token'),
  }),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WorkspaceProvider>{children}</WorkspaceProvider>
);

const mockWorkspaces = [
  {
    workspaceId: 'workspace-1',
    name: 'Test Workspace',
    description: 'Test',
    ownerId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    workspaceId: 'workspace-2',
    name: 'Second Workspace',
    description: 'Another',
    ownerId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe('WorkspaceContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(workspaceClient.getWorkspaces).mockResolvedValue(mockWorkspaces);
  });

  it('should provide workspace context', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current).toBeDefined();
      expect(result.current.workspaces).toHaveLength(2);
    });
  });

  it('should load workspaces on mount', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces).toEqual(mockWorkspaces);
    });
  });

  it('should auto-select first workspace', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.selectedWorkspace).toEqual(mockWorkspaces[0]);
    });
  });

  it('should handle workspace selection', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(2);
    });

    const workspace = mockWorkspaces[1];
    if (workspace) {
      act(() => {
        result.current.selectWorkspace(workspace);
      });

      expect(result.current.selectedWorkspace).toEqual(workspace);
    }
  });

  it('should create new workspace', async () => {
    const newWorkspace = {
      workspaceId: 'workspace-3',
      name: 'New Workspace',
      description: 'Brand new',
      ownerId: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    vi.mocked(workspaceClient.createWorkspace).mockResolvedValue(newWorkspace);

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.createNewWorkspace('New Workspace', 'Brand new');
    });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(3);
      expect(result.current.selectedWorkspace).toEqual(newWorkspace);
    });
  });

  it('should delete workspace', async () => {
    vi.mocked(workspaceClient.deleteWorkspace).mockResolvedValue(undefined);

    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(2);
    });

    await act(async () => {
      await result.current.removeWorkspace('workspace-1');
    });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(1);
    });
  });

  it('should refresh workspaces', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(2);
    });

    if (mockWorkspaces[0]) {
      vi.mocked(workspaceClient.getWorkspaces).mockResolvedValue([mockWorkspaces[0]]);
    }

    await act(async () => {
      await result.current.refreshWorkspaces();
    });

    await waitFor(() => {
      expect(workspaceClient.getWorkspaces).toHaveBeenCalledTimes(2);
    });
  });

  it('should persist selected workspace to localStorage', async () => {
    const { result } = renderHook(() => useWorkspace(), { wrapper });

    await waitFor(() => {
      expect(result.current.workspaces).toHaveLength(2);
    });

    const workspace = mockWorkspaces[1];
    if (workspace) {
      act(() => {
        result.current.selectWorkspace(workspace);
      });

      expect(localStorage.getItem('selected_workspace')).toBe('workspace-2');
    }
  });
});
