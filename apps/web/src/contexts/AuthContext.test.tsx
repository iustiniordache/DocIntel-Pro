/**
 * Tests for AuthContext
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as auth from '@/lib/auth';
import React from 'react';

vi.mock('@/lib/auth');

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(auth.tokenStorage.get).mockReturnValue(null);
    vi.mocked(auth.tokenStorage.isValid).mockReturnValue(false);
  });

  it('should provide auth context', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current).toBeDefined();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('should handle login', async () => {
    const mockTokens = {
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    };

    const mockUser = {
      userId: 'user-123',
      email: 'test@example.com',
      emailVerified: true,
    };

    vi.mocked(auth.signIn).mockResolvedValue(mockTokens);
    vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);
    vi.mocked(auth.tokenStorage.save).mockImplementation(() => {});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('test@example.com', 'password123');
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.user?.email).toBe('test@example.com');
    });
  });

  it('should handle registration', async () => {
    vi.mocked(auth.signUp).mockResolvedValue({
      userSub: 'user-123',
      username: 'test_user',
    });

    const { result } = renderHook(() => useAuth(), { wrapper });

    let userSub: string | undefined;
    await act(async () => {
      const response = await result.current.register('test@example.com', 'password123');
      userSub = response.userSub;
    });

    expect(userSub).toBe('user-123');
  });

  it('should handle logout', async () => {
    vi.mocked(auth.signOut).mockResolvedValue(undefined);
    vi.mocked(auth.tokenStorage.clear).mockImplementation(() => {});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('should restore session from storage', async () => {
    const mockTokens = {
      accessToken: 'stored-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    };

    const mockUser = {
      userId: 'user-123',
      email: 'stored@example.com',
      emailVerified: true,
    };

    vi.mocked(auth.tokenStorage.get).mockReturnValue(mockTokens);
    vi.mocked(auth.tokenStorage.isValid).mockReturnValue(true);
    vi.mocked(auth.getCurrentUser).mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await waitFor(() => {
      expect(result.current.user?.email).toBe('stored@example.com');
    });
  });

  it('should provide getIdToken method', async () => {
    const mockTokens = {
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 3600000,
    };

    vi.mocked(auth.signIn).mockResolvedValue(mockTokens);
    vi.mocked(auth.getCurrentUser).mockResolvedValue({
      userId: 'user-123',
      email: 'test@example.com',
      emailVerified: true,
    });
    vi.mocked(auth.tokenStorage.save).mockImplementation(() => {});
    vi.mocked(auth.refreshTokens).mockResolvedValue(mockTokens);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(async () => {
      await result.current.login('test@example.com', 'password123');
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    let token: string = '';
    await act(async () => {
      token = await result.current.getIdToken();
    });

    expect(token).toBe('id-token');
  });
});
