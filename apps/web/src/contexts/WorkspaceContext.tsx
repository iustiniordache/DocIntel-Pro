/**
 * Workspace Context
 * Manages workspace state and operations
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { useAuth } from './AuthContext';
import {
  getWorkspaces,
  createWorkspace,
  deleteWorkspace,
  type Workspace,
} from '@/lib/workspace-client';

interface WorkspaceContextType {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  isLoading: boolean;
  selectWorkspace: (workspace: Workspace) => void;
  createNewWorkspace: (name: string, description?: string) => Promise<Workspace>;
  removeWorkspace: (workspaceId: string) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, getIdToken } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refreshWorkspaces = useCallback(async () => {
    if (!isAuthenticated) {
      setWorkspaces([]);
      setSelectedWorkspace(null);
      return;
    }

    setIsLoading(true);
    try {
      const token = await getIdToken();
      const data = await getWorkspaces(token);
      setWorkspaces(data);

      // Restore previously selected workspace from localStorage
      const savedWorkspaceId =
        typeof window !== 'undefined' ? localStorage.getItem('selected_workspace') : null;

      if (savedWorkspaceId) {
        const savedWorkspace = data.find((w) => w.workspaceId === savedWorkspaceId);
        if (savedWorkspace) {
          setSelectedWorkspace(savedWorkspace);
          return;
        }
      }

      // Auto-select first workspace if none selected
      if (data.length > 0) {
        setSelectedWorkspace(data[0]!);
        if (typeof window !== 'undefined') {
          localStorage.setItem('selected_workspace', data[0]!.workspaceId);
        }
      }
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, getIdToken]);

  useEffect(() => {
    refreshWorkspaces();
  }, [isAuthenticated]);

  const selectWorkspace = useCallback((workspace: Workspace) => {
    setSelectedWorkspace(workspace);
    // Store in localStorage for persistence
    if (typeof window !== 'undefined') {
      localStorage.setItem('selected_workspace', workspace.workspaceId);
    }
  }, []);

  const createNewWorkspace = useCallback(
    async (name: string, description?: string): Promise<Workspace> => {
      const token = await getIdToken();
      const workspace = await createWorkspace(token, name, description);
      setWorkspaces((prev) => [...prev, workspace]);
      setSelectedWorkspace(workspace);
      return workspace;
    },
    [getIdToken],
  );

  const removeWorkspace = useCallback(
    async (workspaceId: string) => {
      const token = await getIdToken();
      await deleteWorkspace(token, workspaceId);
      setWorkspaces((prev) => prev.filter((w) => w.workspaceId !== workspaceId));

      // Select another workspace if the deleted one was selected
      if (selectedWorkspace?.workspaceId === workspaceId) {
        const remaining = workspaces.filter((w) => w.workspaceId !== workspaceId);
        setSelectedWorkspace(remaining[0] || null);
      }
    },
    [getIdToken, selectedWorkspace, workspaces],
  );

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        selectedWorkspace,
        isLoading,
        selectWorkspace,
        createNewWorkspace,
        removeWorkspace,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
