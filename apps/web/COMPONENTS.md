# DocIntel Pro - Web Components

React/Next.js components for document upload and RAG chat interface.

## 🎨 Components

### FileUpload

Drag-and-drop file upload component with progress tracking.

```tsx
import { FileUpload } from '@/components/FileUpload';

<FileUpload
  onUploadComplete={(documentId) => console.log('Uploaded:', documentId)}
  onUploadError={(error) => console.error('Error:', error)}
/>;
```

**Features:**

- Drag and drop PDF files
- File size validation (50MB max)
- Upload progress bar
- Success/error states
- Automatic S3 upload via presigned URL

---

### ChatInterface

Real-time chat interface for asking questions about documents.

```tsx
import { ChatInterface } from '@/components/ChatInterface';

<ChatInterface documentId="optional-document-id" placeholder="Ask a question..." />;
```

**Features:**

- Question input with 500 char limit
- Message history display
- Source citations with similarity scores
- Confidence indicators
- Loading states
- Auto-scroll to bottom

---

### DocumentManagement

List and manage uploaded documents.

```tsx
import { DocumentManagement } from '@/components/DocumentManagement';

<DocumentManagement
  onDocumentSelect={(documentId) => console.log('Selected:', documentId)}
/>;
```

**Features:**

- List all uploaded documents
- Show processing status (uploading, processing, completed, failed)
- Delete documents
- Auto-refresh every 5 seconds
- Click to select document for chat

---

## 🪝 Hooks

### useFileUpload

Handle the complete file upload flow.

```tsx
import { useFileUpload } from '@/hooks/useFileUpload';

const { uploadState, uploadFile, reset } = useFileUpload();

// Upload a file
await uploadFile(file);

// Check state
console.log(uploadState.isUploading);
console.log(uploadState.progress); // 0-100
console.log(uploadState.error);
console.log(uploadState.documentId);

// Reset state
reset();
```

**Flow:**

1. Validates file (PDF only, max 50MB)
2. Requests presigned URL from API
3. Uploads to S3 with progress tracking
4. Stores document metadata in localStorage
5. Returns document ID

---

### useQuery

Send questions and receive RAG responses.

```tsx
import { useQuery } from '@/hooks/useQuery';

const { queryState, messages, sendMessage, clearMessages } = useQuery();

// Send a question
await sendMessage('What is this document about?', 'optional-doc-id');

// Access messages
messages.forEach((msg) => {
  console.log(msg.role, msg.content);
  console.log(msg.sources); // Citations
  console.log(msg.confidence); // 0-1
});

// Clear history
clearMessages();
```

**Message Interface:**

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  confidence?: number;
  timestamp: Date;
}
```

---

## 📡 API Client

Low-level API functions in `lib/api-client.ts`:

```typescript
// Request upload URL
const { uploadUrl, documentId } = await requestUploadUrl(filename, contentType);

// Upload to S3
await uploadToS3(presignedUrl, file, (progress) => {
  console.log(`${progress}% complete`);
});

// Send query
const response = await sendQuery({
  question: 'What is AI?',
  documentId: 'optional-doc-id',
});

console.log(response.answer);
console.log(response.sources);
console.log(response.confidence);

// List documents (localStorage for now)
const documents = await listDocuments();

// Delete document
await deleteDocument(documentId);
```

---

## 🎨 UI Components

Built with Tailwind CSS and shadcn/ui patterns:

- **Button** (`components/ui/button.tsx`)
- **Input** (`components/ui/input.tsx`)
- **Card** (`components/ui/card.tsx`)
- **Progress** (`components/ui/progress.tsx`)

All components support dark mode and are fully responsive.

---

## ⚙️ Configuration

### Environment Variables

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=https://your-api.execute-api.us-east-1.amazonaws.com/prod
```

### API Endpoints

The components expect these endpoints:

1. **POST /upload**
   - Request: `{ filename: string, contentType: string }`
   - Response: `{ uploadUrl: string, documentId: string, expiresIn: number }`

2. **POST /query**
   - Request: `{ question: string, documentId?: string }`
   - Response: `{ answer: string, sources: Source[], confidence: number }`

---

## 🚀 Usage Example

```tsx
'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ChatInterface } from '@/components/ChatInterface';
import { DocumentManagement } from '@/components/DocumentManagement';

export default function HomePage() {
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>();

  return (
    <div className="container mx-auto p-8">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Upload & Documents */}
        <div className="space-y-6">
          <FileUpload onUploadComplete={setSelectedDocumentId} />
          <DocumentManagement onDocumentSelect={setSelectedDocumentId} />
        </div>

        {/* Right: Chat */}
        <ChatInterface documentId={selectedDocumentId} />
      </div>
    </div>
  );
}
```

---

## 🎨 Styling

All components use Tailwind CSS with CSS variables for theming:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  --muted: 210 40% 96.1%;
  /* ... more vars */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... dark theme vars */
}
```

---

## 📦 Dependencies

Required packages (already in package.json):

```json
{
  "dependencies": {
    "next": "^15.1.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@radix-ui/react-slot": "^1.1.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "tailwind-merge": "^2.5.5",
    "tailwindcss-animate": "^1.0.7"
  }
}
```

---

## 🧪 Testing

Components are designed to be testable:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FileUpload } from '@/components/FileUpload';

test('FileUpload shows drag zone', () => {
  render(<FileUpload />);
  expect(screen.getByText(/drag and drop/i)).toBeInTheDocument();
});
```

---

## 📝 Type Safety

All components are fully typed with TypeScript:

```typescript
// API Types
interface QueryRequest {
  question: string;
  documentId?: string;
}

interface Source {
  chunkId: string;
  documentId: string;
  similarity: number;
  pageNumber?: number;
  content: string;
}

interface QueryResponse {
  answer: string;
  sources: Source[];
  confidence: number;
}
```

---

## 🔄 State Management

- **Upload State**: Managed by `useFileUpload` hook
- **Query State**: Managed by `useQuery` hook
- **Document List**: Stored in localStorage (temporary)
- **Message History**: In-memory with `useQuery`

---

## 🎯 Future Enhancements

- [ ] Streaming responses with Server-Sent Events
- [ ] Backend API for document persistence
- [ ] Document preview/viewer
- [ ] Export chat history
- [ ] Multi-file upload
- [ ] Advanced filters for documents
- [ ] Keyboard shortcuts
- [ ] Voice input
- [ ] Mobile optimization
