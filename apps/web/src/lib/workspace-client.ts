/**
 * Workspace API Client
 */

const API_BASE_URL = (
  process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'
).replace(/\/$/, '');

export interface Workspace {
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  documentCount?: number;
}

export async function getWorkspaces(idToken: string): Promise<Workspace[]> {
  const response = await fetch(`${API_BASE_URL}/workspaces`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch workspaces');
  }

  const data = await response.json();
  return data.data || [];
}

export async function createWorkspace(
  idToken: string,
  name: string,
  description?: string,
): Promise<Workspace> {
  const response = await fetch(`${API_BASE_URL}/workspaces`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description }),
  });

  if (!response.ok) {
    throw new Error('Failed to create workspace');
  }

  const data = await response.json();
  return data.data;
}

export async function getWorkspace(
  idToken: string,
  workspaceId: string,
): Promise<Workspace> {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}`, {
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch workspace');
  }

  const data = await response.json();
  return data.data;
}

export async function updateWorkspace(
  idToken: string,
  workspaceId: string,
  name?: string,
  description?: string,
): Promise<Workspace> {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name, description }),
  });

  if (!response.ok) {
    throw new Error('Failed to update workspace');
  }

  const data = await response.json();
  return data.data;
}

export async function deleteWorkspace(
  idToken: string,
  workspaceId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/workspaces/${workspaceId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to delete workspace');
  }
}
