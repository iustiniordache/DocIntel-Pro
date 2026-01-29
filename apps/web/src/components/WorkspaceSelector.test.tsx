/**
 * Tests for WorkspaceSelector component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkspaceSelector } from './WorkspaceSelector';
import React from 'react';

const mockWorkspaces = [
  {
    workspaceId: 'workspace-1',
    name: 'My Workspace',
    description: 'Test workspace',
    ownerId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    workspaceId: 'workspace-2',
    name: 'Second Workspace',
    description: 'Another workspace',
    ownerId: 'user-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const mockSelectWorkspace = vi.fn();
const mockCreateNewWorkspace = vi.fn();

vi.mock('@/contexts/WorkspaceContext', () => ({
  useWorkspace: () => ({
    workspaces: mockWorkspaces,
    selectedWorkspace: mockWorkspaces[0],
    selectWorkspace: mockSelectWorkspace,
    createNewWorkspace: mockCreateNewWorkspace,
    isLoading: false,
  }),
}));

describe('WorkspaceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render workspace selector', () => {
    render(<WorkspaceSelector />);

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('My Workspace')).toBeInTheDocument();
  });

  it('should display workspace information', () => {
    render(<WorkspaceSelector />);

    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('My Workspace')).toBeInTheDocument();
  });

  it('should display workspace dropdown', () => {
    render(<WorkspaceSelector />);

    const dropdownTrigger = screen.getByRole('button', { name: /my workspace/i });
    expect(dropdownTrigger).toBeInTheDocument();
  });

  it('should show create workspace dialog button', () => {
    render(<WorkspaceSelector />);

    const createButton = screen.getByRole('button', { name: /new workspace/i });
    expect(createButton).toBeInTheDocument();
  });

  it('should handle workspace creation', async () => {
    mockCreateNewWorkspace.mockResolvedValue({
      workspaceId: 'workspace-3',
      name: 'New Workspace',
      description: 'Brand new',
      ownerId: 'user-1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    render(<WorkspaceSelector />);

    const createButton = screen.getByRole('button', { name: /new workspace/i });
    fireEvent.click(createButton);

    // Fill in form
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/workspace name/i);
      const descInput = screen.getByLabelText(/description/i);

      fireEvent.change(nameInput, { target: { value: 'New Workspace' } });
      fireEvent.change(descInput, { target: { value: 'Brand new' } });
    });
  });
});
