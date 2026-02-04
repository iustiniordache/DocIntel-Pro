'use client';

/**
 * ChatInterface Component
 * Real-time chat interface for asking questions about documents
 * Features:
 * - Question input with validation
 * - Message history display
 * - Source citations with similarity scores
 * - Confidence indicators
 * - Loading states
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Loader2, FileText, Sparkles } from 'lucide-react';
import { useQuery, type Message } from '../hooks/useQuery';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { cn, formatDate } from '../lib/utils';

export interface ChatInterfaceProps {
  placeholder?: string;
}

export function ChatInterface({
  placeholder = 'Ask a question about your documents...',
}: ChatInterfaceProps) {
  const { queryState, messages, sendMessage, clearMessages } = useQuery();
  const [question, setQuestion] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!question.trim() || queryState.isLoading) return;

      const q = question;
      setQuestion('');
      await sendMessage(q);
    },
    [question, queryState.isLoading, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  return (
    <Card className="w-full flex flex-col h-[600px]">
      <CardHeader className="border-b">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Chat</CardTitle>
            <CardDescription>Ask questions about all your documents</CardDescription>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={clearMessages}>
              Clear
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-hidden p-0">
        <div className="flex flex-col h-full">
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                <Sparkles className="w-12 h-12 text-muted-foreground/50" />
                <div>
                  <p className="text-lg font-medium text-muted-foreground">
                    No messages yet
                  </p>
                  <p className="text-sm text-muted-foreground/75 mt-1">
                    Start by asking a question about your documents
                  </p>
                </div>
              </div>
            )}

            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {queryState.isLoading && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground">Thinking...</p>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="border-t p-4">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                maxLength={500}
                disabled={queryState.isLoading}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={!question.trim() || queryState.isLoading}
                size="icon"
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-2">
              {question.length}/500 characters
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn('flex items-start gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}
    >
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      <div className={cn('flex-1 space-y-2', isUser ? 'items-end' : 'items-start')}>
        <div
          className={cn(
            'rounded-lg px-4 py-2 max-w-[85%]',
            isUser
              ? 'bg-primary text-primary-foreground ml-auto'
              : 'bg-muted text-foreground',
          )}
        >
          <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDate(message.timestamp)}</span>
          {message.confidence !== undefined && (
            <span className="flex items-center gap-1">
              • Confidence: {(message.confidence * 100).toFixed(0)}%
            </span>
          )}
        </div>

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <div className="space-y-2 mt-2">
            <p className="text-xs font-medium text-muted-foreground">
              Sources ({message.sources.length}):
            </p>
            <div className="space-y-2">
              {message.sources.map((source, index) => (
                <SourceCard
                  key={`${source.chunkId}-${index}`}
                  source={source}
                  index={index}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({
  source,
  index,
}: {
  source: NonNullable<Message['sources']>[number];
  index: number;
}) {
  const similarityPercent = (source.similarity * 100).toFixed(1);
  const isHighConfidence = source.similarity >= 0.85;
  const isMediumConfidence = source.similarity >= 0.7 && source.similarity < 0.85;

  return (
    <div className="border rounded-lg p-3 bg-card text-card-foreground hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs font-medium">Source {index + 1}</span>
          {source.pageNumber && (
            <span className="text-xs text-muted-foreground">
              • Page {source.pageNumber}
            </span>
          )}
        </div>
        <span
          className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            isHighConfidence && 'bg-green-500/10 text-green-600 dark:text-green-400',
            isMediumConfidence && 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
            !isHighConfidence && !isMediumConfidence && 'bg-muted text-muted-foreground',
          )}
        >
          {similarityPercent}%
        </span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{source.content}</p>
    </div>
  );
}
