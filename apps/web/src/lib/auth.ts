/**
 * Authentication utilities for AWS Cognito
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  SignUpCommand,
  ConfirmSignUpCommand,
  GlobalSignOutCommand,
  GetUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env['NEXT_PUBLIC_COGNITO_REGION'] || 'us-east-1',
});

const CLIENT_ID = process.env['NEXT_PUBLIC_COGNITO_CLIENT_ID'] || '';

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface User {
  userId: string;
  email: string;
  emailVerified: boolean;
}

/**
 * Sign up a new user
 * Note: Since the User Pool has email as a sign-in alias, we let Cognito
 * auto-generate the username and use email for authentication
 */
export async function signUp(
  email: string,
  password: string,
): Promise<{ userSub: string; username: string }> {
  // Generate a unique username (required when using email aliases)
  const username = `user_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const command = new SignUpCommand({
    ClientId: CLIENT_ID,
    Username: username,
    Password: password,
    UserAttributes: [
      {
        Name: 'email',
        Value: email,
      },
    ],
  });

  const response = await cognitoClient.send(command);

  // Store username temporarily for confirmation
  if (typeof window !== 'undefined') {
    localStorage.setItem(`cognito_username_${email}`, username);
  }

  return { userSub: response.UserSub || '', username };
}

/**
 * Confirm sign up with verification code
 * Note: We need to use the actual username that was generated during signup
 */
export async function confirmSignUp(email: string, code: string): Promise<void> {
  // Retrieve the username that was stored during signup
  let username = email;
  if (typeof window !== 'undefined') {
    username = localStorage.getItem(`cognito_username_${email}`) || email;
  }

  const command = new ConfirmSignUpCommand({
    ClientId: CLIENT_ID,
    Username: username, // Use the generated username
    ConfirmationCode: code,
  });

  await cognitoClient.send(command);

  // Clean up stored username after successful confirmation
  if (typeof window !== 'undefined') {
    localStorage.removeItem(`cognito_username_${email}`);
  }
}

/**
 * Sign in with email and password
 */
export async function signIn(email: string, password: string): Promise<AuthTokens> {
  const command = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  const response = await cognitoClient.send(command);

  if (!response.AuthenticationResult) {
    throw new Error('Authentication failed');
  }

  const expiresIn = response.AuthenticationResult.ExpiresIn || 3600;

  return {
    idToken: response.AuthenticationResult.IdToken || '',
    accessToken: response.AuthenticationResult.AccessToken || '',
    refreshToken: response.AuthenticationResult.RefreshToken || '',
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Refresh authentication tokens
 */
export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const command = new InitiateAuthCommand({
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  });

  const response = await cognitoClient.send(command);

  if (!response.AuthenticationResult) {
    throw new Error('Token refresh failed');
  }

  const expiresIn = response.AuthenticationResult.ExpiresIn || 3600;

  return {
    idToken: response.AuthenticationResult.IdToken || '',
    accessToken: response.AuthenticationResult.AccessToken || '',
    refreshToken: refreshToken, // Refresh token doesn't change
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

/**
 * Sign out
 */
export async function signOut(accessToken: string): Promise<void> {
  const command = new GlobalSignOutCommand({
    AccessToken: accessToken,
  });

  await cognitoClient.send(command);
}

/**
 * Get current user info
 */
export async function getCurrentUser(accessToken: string): Promise<User> {
  const command = new GetUserCommand({
    AccessToken: accessToken,
  });

  const response = await cognitoClient.send(command);

  const email =
    response.UserAttributes?.find((attr) => attr.Name === 'email')?.Value || '';
  const emailVerified =
    response.UserAttributes?.find((attr) => attr.Name === 'email_verified')?.Value ===
    'true';

  return {
    userId: response.Username || '',
    email,
    emailVerified,
  };
}

/**
 * Storage utilities for tokens
 */
export const tokenStorage = {
  save: (tokens: AuthTokens) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_tokens', JSON.stringify(tokens));
    }
  },

  get: (): AuthTokens | null => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('auth_tokens');
      return stored ? JSON.parse(stored) : null;
    }
    return null;
  },

  clear: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_tokens');
    }
  },

  isValid: (tokens: AuthTokens): boolean => {
    return tokens.expiresAt > Date.now() + 60000; // Check if expires in more than 1 minute
  },
};
