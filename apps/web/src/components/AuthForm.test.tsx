/**
 * Tests for AuthForm component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthForm } from './AuthForm';
import React from 'react';

// Mock the AuthContext
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockConfirmEmail = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
    confirmEmail: mockConfirmEmail,
    user: null,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

describe('AuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render login form by default', () => {
    render(<AuthForm />);

    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should switch to register mode', () => {
    render(<AuthForm />);

    const registerButton = screen.getByText(/don't have an account/i).closest('button');
    if (registerButton) {
      fireEvent.click(registerButton);
    }

    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('should handle login submission', async () => {
    mockLogin.mockResolvedValue(undefined);
    render(<AuthForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('should handle registration submission', async () => {
    mockRegister.mockResolvedValue({ userSub: 'user-123' });
    render(<AuthForm />);

    // Switch to register mode
    const signUpButton = screen.getByText(/don't have an account/i).closest('button');
    if (signUpButton) {
      fireEvent.click(signUpButton);
    }

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });

    fireEvent.change(emailInput, { target: { value: 'newuser@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('newuser@example.com', 'password123');
    });
  });

  it('should display error messages', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    render(<AuthForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });

  it('should show loading state during submission', async () => {
    mockLogin.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    render(<AuthForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    // Check for loading spinner
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /sign in/i });
      expect(button).toBeDisabled();
    });
  });

  it('should handle confirm email mode', async () => {
    mockRegister.mockResolvedValue({ userSub: 'user-123' });
    mockConfirmEmail.mockResolvedValue(undefined);
    render(<AuthForm />);

    // Switch to register mode
    const signUpButton = screen.getByText(/don't have an account/i).closest('button');
    if (signUpButton) {
      fireEvent.click(signUpButton);
    }

    // Register
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    // Should switch to confirm mode
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /confirm email/i })).toBeInTheDocument();
    });
  });

  it('should handle login submission', async () => {
    mockLogin.mockResolvedValue(undefined);
    render(<AuthForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('should handle registration submission', async () => {
    mockRegister.mockResolvedValue({ userSub: 'user-123' });
    render(<AuthForm />);

    // Switch to register mode
    const signUpButton = screen.getByText(/don't have an account/i).closest('button');
    if (signUpButton) {
      fireEvent.click(signUpButton);
    }

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });

    fireEvent.change(emailInput, { target: { value: 'newuser@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith('newuser@example.com', 'password123');
    });
  });

  it('should display error messages', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid credentials'));
    render(<AuthForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });
  });

  it('should show loading state during submission', async () => {
    mockLogin.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    render(<AuthForm />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    // Check for loading spinner
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /sign in/i });
      expect(button).toBeDisabled();
    });
  });

  it('should handle confirm email mode', async () => {
    mockRegister.mockResolvedValue({ userSub: 'user-123' });
    mockConfirmEmail.mockResolvedValue(undefined);
    render(<AuthForm />);

    // Switch to register mode
    const signUpButton = screen.getByText(/don't have an account/i).closest('button');
    if (signUpButton) {
      fireEvent.click(signUpButton);
    }

    // Register
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    // Should switch to confirm mode
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /confirm email/i })).toBeInTheDocument();
    });
  });
});
