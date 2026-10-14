// src/__tests__/utils/auth.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Authenticates a test user against the Firebase Auth REST API to get a valid ID token.
 * This function reads the API key from environment variables.
 *
 * @param {string} email The test user's email.
 * @param {string} password The test user's password.
 * @returns {Promise<string>} A promise that resolves to the Firebase ID token.
 * @throws {Error} If the API key is missing or if authentication fails.
 */
export async function getGoogleAuthTokenForTesting(email: string, password: string): Promise<string> {
  const apiKey = process.env.FIREBASE_API_KEY;

  if (!apiKey) {
    throw new Error('Missing required environment variable for E2E authentication: FIREBASE_API_KEY.');
  }
  if (!email || !password) {
    throw new Error('Email and password must be provided to get an auth token.');
  }

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data.error?.message || 'Unknown Firebase Auth error';
      throw new Error(`Firebase authentication failed: ${error}`);
    }

    if (!data.idToken) {
      throw new Error('Firebase authentication succeeded, but no idToken was returned.');
    }

    return data.idToken;
  } catch (error) {
    console.error('Error fetching auth token:', error);
    throw error;
  }
}
