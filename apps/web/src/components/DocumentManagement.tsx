'use client';

/**
 * DocumentManagement Component
 * List and manage uploaded documents
 * Features:
 * - List all uploaded documents
 * - Show processing status
 * - Delete documents
 * - Filter by status
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { listDocuments, deleteDocument, type Document } from '../lib/api-client';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn, formatBytes, formatDate } from '../lib/utils';

export interface DocumentManagementProps {
  onDocumentSelect?: (documentId: string) => void;
}

export function DocumentManagement({ onDocumentSelect }: DocumentManagementProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await listDocuments();
      setDocuments(
        docs.sort(
          (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
        ),
      );
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    // Poll for updates every 5 seconds
    const interval = setInterval(loadDocuments, 5000);
    return () => clearInterval(interval);
  }, [loadDocuments]);

  const handleDelete = useCallback(
    async (documentId: string) => {
      if (!confirm('Are you sure you want to delete this document?')) {
        return;
      }

      setDeletingId(documentId);
      try {
        await deleteDocument(documentId);
        await loadDocuments();
      } catch (error) {
        console.error('Failed to delete document:', error);
        alert('Failed to delete document');
      } finally {
        setDeletingId(null);
      }
    },
    [loadDocuments],
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>
          Manage your uploaded documents ({documents.length})
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && documents.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <p className="text-lg font-medium text-muted-foreground">No documents yet</p>
            <p className="text-sm text-muted-foreground/75 mt-1">
              Upload a document to get started
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((document) => (
              <DocumentItem
                key={document.documentId}
                document={document}
                onDelete={handleDelete}
                onSelect={onDocumentSelect}
                isDeleting={deletingId === document.documentId}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface DocumentItemProps {
  document: Document;
  onDelete: (documentId: string) => void;
  onSelect?: (documentId: string) => void;
  isDeleting: boolean;
}

function DocumentItem({ document, onDelete, onSelect, isDeleting }: DocumentItemProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors',
        onSelect && 'cursor-pointer',
      )}
      onClick={() => onSelect?.(document.documentId)}
    >
      <div className="flex-shrink-0">
        <FileText className="w-10 h-10 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-sm font-medium truncate">{document.filename}</p>
          <StatusBadge status={document.status} />
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{formatDate(document.uploadedAt)}</span>
          {document.size && <span>• {formatBytes(document.size)}</span>}
          {document.pageCount && <span>• {document.pageCount} pages</span>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {document.status === 'processing' && (
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(document.documentId);
          }}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Document['status'] }) {
  const config = getStatusConfig(status);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
        config.className,
      )}
    >
      <config.icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function getStatusConfig(status: Document['status']) {
  switch (status) {
    case 'uploading':
      return {
        label: 'Uploading',
        icon: Clock,
        className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
      };
    case 'processing':
      return {
        label: 'Processing',
        icon: Loader2,
        className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
      };
    case 'completed':
      return {
        label: 'Completed',
        icon: CheckCircle,
        className: 'bg-green-500/10 text-green-600 dark:text-green-400',
      };
    case 'failed':
      return {
        label: 'Failed',
        icon: XCircle,
        className: 'bg-red-500/10 text-red-600 dark:text-red-400',
      };
    default:
      return {
        label: 'Unknown',
        icon: AlertCircle,
        className: 'bg-muted text-muted-foreground',
      };
  }
}
