/**
 * useQuery Hook
 * Handles sending questions and receiving RAG responses
 * Supports both immediate responses and streaming (future)
 */

import { useState, useCallback } from 'react';
import { sendQuery, type QueryRequest, type QueryResponse } from '../lib/api-client';
import { useAuth } from '../contexts/AuthContext';
import { useWorkspace } from '../contexts/WorkspaceContext';

export interface QueryState {
  isLoading: boolean;
  error: string | null;
  response: QueryResponse | null;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: QueryResponse['sources'];
  confidence?: number;
  timestamp: Date;
}

export interface UseQueryReturn {
  queryState: QueryState;
  messages: Message[];
  sendMessage: (question: string) => Promise<void>;
  clearMessages: () => void;
  reset: () => void;
}

export function useQuery(): UseQueryReturn {
  const { getIdToken } = useAuth();
  const { selectedWorkspace } = useWorkspace();
  const [queryState, setQueryState] = useState<QueryState>({
    isLoading: false,
    error: null,
    response: null,
  });

  const [messages, setMessages] = useState<Message[]>([]);

  const reset = useCallback(() => {
    setQueryState({
      isLoading: false,
      error: null,
      response: null,
    });
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    reset();
  }, [reset]);

  const sendMessage = useCallback(
    async (question: string) => {
      // Validate question
      if (!question.trim()) {
        setQueryState({
          isLoading: false,
          error: 'Question cannot be empty',
          response: null,
        });
        return;
      }

      if (question.length > 500) {
        setQueryState({
          isLoading: false,
          error: 'Question must be 500 characters or less',
          response: null,
        });
        return;
      }

      // Check if workspace is selected
      if (!selectedWorkspace) {
        setQueryState({
          isLoading: false,
          error: 'Please select a workspace first',
          response: null,
        });
        return;
      }

      try {
        // Add user message
        const userMessage: Message = {
          id: `user-${Date.now()}`,
          role: 'user',
          content: question,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, userMessage]);

        // Start loading
        setQueryState({
          isLoading: true,
          error: null,
          response: null,
        });

        // Send query
        const request: QueryRequest = {
          question,
          workspaceId: selectedWorkspace.workspaceId,
        };

        const idToken = await getIdToken();
        const response = await sendQuery(request, idToken);

        // Add assistant message
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: response.answer,
          sources: response.sources,
          confidence: response.confidence,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // Update state
        setQueryState({
          isLoading: false,
          error: null,
          response,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to send query';

        setQueryState({
          isLoading: false,
          error: errorMessage,
          response: null,
        });

        // Add error message
        const errorMsg: Message = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `Error: ${errorMessage}`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    },
    [getIdToken, selectedWorkspace],
  );

  return {
    queryState,
    messages,
    sendMessage,
    clearMessages,
    reset,
  };
}
