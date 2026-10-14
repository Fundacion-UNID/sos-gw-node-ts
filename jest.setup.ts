// jest.setup.ts
import * as dotenv from 'dotenv';
import * as path from 'path';
const setupDir = process.cwd();

// Load environment variables based on the test script being run.
// `npm run test:e2e` will set `process.env.TEST_ENV` to `e2e`.
if (process.env.TEST_ENV === 'e2e') {
  const envFile = process.env.JEST_ENV_FILE || '.env.demo';
  const envPath = path.resolve(setupDir, envFile);
  const result = dotenv.config({ path: envPath, override: true });
  
  if (result.error) {
    console.error(`Jest setup: ERROR loading ${envFile}`, result.error);
  } else {
    console.log(`Jest setup: Loaded ${envFile} for E2E tests. Found ${Object.keys(result.parsed || {}).length} variables.`);
  }
} else {
  // For all other tests, optionally load the canonical local demo profile if it exists.
  dotenv.config({ path: path.resolve(setupDir, '.env.demo') });
}

/* eslint-disable no-undef */

import * as globals from '@jest/globals';

// Re-expose Jest APIs as globals so old tests keep working
Object.assign(globalThis, globals);

// Defaults for integration tests that call `startServer()` directly.
// These are intentionally minimal and only applied when not provided by the environment.
process.env.NODE_ENV ??= 'test';
process.env.DB_PROVIDER ??= 'mem';
process.env.STORAGE_PROVIDER ??= 'mem';
process.env.QUEUE_PROVIDER ??= 'mem';
process.env.MAINSECTOR ??= 'health';
process.env.SUBSECTORSALLOWED ??= 'research,care,index';
if (process.env.TEST_ENV !== 'e2e') {
  // The Vet local profile is animal-only, while the inherited CORE regression
  // suite deliberately exercises both human and animal sectors. Make that
  // cross-product test contract explicit instead of relying on deprecated
  // MAINSECTOR/SECTORS_ALLOWED values that canonical ALLOWED_SECTORS overrides.
  process.env.ALLOWED_SECTORS = Array.from(new Set([
    ...String(process.env.ALLOWED_SECTORS || '').split(','),
    'health-care',
    'health-research',
    'health-index',
  ].map((value) => value.trim()).filter(Boolean))).join(',');

  // Unit/integration fixtures set the historical ORG_HOST_* identity before
  // starting their isolated server. Do not let the product's local Vet host
  // profile silently override that synthetic fixture through HOST_* precedence.
  for (const key of [
    'HOST_LEGAL_NAME',
    'HOST_JURISDICTION',
    'HOST_ID_TYPE',
    'HOST_ID_VALUE',
    'HOST_ADMIN_EMAIL',
    'HOST_ADMIN_UID',
    'HOST_ADMIN_ROLE',
  ]) {
    delete process.env[key];
  }
}

process.env.ORG_HOST_LEGAL_NAME ??= 'Gateway Host Services';
process.env.ORG_HOST_JURISDICTION ??= 'ES';
process.env.ORG_HOST_ID_TYPE ??= 'TAX';
process.env.ORG_HOST_ID_VALUE ??= 'A0011223344';
process.env.ORG_HOST_ADMIN_EMAIL ??= 'admin@host.com';
process.env.ORG_HOST_ADMIN_UID ??= 'host-admin-001';
process.env.ORG_HOST_ADMIN_ROLE ??= 'ISCO-08|1111';

jest.setTimeout(65000); // in milliseconds
