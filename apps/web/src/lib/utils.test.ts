/**
 * Tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import { cn, formatBytes, formatDate } from './utils';

describe('cn', () => {
  it('should merge class names', () => {
    const result = cn('text-red-500', 'bg-blue-500');
    expect(result).toBe('text-red-500 bg-blue-500');
  });

  it('should handle conditional classes', () => {
    const result = cn('base-class', false && 'hidden', 'visible');
    expect(result).toBe('base-class visible');
  });

  it('should merge conflicting tailwind classes', () => {
    const result = cn('px-2', 'px-4');
    expect(result).toBe('px-4');
  });
});

describe('formatBytes', () => {
  it('should format 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
  });

  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500 Bytes');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });

  it('should format gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
  });

  it('should handle decimal places', () => {
    expect(formatBytes(1536, 0)).toBe('2 KB');
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
    expect(formatBytes(1536, 2)).toBe('1.5 KB'); // JS trims trailing zeros
  });
});

describe('formatDate', () => {
  it('should format a Date object', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    const result = formatDate(date);
    expect(result).toMatch(/Jan 15, 2024/);
  });

  it('should format a date string', () => {
    const dateString = '2024-01-15T10:30:00Z';
    const result = formatDate(dateString);
    expect(result).toMatch(/Jan 15, 2024/);
  });

  it('should include time in formatted output', () => {
    const date = new Date('2024-01-15T10:30:00Z');
    const result = formatDate(date);
    expect(result).toMatch(/\d{1,2}:\d{2}\s?[AP]M/);
  });
});
