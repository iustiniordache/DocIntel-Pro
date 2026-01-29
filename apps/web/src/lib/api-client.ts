/**
 * API Client for DocIntel Pro
 * Handles communication with the backend API Gateway
 */

// Remove trailing slash from API URL to avoid double slashes
const API_BASE_URL = (
  process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'
).replace(/\/$/, '');

export interface UploadResponse {
  uploadUrl: string;
  documentId: string;
  expiresIn: number;
}

export interface QueryRequest {
  question: string;
  documentId?: string;
}

export interface Source {
  chunkId: string;
  documentId: string;
  similarity: number;
  pageNumber?: number;
  content: string;
}

export interface QueryResponse {
  answer: string;
  sources: Source[];
  confidence: number;
}

export interface Document {
  documentId: string;
  filename: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  uploadedAt: string;
  pageCount?: number;
  size?: number;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

/**
 * Request presigned URL for file upload
 */
export async function requestUploadUrl(
  filename: string,
  workspaceId: string,
  idToken: string,
  contentType: string = 'application/pdf',
): Promise<UploadResponse> {
  const response = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      filename,
      workspaceId,
      contentType,
    }),
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(error.message || 'Failed to request upload URL');
  }

  return response.json();
}

/**
 * Upload file to S3 using presigned URL
 */
export async function uploadToS3(
  presignedUrl: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = (event.loaded / event.total) * 100;
        onProgress(progress);
      }
    });

    // Handle completion
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });

    // Handle errors
    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload aborted'));
    });

    // Send request
    xhr.open('PUT', presignedUrl);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

/**
 * Send query to RAG endpoint
 */
export async function sendQuery(
  request: QueryRequest,
  idToken: string,
): Promise<QueryResponse> {
  const response = await fetch(`${API_BASE_URL}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(error.message || 'Query failed');
  }

  return response.json();
}

/**
 * Stream query response (for future streaming support)
 */
export async function* streamQuery(request: QueryRequest): AsyncGenerator<string> {
  const response = await fetch(`${API_BASE_URL}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error: ErrorResponse = await response.json();
    throw new Error(error.message || 'Query failed');
  }

  // For now, return the full response
  // In the future, this could parse SSE or streaming JSON
  const data: QueryResponse = await response.json();
  yield data.answer;
}

/**
 * List all documents with their status from backend
 */
export async function listDocuments(workspaceId?: string): Promise<Document[]> {
  // Only fetch from backend on client side
  if (typeof window === 'undefined') {
    return [];
  }

  // Return empty array if no workspace selected
  if (!workspaceId) {
    return [];
  }

  try {
    // Get the ID token from auth context
    const tokens = JSON.parse(localStorage.getItem('auth_tokens') || '{}');
    const idToken = tokens.idToken;

    const url = new URL(`${API_BASE_URL}/documents`);
    url.searchParams.append('workspaceId', workspaceId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(idToken && { Authorization: `Bearer ${idToken}` }),
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch documents');
    }

    const documents: Document[] = await response.json();

    // Sync to localStorage for offline access
    localStorage.setItem('docintel_documents', JSON.stringify(documents));

    return documents;
  } catch (error) {
    console.error('Error fetching documents from backend:', error);
    // Fallback to localStorage if backend fails
    const stored = localStorage.getItem('docintel_documents');
    return stored ? JSON.parse(stored) : [];
  }
}

/**
 * Delete document (mock for now - would need backend endpoint)
 */
export async function deleteDocument(documentId: string): Promise<void> {
  // TODO: Implement backend endpoint
  // For now, remove from localStorage
  const stored = localStorage.getItem('docintel_documents');
  if (stored) {
    const documents: Document[] = JSON.parse(stored);
    const filtered = documents.filter((doc) => doc.documentId !== documentId);
    localStorage.setItem('docintel_documents', JSON.stringify(filtered));
  }
}

/**
 * Store document metadata locally
 */
export function storeDocumentMetadata(document: Document): void {
  const stored = localStorage.getItem('docintel_documents');
  const documents: Document[] = stored ? JSON.parse(stored) : [];
  documents.push(document);
  localStorage.setItem('docintel_documents', JSON.stringify(documents));
}

/**
 * Update document status
 */
export function updateDocumentStatus(
  documentId: string,
  status: Document['status'],
): void {
  const stored = localStorage.getItem('docintel_documents');
  if (stored) {
    const documents: Document[] = JSON.parse(stored);
    const document = documents.find((doc) => doc.documentId === documentId);
    if (document) {
      document.status = status;
      localStorage.setItem('docintel_documents', JSON.stringify(documents));
    }
  }
}
