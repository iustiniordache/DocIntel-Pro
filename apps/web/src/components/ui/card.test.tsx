/**
 * Tests for UI Card components
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './card';
import React from 'react';

describe('Card Components', () => {
  it('should render Card', () => {
    render(<Card data-testid="card">Card content</Card>);

    expect(screen.getByTestId('card')).toBeInTheDocument();
  });

  it('should render CardHeader', () => {
    render(<CardHeader data-testid="header">Header content</CardHeader>);

    expect(screen.getByTestId('header')).toBeInTheDocument();
  });

  it('should render CardTitle', () => {
    render(<CardTitle>Title</CardTitle>);

    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('should render CardDescription', () => {
    render(<CardDescription>Description text</CardDescription>);

    expect(screen.getByText('Description text')).toBeInTheDocument();
  });

  it('should render CardContent', () => {
    render(<CardContent data-testid="content">Content</CardContent>);

    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('should render complete card structure', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Test Card</CardTitle>
          <CardDescription>Test description</CardDescription>
        </CardHeader>
        <CardContent>Test content</CardContent>
      </Card>,
    );

    expect(screen.getByText('Test Card')).toBeInTheDocument();
    expect(screen.getByText('Test description')).toBeInTheDocument();
    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('should apply custom className to Card', () => {
    render(
      <Card className="custom-card" data-testid="card">
        Content
      </Card>,
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveClass('custom-card');
  });
});
