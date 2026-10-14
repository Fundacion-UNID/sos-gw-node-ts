export type GwDeploymentProfileStagingReport = {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalized: {
    nodeEnv: string;
    securityMode: string;
    networkMode: string;
    dbProvider: string;
    storageProvider: string;
    queueProvider: string;
    kmsProvider: string;
  };
};

/**
 * Validates one staging/prod deployment profile for VetChain GW.
 *
 * The goal is operational clarity before a GKE rollout:
 * - hard errors block deployment
 * - warnings document degraded but still bootable combinations
 *
 * The function is pure so it can be reused from tests, docs tooling, and small
 * operator scripts without importing the whole runtime.
 */
export function buildGwDeploymentProfileStagingReport(
  env: Record<string, string | undefined>,
): GwDeploymentProfileStagingReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const nodeEnv = read(env.NODE_ENV, 'development').toLowerCase();
  const securityMode = read(env.SECURITY_MODE, 'strict').toLowerCase();
  const networkMode = read(env.NETWORK_MODE, nodeEnv === 'production' ? 'network' : 'test-network').toLowerCase();
  const dbProvider = read(env.DB_PROVIDER, 'mem').toLowerCase();
  const storageProvider = read(env.STORAGE_PROVIDER, 'mem').toLowerCase();
  const queueProvider = read(env.QUEUE_PROVIDER, 'mem').toLowerCase();
  const kmsProvider = normalizeKmsProvider(read(env.KMS_PROVIDER, read(env.ENVELOPE_PROVIDER, 'memory')).toLowerCase());
  const legacyGcp = kmsProvider === 'gcp';
  const kmsKeyId = read(env.KMS_KEY_ID, legacyGcp ? read(env.GCP_KMS_KEY_NAME) : '');
  const runtimeKekCiphertext = read(env.KMS_RUNTIME_KEK_CIPHERTEXT, legacyGcp ? read(env.GCP_KMS_RUNTIME_KEK_CIPHERTEXT) : '');
  const runtimeKekId = read(env.KMS_RUNTIME_KEK_ID, legacyGcp ? read(env.GCP_KMS_RUNTIME_KEK_ID) : '');

  const isStagingLike = nodeEnv === 'staging' || nodeEnv === 'production';

  if (isStagingLike && securityMode === 'demo') {
    errors.push('NODE_ENV=staging|production must not use SECURITY_MODE=demo.');
  }

  if (isStagingLike && dbProvider === 'mem') {
    errors.push('DB_PROVIDER=mem is not allowed for staging/production.');
  }

  if (isStagingLike && storageProvider === 'mem') {
    errors.push('STORAGE_PROVIDER=mem is not allowed for staging/production.');
  }

  if (isStagingLike && queueProvider === 'mem') {
    errors.push('QUEUE_PROVIDER=mem is not allowed for staging/production.');
  }

  if (isStagingLike && kmsProvider === 'memory') {
    errors.push('KMS_PROVIDER=memory is not allowed for staging/production.');
  }

  if (dbProvider === 'firestore' && !read(env.FIREBASE_PROJECT_ID)) {
    errors.push('FIREBASE_PROJECT_ID is required when DB_PROVIDER=firestore.');
  }

  if (storageProvider === 'gcs' && !read(env.GCS_BUCKET_NAME)) {
    errors.push('GCS_BUCKET_NAME is required when STORAGE_PROVIDER=gcs.');
  }

  if ((kmsProvider === 'gcp' || kmsProvider === 'aws') && !kmsKeyId) {
    errors.push(`KMS_KEY_ID is required when KMS_PROVIDER=${kmsProvider}.`);
  }
  if ((kmsProvider === 'gcp' || kmsProvider === 'aws') && !runtimeKekCiphertext) {
    errors.push(`KMS_RUNTIME_KEK_CIPHERTEXT is required when KMS_PROVIDER=${kmsProvider}.`);
  }
  if ((kmsProvider === 'gcp' || kmsProvider === 'aws') && !runtimeKekId) {
    errors.push(`KMS_RUNTIME_KEK_ID is required when KMS_PROVIDER=${kmsProvider}.`);
  }
  if (kmsProvider === 'aws' && !read(env.KMS_REGION)) {
    errors.push('KMS_REGION is required when KMS_PROVIDER=aws.');
  }

  if (!read(env.HOST_PUBLIC_URL) && !read(env.HOST_EXTERNAL_DOMAIN)) {
    warnings.push('HOST_PUBLIC_URL or HOST_EXTERNAL_DOMAIN should be set so discovery and Swagger publish the correct public host.');
  }

  if (queueProvider === 'gcp-pubsub') {
    if (read(env.ASYNC_RESPONSE_STORE_PROVIDER).toLowerCase() !== 'firestore') {
      errors.push('ASYNC_RESPONSE_STORE_PROVIDER=firestore is required when QUEUE_PROVIDER=gcp-pubsub.');
    }
    for (const name of ['ASYNC_RESPONSE_FIRESTORE_COLLECTION', 'GCP_PUBSUB_TOPIC', 'GCP_PUBSUB_SUBSCRIPTION', 'GCP_PUBSUB_JOB_BUCKET']) {
      if (!read(env[name])) errors.push(`${name} is required when QUEUE_PROVIDER=gcp-pubsub.`);
    }
  }

  if (read(env.CALL_VOICE_ENABLED, 'false').toLowerCase() === 'true' && !read(env.TWILIO_ACCOUNT_SID)) {
    warnings.push('CALL_VOICE_ENABLED=true but TWILIO_ACCOUNT_SID is empty.');
  }

  if (read(env.CALL_VOICE_ENABLED, 'false').toLowerCase() === 'true' && !read(env.TWILIO_AUTH_TOKEN)) {
    warnings.push('CALL_VOICE_ENABLED=true but TWILIO_AUTH_TOKEN is empty.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    normalized: {
      nodeEnv,
      securityMode,
      networkMode,
      dbProvider,
      storageProvider,
      queueProvider,
      kmsProvider,
    },
  };
}

/**
 * Reads one environment variable into a trimmed string with fallback.
 */
function read(value: string | undefined, fallback = ''): string {
  return String(value ?? fallback).trim();
}

function normalizeKmsProvider(value: string): string {
  if (value === 'gcp-kms') return 'gcp';
  return value;
}
