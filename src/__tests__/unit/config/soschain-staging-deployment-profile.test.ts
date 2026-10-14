// Flow contract: public SOSChain deployment examples describe required fields without disclosing any real environment inventory, identity, endpoint or credential.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXAMPLE_DIRECTORY = 'deploy/profiles/soschain/staging';
const TARGET_SPECIFIC_KEYS = [
  'GCP_PROJECT_ID',
  'GKE_CLUSTER',
  'KUBE_CONTEXT',
  'K8S_NAMESPACE_GDC',
  'GDC_RESOURCE_NAME',
  'GDC_SECRET_NAME',
  'GDC_IMAGE',
  'GDC_PUBLIC_URL',
  'GDC_STATIC_IP_NAME',
  'GDC_GSA_EMAIL',
  'GDC_TLS_HOST',
  'GDC_FABRIC_PEER_TARGET',
  'LEDGER_MSP_ID',
  'LEDGER_FABRIC_MSP_ID',
  'HOST_STORAGE_SCOPE',
  'FIREBASE_PROJECT_ID',
  'HOST_LEGAL_NAME',
  'HOST_ID_VALUE',
  'HOST_ADMIN_EMAIL',
  'HOST_PUBLIC_URL',
  'HOST_EXTERNAL_DOMAIN',
  'GCS_BUCKET_NAME',
  'GCP_PUBSUB_PROJECT_ID',
  'GCP_PUBSUB_TOPIC',
  'GCP_PUBSUB_SUBSCRIPTION',
  'GCP_PUBSUB_JOB_BUCKET',
  'KMS_KEY_ID',
  'KMS_RUNTIME_KEK_ID',
  'ICA_URL_EXTERNAL',
] as const;

const readExample = (name: string): string =>
  readFileSync(resolve(process.cwd(), EXAMPLE_DIRECTORY, name), 'utf8');
const readGenericStaging = (): string =>
  readFileSync(resolve(process.cwd(), 'env.staging.example'), 'utf8');

describe('public SOSChain staging deployment examples', () => {
  it('uses placeholders for target-specific GKE assignments', () => {
    const assignments = new Map(
      readExample('gke.config.example')
        .split('\n')
        .map((line) => line.replace(/^export\s+/, ''))
        .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)] as const;
        }),
    );

    for (const key of TARGET_SPECIFIC_KEYS) {
      const value = assignments.get(key);
      if (value !== undefined) expect(value).toContain('replace-with-');
    }
  });

  it('keeps every target-specific GKE value as an explicit placeholder', () => {
    const target = readExample('gke.config.example');

    expect(target).toContain('GCP_PROJECT_ID=replace-with-gcp-project-id');
    expect(target).toContain('GKE_CLUSTER=replace-with-staging-cluster');
    expect(target).toContain('K8S_NAMESPACE_GDC=replace-with-staging-namespace');
    expect(target).toContain('GDC_PUBLIC_URL=https://replace-with-staging-gateway-host');
    expect(target).toContain('GDC_GSA_EMAIL=replace-with-service-account@replace-with-gcp-project-id.iam.gserviceaccount.com');
    expect(target).toContain('LEDGER_MSP_ID=replace-with-staging-msp-id');
  });

  it('documents persistent staging providers without publishing their resource names', () => {
    const runtime = readGenericStaging();

    expect(runtime).toContain('NETWORK_MODE=test-network');
    expect(runtime).toContain('SECURITY_MODE=strict');
    expect(runtime).toContain('DB_PROVIDER=firestore');
    expect(runtime).toContain('STORAGE_PROVIDER=gcs');
    expect(runtime).toContain('QUEUE_PROVIDER=mem');
    expect(runtime).toContain('GCS_BUCKET_NAME=example-bucket');
    expect(runtime).toContain('KMS_KEY_ID=projects/replace-me/');
    expect(runtime).not.toMatch(/^HOST_LEGACY_PHYSICAL_COLLECTION=.+$/m);
  });

  it('contains no secret values or secret-shaped placeholders', () => {
    const combined = [readExample('gke.config.example'), readGenericStaging()].join('\n');

    expect(combined).not.toMatch(/^(?:.*(?:PASSWORD|PRIVATE_KEY|AUTH_TOKEN|CIPHERTEXT|CLIENT_SECRET))=.+$/m);
  });
});
