/**
 * Authentication Context
 * Provides authentication state and functions throughout the app
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  signIn,
  signUp,
  confirmSignUp,
  signOut,
  getCurrentUser,
  refreshTokens,
  tokenStorage,
  type AuthTokens,
  type User,
} from '@/lib/auth';

interface AuthContextType {
  user: User | null;
  tokens: AuthTokens | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<{ userSub: string }>;
  confirmEmail: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  getIdToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize auth state from storage
  useEffect(() => {
    const initAuth = async () => {
      const storedTokens = tokenStorage.get();

      if (storedTokens && tokenStorage.isValid(storedTokens)) {
        try {
          const userInfo = await getCurrentUser(storedTokens.accessToken);
          setUser(userInfo);
          setTokens(storedTokens);
        } catch (error) {
          console.error('Failed to restore session:', error);
          tokenStorage.clear();
        }
      }

      setIsLoading(false);
    };

    initAuth();
  }, []);

  // Auto-refresh tokens
  useEffect(() => {
    if (!tokens) return;

    const timeUntilExpiry = tokens.expiresAt - Date.now();
    const refreshTime = Math.max(timeUntilExpiry - 5 * 60 * 1000, 0); // Refresh 5 min before expiry

    const timer = setTimeout(async () => {
      try {
        const newTokens = await refreshTokens(tokens.refreshToken);
        setTokens(newTokens);
        tokenStorage.save(newTokens);
      } catch (error) {
        console.error('Token refresh failed:', error);
        await logout();
      }
    }, refreshTime);

    return () => clearTimeout(timer);
  }, [tokens]);

  const login = useCallback(async (email: string, password: string) => {
    const authTokens = await signIn(email, password);
    const userInfo = await getCurrentUser(authTokens.accessToken);

    setUser(userInfo);
    setTokens(authTokens);
    tokenStorage.save(authTokens);
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    return await signUp(email, password);
  }, []);

  const confirmEmail = useCallback(async (email: string, code: string) => {
    await confirmSignUp(email, code);
  }, []);

  const logout = useCallback(async () => {
    if (tokens) {
      try {
        await signOut(tokens.accessToken);
      } catch (error) {
        console.error('Sign out error:', error);
      }
    }

    setUser(null);
    setTokens(null);
    tokenStorage.clear();
  }, [tokens]);

  const getIdToken = useCallback(async (): Promise<string> => {
    if (!tokens) {
      throw new Error('Not authenticated');
    }

    // Check if token needs refresh
    if (!tokenStorage.isValid(tokens)) {
      const newTokens = await refreshTokens(tokens.refreshToken);
      setTokens(newTokens);
      tokenStorage.save(newTokens);
      return newTokens.idToken;
    }

    return tokens.idToken;
  }, [tokens]);

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        isLoading,
        isAuthenticated: !!user && !!tokens,
        login,
        register,
        confirmEmail,
        logout,
        getIdToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
