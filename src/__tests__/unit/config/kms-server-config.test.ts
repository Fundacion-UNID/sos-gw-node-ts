// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { getConfig, resetServerConfig } from '../../../config/server-config';

describe('provider-neutral KMS server configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    resetServerConfig();
  });

  it('maps the canonical AWS KMS variables', () => {
    process.env = {
      ...originalEnv,
      KMS_PROVIDER: 'aws',
      KMS_REGION: 'ca-central-1',
      KMS_KEY_ID: 'alias/gw-production',
      KMS_RUNTIME_KEK_CIPHERTEXT: 'kms-ciphertext',
      KMS_RUNTIME_KEK_ID: 'gw-production',
    };
    resetServerConfig();

    expect(getConfig().kms).toEqual({
      provider: 'aws',
      region: 'ca-central-1',
      keyId: 'alias/gw-production',
      runtimeKekCiphertext: 'kms-ciphertext',
      runtimeKekId: 'gw-production',
    });
  });

  it('does not consume AWS_REGION as a KMS_REGION fallback', () => {
    process.env = { ...originalEnv, KMS_PROVIDER: 'aws', AWS_REGION: 'ca-central-1' };
    resetServerConfig();

    expect(getConfig().kms).toMatchObject({ provider: 'aws', region: undefined });
  });
});
