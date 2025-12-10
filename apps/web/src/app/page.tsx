'use client';

/**
 * Main Application Page
 * Integrates FileUpload, ChatInterface, and DocumentManagement components
 */

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ChatInterface } from '@/components/ChatInterface';
import { DocumentManagement } from '@/components/DocumentManagement';

export default function HomePage() {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | undefined>();

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold tracking-tight">DocIntel Pro</h1>
          <p className="text-muted-foreground mt-2">
            Intelligent Document Processing with AWS Textract and Bedrock
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column: Upload & Documents */}
          <div className="space-y-6">
            <FileUpload
              onUploadComplete={(documentId: string) => {
                setSelectedDocumentId(documentId);
              }}
              onUploadError={(_error: string) => {
                // Error is handled in the component
              }}
            />

            <DocumentManagement
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
