// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionRuntimeKek } from '../provision-runtime-kek.mjs';

test('provisions an AWS runtime KEK using only canonical KMS configuration', async () => {
  const runtimeKek = Buffer.alloc(32, 7);
  let received;
  const output = await provisionRuntimeKek({
    env: {
      KMS_PROVIDER: 'aws',
      KMS_REGION: 'ca-central-1',
      KMS_KEY_ID: 'alias/gw-production',
      KMS_RUNTIME_KEK_ID: 'gw-production',
    },
    randomBytes: () => runtimeKek,
    awsEncrypt: async (keyId, plaintext, context, region) => {
      received = { keyId, plaintext: Buffer.from(plaintext), context, region };
      return 'aws-ciphertext';
    },
  });

  assert.equal(output, 'KMS_RUNTIME_KEK_CIPHERTEXT=aws-ciphertext');
  assert.equal(received.keyId, 'alias/gw-production');
  assert.equal(received.region, 'ca-central-1');
  assert.deepEqual(received.context, {
    entityVaultId: 'gw-production',
    purpose: 'service-runtime-kek-v1',
  });
  assert.deepEqual(received.plaintext, Buffer.alloc(32, 7));
  assert.deepEqual(runtimeKek, Buffer.alloc(32));
});

test('rejects AWS_REGION as a KMS_REGION fallback', async () => {
  await assert.rejects(provisionRuntimeKek({
    env: {
      KMS_PROVIDER: 'aws',
      AWS_REGION: 'ca-central-1',
      KMS_KEY_ID: 'alias/gw-production',
      KMS_RUNTIME_KEK_ID: 'gw-production',
    },
    randomBytes: () => Buffer.alloc(32, 7),
    awsEncrypt: async () => 'must-not-run',
  }), /KMS_REGION is required/);
});

test('provisions a HashiCorp Transit runtime KEK through the same provider-neutral configuration', async () => {
  let received;
  const output = await provisionRuntimeKek({
    env: {
      KMS_PROVIDER: 'hashicorp-transit',
      KMS_KEY_ID: 'gw-envelope',
      KMS_RUNTIME_KEK_ID: 'gw-production',
      HASHICORP_TRANSIT_BASE_URL: 'https://vault.example.com',
      HASHICORP_TRANSIT_TOKEN: 'test-token',
    },
    randomBytes: () => Buffer.alloc(32, 5),
    transitEncrypt: async (options) => {
      received = options;
      return 'vault:v1:runtime-kek';
    },
  });

  assert.equal(output, 'KMS_RUNTIME_KEK_CIPHERTEXT=vault:v1:runtime-kek');
  assert.equal(received.keyId, 'gw-envelope');
  assert.deepEqual(received.context, {
    entityVaultId: 'gw-production',
    purpose: 'service-runtime-kek-v1',
  });
});

test('keeps the deprecated GCP names only as migration aliases', async () => {
  const output = await provisionRuntimeKek({
    env: {
      ENVELOPE_PROVIDER: 'gcp-kms',
      GCP_KMS_KEY_NAME: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
      GCP_KMS_RUNTIME_KEK_ID: 'legacy-gw',
    },
    randomBytes: () => Buffer.alloc(32, 3),
    gcpEncrypt: async () => 'gcp-ciphertext',
  });

  assert.equal(output, 'KMS_RUNTIME_KEK_CIPHERTEXT=gcp-ciphertext');
});
