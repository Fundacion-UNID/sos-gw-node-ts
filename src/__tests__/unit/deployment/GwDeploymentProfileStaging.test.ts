// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { buildGwDeploymentProfileStagingReport } from '../../../deployment/GwDeploymentProfileStaging';

const BASE_STAGING_ENV = {
  NODE_ENV: 'staging',
  SECURITY_MODE: 'strict',
  NETWORK_MODE: 'test-network',
  DB_PROVIDER: 'firestore',
  STORAGE_PROVIDER: 'gcs',
  QUEUE_PROVIDER: 'gcp-pubsub',
  ASYNC_RESPONSE_STORE_PROVIDER: 'firestore',
  ASYNC_RESPONSE_FIRESTORE_COLLECTION: 'vetchain_async_responses_staging',
  GCP_PUBSUB_TOPIC: 'vetchain-gw-jobs-staging',
  GCP_PUBSUB_SUBSCRIPTION: 'vetchain-gw-jobs-staging-worker',
  GCP_PUBSUB_JOB_BUCKET: 'gw-unid-staging-bucket',
  KMS_PROVIDER: 'gcp',
  FIREBASE_PROJECT_ID: 'gw-staging-project',
  GCS_BUCKET_NAME: 'gw-unid-staging-bucket',
  KMS_KEY_ID: 'projects/example/locations/us-central1/keyRings/gw/cryptoKeys/staging',
  KMS_RUNTIME_KEK_CIPHERTEXT: 'kms-ciphertext',
  KMS_RUNTIME_KEK_ID: 'gw-vet-staging',
  HOST_PUBLIC_URL: 'https://gw-unid-staging.example.org',
  CALL_VOICE_ENABLED: 'true',
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_AUTH_TOKEN: 'secret',
} as const;

describe('GwDeploymentProfileStaging', () => {
  it('accepts one complete staging profile for VetChain GW', () => {
    const report = buildGwDeploymentProfileStagingReport(BASE_STAGING_ENV);

    expect(report.isValid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.normalized.nodeEnv).toBe('staging');
    expect(report.normalized.dbProvider).toBe('firestore');
    expect(report.warnings).not.toContain(expect.stringContaining('QUEUE_PROVIDER'));
  });

  it('rejects insecure or ephemeral staging combinations', () => {
    const report = buildGwDeploymentProfileStagingReport({
      ...BASE_STAGING_ENV,
      SECURITY_MODE: 'demo',
      DB_PROVIDER: 'mem',
      STORAGE_PROVIDER: 'mem',
      QUEUE_PROVIDER: 'mem',
      KMS_PROVIDER: 'memory',
      FIREBASE_PROJECT_ID: '',
      GCS_BUCKET_NAME: '',
      KMS_KEY_ID: '',
    });

    expect(report.isValid).toBe(false);
    expect(report.errors).toContain('NODE_ENV=staging|production must not use SECURITY_MODE=demo.');
    expect(report.errors).toContain('DB_PROVIDER=mem is not allowed for staging/production.');
    expect(report.errors).toContain('STORAGE_PROVIDER=mem is not allowed for staging/production.');
    expect(report.errors).toContain('QUEUE_PROVIDER=mem is not allowed for staging/production.');
    expect(report.errors).toContain('KMS_PROVIDER=memory is not allowed for staging/production.');
  });

  it('warns when public host or telephony secrets are incomplete', () => {
    const report = buildGwDeploymentProfileStagingReport({
      ...BASE_STAGING_ENV,
      HOST_PUBLIC_URL: '',
      HOST_EXTERNAL_DOMAIN: '',
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
    });

    expect(report.isValid).toBe(true);
    expect(report.warnings).toContain(
      'HOST_PUBLIC_URL or HOST_EXTERNAL_DOMAIN should be set so discovery and Swagger publish the correct public host.',
    );
    expect(report.warnings).toContain('CALL_VOICE_ENABLED=true but TWILIO_ACCOUNT_SID is empty.');
    expect(report.warnings).toContain('CALL_VOICE_ENABLED=true but TWILIO_AUTH_TOKEN is empty.');
  });

  it('requires the canonical region for an AWS KMS deployment', () => {
    const report = buildGwDeploymentProfileStagingReport({
      ...BASE_STAGING_ENV,
      KMS_PROVIDER: 'aws',
      KMS_REGION: '',
      AWS_REGION: 'ca-central-1',
      KMS_KEY_ID: 'alias/gw-production',
    });

    expect(report.isValid).toBe(false);
    expect(report.errors).toContain('KMS_REGION is required when KMS_PROVIDER=aws.');
  });
});
