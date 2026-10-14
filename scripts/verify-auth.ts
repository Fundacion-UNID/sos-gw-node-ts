// scripts/verify-auth.ts
// A standalone diagnostic script to verify Firebase client authentication credentials.
// This helps isolate login issues from the Jest test runner environment.

import * as dotenv from 'dotenv';
import * as path from 'path';

/**
 * The main function to execute the credential verification process.
 */
async function verifyFirebaseCredentials() {
  console.log('--- Starting Firebase Credential Verification Script ---');

  // --- 1. Load Environment Variables ---
  // The goal is to replicate the exact environment loading mechanism used by the E2E tests.
  const envFile = process.env.JEST_ENV_FILE || '.env.demo';
  const envPath = path.resolve(__dirname, `../${envFile}`);
  const result = dotenv.config({ path: envPath, override: true });

  if (result.error) {
    console.error(`🔴 FATAL: Could not load the ${envFile} file from path: ${envPath}`, result.error);
    return;
  }
  console.log(`✅ Successfully loaded ${envFile}.`);

  // --- 2. Read and Validate Credentials ---
  const apiKey = process.env.FIREBASE_API_KEY;
  const email = process.env.DEMO_ORG1_ADMIN_EMAIL;
  const password = process.env.DEMO_ORG1_ADMIN_EMAIL_PASSWORD;

  console.log(`- API Key found: ${!!apiKey}`);
  console.log(`- Email found: ${!!email} (Value: ${email})`);
  console.log(`- Password found: ${!!password}`);

  if (!apiKey || !email || !password) {
    console.error('🔴 FATAL: One or more required variables (FIREBASE_API_KEY, DEMO_ORG1_ADMIN_EMAIL, DEMO_ORG1_ADMIN_EMAIL_PASSWORD) are missing in the environment.');
    return;
  }

  // --- 3. Attempt to Authenticate ---
  const authUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  console.log('\nAttempting to sign in...');

  try {
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true,
      }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      const errorMessage = responseData.error?.message || 'Unknown Firebase error.';
      console.error(`🔴 AUTHENTICATION FAILED. Firebase responded with error: ${errorMessage}`);
    } else if (responseData.idToken) {
      console.log('✅ AUTHENTICATION SUCCESSFUL!');
      console.log(`- Received ID Token (first 10 chars): ${responseData.idToken.substring(0, 10)}...`);
    } else {
      console.error('🔴 AUTHENTICATION FAILED: The request was successful, but no idToken was returned.');
    }
  } catch (error) {
    console.error('🔴 FATAL: A network or other unexpected error occurred during the fetch call.', error);
  } finally {
    console.log('\n--- Verification Script Finished ---');
  }
}

// Execute the script
verifyFirebaseCredentials();
