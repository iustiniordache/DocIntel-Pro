/**
 * Authentication component with Login/Register forms
 */

'use client';

import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Alert, AlertDescription } from './ui/alert';
import { Loader2 } from 'lucide-react';

export function AuthForm() {
  const { login, register, confirmEmail } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'confirm'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmCode, setConfirmCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else if (mode === 'register') {
        await register(email, password);
        setPendingEmail(email);
        setMode('confirm');
      } else if (mode === 'confirm') {
        await confirmEmail(pendingEmail || email, confirmCode);
        setMode('login');
        setError('Email confirmed! Please login.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">
            {mode === 'login' && 'Sign In'}
            {mode === 'register' && 'Create Account'}
            {mode === 'confirm' && 'Confirm Email'}
          </CardTitle>
          <CardDescription>
            {mode === 'login' && 'Enter your credentials to access DocIntel Pro'}
            {mode === 'register' && 'Create a new account to get started'}
            {mode === 'confirm' && 'Enter the confirmation code sent to your email'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode !== 'confirm' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    minLength={8}
                  />
                  {mode === 'register' && (
                    <p className="text-xs text-muted-foreground">
                      Must be at least 8 characters with uppercase, lowercase, numbers,
                      and symbols
                    </p>
                  )}
                </div>
              </>
            )}

            {mode === 'confirm' && (
              <div className="space-y-2">
                <Label htmlFor="code">Confirmation Code</Label>
                <Input
                  id="code"
                  type="text"
                  placeholder="123456"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  required
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Check your email for the confirmation code
                </p>
              </div>
            )}

            {error && (
              <Alert variant={error.includes('confirmed') ? 'default' : 'destructive'}>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === 'login' && 'Sign In'}
              {mode === 'register' && 'Create Account'}
              {mode === 'confirm' && 'Confirm Email'}
            </Button>

            <div className="text-center text-sm">
              {mode === 'login' && (
                <button
                  type="button"
                  onClick={() => setMode('register')}
                  className="text-primary hover:underline"
                  disabled={isLoading}
                >
                  Don't have an account? Sign up
                </button>
              )}
              {mode === 'register' && (
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-primary hover:underline"
                  disabled={isLoading}
                >
                  Already have an account? Sign in
                </button>
              )}
              {mode === 'confirm' && (
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-primary hover:underline"
                  disabled={isLoading}
                >
                  Back to sign in
                </button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
