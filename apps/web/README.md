# DocIntel Pro - Web

Next.js 15 frontend application with authentication, workspace management, document
upload, and RAG chat interface.

## 🎯 Overview

The web application provides:

- **Authentication**: Cognito-based user registration and login
- **Workspace Management**: Multi-tenant workspace organization
- **Document Upload**: Drag-and-drop PDF upload with progress tracking
- **Chat Interface**: Natural language queries with source citations

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Web Application                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Next.js App Router                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                        │
│  ┌──────────────────┬──────────────┴──────────────┬──────────────────┐     │
│  │                  │                              │                  │     │
│  ▼                  ▼                              ▼                  ▼     │
│  ┌──────────┐  ┌──────────┐                 ┌──────────┐      ┌──────────┐ │
│  │AuthContext│  │Workspace │                 │ TanStack │      │  API     │ │
│  │          │  │ Context  │                 │  Query   │      │ Client   │ │
│  └──────────┘  └──────────┘                 └──────────┘      └──────────┘ │
│       │              │                            │                 │       │
│       └──────────────┴────────────────────────────┴─────────────────┘       │
│                                    │                                        │
│                                    ▼                                        │
│                           ┌──────────────┐                                  │
│                           │   Cognito    │                                  │
│                           │  API Gateway │                                  │
│                           └──────────────┘                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
apps/web/
├── src/
│   ├── app/                         # Next.js App Router
│   │   ├── layout.tsx               # Root layout
│   │   ├── page.tsx                 # Home page
│   │   ├── providers.tsx            # React Query + Auth providers
│   │   └── globals.css              # Tailwind styles
│   ├── components/                  # React components
│   │   ├── ui/                      # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── card.tsx
│   │   │   ├── progress.tsx
│   │   │   ├── label.tsx
│   │   │   └── alert.tsx
│   │   ├── AuthForm.tsx             # Login/Register/Verify UI
│   │   ├── WorkspaceSelector.tsx    # Workspace management UI
│   │   ├── FileUpload.tsx           # Document upload component
│   │   ├── ChatInterface.tsx        # RAG chat interface
│   │   └── DocumentManagement.tsx   # Document list and management
│   ├── contexts/                    # React contexts
│   │   ├── AuthContext.tsx          # Authentication state
│   │   └── WorkspaceContext.tsx     # Workspace state
│   ├── hooks/                       # Custom React hooks
│   │   ├── useFileUpload.ts         # Upload state management
│   │   └── useQuery.ts              # Query state management
│   └── lib/                         # Utilities
│       ├── auth.ts                  # Cognito auth utilities
│       ├── api-client.ts            # API client functions
│       └── workspace-client.ts      # Workspace API client
├── public/                          # Static assets
├── next.config.js                   # Next.js configuration
├── tailwind.config.js               # Tailwind CSS configuration
├── postcss.config.js                # PostCSS configuration
├── vitest.config.ts                 # Test configuration
├── tsconfig.json                    # TypeScript configuration
└── package.json                     # Dependencies
```

## 🎨 Components

### AuthForm

Complete authentication interface with login, registration, and email verification.

```tsx
import { AuthForm } from '@/components/AuthForm';

// Renders login/register/verify forms based on state
<AuthForm />;
```

**Features**:

- User registration with email/password
- Email verification with confirmation code
- Secure login with JWT tokens
- Password requirements validation
- Error handling and feedback

---

### WorkspaceSelector

Workspace management dropdown with creation capability.

```tsx
import { WorkspaceSelector } from '@/components/WorkspaceSelector';

<WorkspaceSelector />;
```

**Features**:

- List all user workspaces
- Create new workspace with name/description
- Switch between workspaces
- Delete empty workspaces
- Document count display

---

### FileUpload

Drag-and-drop file upload with progress tracking.

```tsx
import { FileUpload } from '@/components/FileUpload';

<FileUpload
  onUploadComplete={(documentId) => console.log('Uploaded:', documentId)}
  onUploadError={(error) => console.error('Error:', error)}
/>;
```

**Features**:

- Drag and drop PDF files
- File size validation (50MB max)
- Upload progress bar
- Success/error states
- Direct S3 upload via presigned URL

---

### ChatInterface

Real-time chat interface for asking questions about documents.

```tsx
import { ChatInterface } from '@/components/ChatInterface';

<ChatInterface documentId="optional-document-id" placeholder="Ask a question..." />;
```

**Features**:

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

**Features**:

- List all uploaded documents
- Processing status indicators
- Delete documents
- Auto-refresh every 5 seconds
- Click to select for chat

## 🪝 Hooks

### useFileUpload

Handle the complete file upload flow.

```tsx
import { useFileUpload } from '@/hooks/useFileUpload';

const { uploadState, uploadFile, reset } = useFileUpload();

await uploadFile(file);

console.log(uploadState.isUploading); // boolean
console.log(uploadState.progress); // 0-100
console.log(uploadState.error); // string | null
console.log(uploadState.documentId); // string | null

reset(); // Reset state
```

---

### useQuery

Send questions and receive RAG responses.

```tsx
import { useQuery } from '@/hooks/useQuery';

const { queryState, messages, sendMessage, clearMessages } = useQuery();

await sendMessage('What is this document about?', 'doc-id');

messages.forEach((msg) => {
  console.log(msg.role); // 'user' | 'assistant'
  console.log(msg.content); // string
  console.log(msg.sources); // Source[]
  console.log(msg.confidence); // 0-1
});
```

## 🔐 Authentication

### AuthContext

Provides authentication state and methods throughout the app.

```tsx
import { useAuth } from '@/contexts/AuthContext';

const { user, isAuthenticated, signIn, signUp, signOut, verifyEmail } = useAuth();

// Sign up
await signUp(email, password);

// Verify email
await verifyEmail(email, code);

// Sign in
await signIn(email, password);

// Sign out
await signOut();
```

**Token Management**:

- Storage: localStorage
- Auto-refresh: 5 minutes before expiry
- Validation: Checked on every protected API call

### API Security

All API calls include authentication:

```typescript
headers: {
  'Authorization': `Bearer ${idToken}`,
  'Content-Type': 'application/json'
}
```

## 🗂️ Workspace Management

### WorkspaceContext

Provides workspace state and operations.

```tsx
import { useWorkspace } from '@/contexts/WorkspaceContext';

const {
  workspaces,
  selectedWorkspace,
  createWorkspace,
  selectWorkspace,
  deleteWorkspace,
} = useWorkspace();

// Create workspace
await createWorkspace('My Documents', 'Optional description');

// Select workspace
selectWorkspace(workspaceId);

// Delete workspace
await deleteWorkspace(workspaceId);
```

## 📡 API Client

Low-level API functions in `lib/api-client.ts`:

```typescript
import { requestUploadUrl, uploadToS3, sendQuery, listDocuments } from '@/lib/api-client';

// Request upload URL
const { uploadUrl, documentId } = await requestUploadUrl(filename, contentType);

// Upload to S3 with progress
await uploadToS3(presignedUrl, file, (progress) => {
  console.log(`${progress}% complete`);
});

// Send RAG query
const response = await sendQuery({
  question: 'What is AI?',
  documentId: 'optional-doc-id',
});
console.log(response.answer);
console.log(response.sources);
console.log(response.confidence);

// List documents
const documents = await listDocuments();

// Delete document
await deleteDocument(documentId);
```

## ⚙️ Environment Configuration

Create `.env.local` in the `apps/web` directory:

```bash
# API Configuration (from CDK deployment outputs)
NEXT_PUBLIC_API_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/prod

# Cognito Configuration (from CDK deployment outputs)
NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_REGION=us-east-1
```

### Getting Values from CDK Outputs

After `cdk deploy MinimalStack`:

```
Outputs:
MinimalStack.ApiEndpoint = https://abc123.execute-api.us-east-1.amazonaws.com/prod/
MinimalStack.UserPoolId = us-east-1_ABC123XYZ
MinimalStack.UserPoolClientId = 1234567890abcdefghijklmnop
```

## 🚀 Development

### Run Locally

```bash
cd apps/web

# Install dependencies
pnpm install

# Development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run tests
pnpm test

# Type checking
pnpm typecheck
```

### Available Scripts

| Script           | Description                                 |
| ---------------- | ------------------------------------------- |
| `pnpm dev`       | Development server on http://localhost:3000 |
| `pnpm build`     | Production build                            |
| `pnpm start`     | Start production server                     |
| `pnpm test`      | Run tests with Vitest                       |
| `pnpm typecheck` | TypeScript type checking                    |
| `pnpm lint`      | Run ESLint                                  |

## 👤 User Flow

1. **First Visit** → Sign Up Form
   - Enter email and password
   - Password: 8+ chars, upper, lower, digit, symbol

2. **Email Verification** → Confirmation Form
   - Check email for 6-digit code
   - Enter code to verify account

3. **Login** → Authenticated Dashboard
   - Enter credentials
   - Auto-redirect to main app

4. **Create Workspace** → Workspace Selector
   - Click "New Workspace"
   - Enter name (e.g., "Legal Documents")

5. **Upload Document** → File Upload
   - Select workspace
   - Drag & drop PDF (max 50MB)

6. **Query Documents** → Chat Interface
   - Ask questions about documents
   - View AI answers with sources

## 🎨 Styling

Built with Tailwind CSS and CSS variables for theming:

```css
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 221.2 83.2% 53.3%;
  --muted: 210 40% 96.1%;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
}
```

All components support dark mode and are fully responsive.

## 📦 Dependencies

```json
{
  "dependencies": {
    "next": "^15.1.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@tanstack/react-query": "^5.62.7",
    "@aws-sdk/client-cognito-identity-provider": "^3.712.0",
    "@radix-ui/react-slot": "^1.1.1",
    "@radix-ui/react-label": "^2.1.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.468.0",
    "tailwind-merge": "^2.5.5",
    "tailwindcss-animate": "^1.0.7"
  }
}
```

## 🔒 Security Notes

- **Token Storage**: localStorage (consider httpOnly cookies for production)
- **API Authorization**: All endpoints require JWT token
- **Workspace Isolation**: Server-side ownership verification
- **S3 Access**: Presigned URLs (no direct bucket access)

## 🐛 Troubleshooting

### Common Issues

| Issue                    | Solution                                         |
| ------------------------ | ------------------------------------------------ |
| "User not authenticated" | Clear localStorage, re-login                     |
| CORS errors              | Check API Gateway CORS configuration             |
| Upload fails             | Verify workspace selected, file <50MB            |
| Token expired            | Tokens auto-refresh; if issues persist, re-login |
| Auth fails               | Verify Cognito IDs in `.env.local`               |

### Debug API Calls

Open browser DevTools → Network tab to inspect:

- Authorization headers
- Request/response payloads
- Error responses

## 🧪 Testing

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { FileUpload } from '@/components/FileUpload';

test('FileUpload shows drag zone', () => {
  render(<FileUpload />);
  expect(screen.getByText(/drag and drop/i)).toBeInTheDocument();
});
```

## 📐 TypeScript Types

```typescript
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  confidence?: number;
  timestamp: Date;
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

interface Workspace {
  workspaceId: string;
  ownerId: string;
  name: string;
  description?: string;
  createdAt: string;
  documentCount?: number;
}
```
