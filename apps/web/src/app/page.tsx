'use client';

/**
 * Main Application Page
 * Integrates FileUpload, ChatInterface, and DocumentManagement components
 */

import { useState, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AuthForm } from '@/components/AuthForm';
import { WorkspaceSelector } from '@/components/WorkspaceSelector';
import { FileUpload } from '@/components/FileUpload';
import { ChatInterface } from '@/components/ChatInterface';
import {
  DocumentManagement,
  DocumentManagementRef,
} from '@/components/DocumentManagement';
import { Button } from '@/components/ui/button';
import { LogOut, Loader2 } from 'lucide-react';

export default function HomePage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | undefined>();
  const documentManagementRef = useRef<DocumentManagementRef>(null);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show auth form if not authenticated
  if (!isAuthenticated) {
    return <AuthForm />;
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">DocIntel Pro</h1>
              <p className="text-muted-foreground mt-2">
                Intelligent Document Processing with AWS Textract and Bedrock
              </p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{user?.email}</span>
              <Button variant="outline" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Workspace, Upload & Documents */}
          <div className="space-y-6">
            <WorkspaceSelector />

            <FileUpload
              onUploadComplete={(documentId: string) => {
                setSelectedDocumentId(documentId);
                // Refresh document list after upload
                documentManagementRef.current?.refresh();
              }}
              onUploadError={(_error: string) => {
                // Error is handled in the component
              }}
            />

            <DocumentManagement
              ref={documentManagementRef}
              onDocumentSelect={(documentId: string) => {
                setSelectedDocumentId(documentId);
              }}
            />
          </div>

          {/* Right Column: Chat */}
          <div className="lg:sticky lg:top-8 lg:self-start">
            <ChatInterface
              documentId={selectedDocumentId}
              placeholder={
                selectedDocumentId
                  ? 'Ask a question about this document...'
                  : 'Ask a question about all your documents...'
              }
            />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>
            Built with Next.js, AWS Lambda, Textract, OpenSearch, and Bedrock Claude 3
            Haiku
          </p>
        </div>
      </footer>
    </main>
  );
}
