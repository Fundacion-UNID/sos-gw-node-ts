import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { GoogleAuth } from 'google-auth-library';

export async function provisionRuntimeKek(options = {}) {
  const env = options.env || process.env;
  const provider = normalizeProvider(required(env, 'KMS_PROVIDER', ['ENVELOPE_PROVIDER']));
  const keyId = required(env, 'KMS_KEY_ID', provider === 'gcp'
    ? ['GCP_KMS_KEY_NAME']
    : provider === 'hashicorp-transit' ? ['HASHICORP_TRANSIT_KEY_NAME'] : []);
  const runtimeKekId = required(env, 'KMS_RUNTIME_KEK_ID', provider === 'gcp' ? ['GCP_KMS_RUNTIME_KEK_ID'] : []);
  const runtimeKek = (options.randomBytes || randomBytes)(32);
  const context = { entityVaultId: runtimeKekId, purpose: 'service-runtime-kek-v1' };

  try {
    let ciphertext;
    if (provider === 'gcp') {
      ciphertext = await (options.gcpEncrypt || encryptWithGoogleKms)(keyId, runtimeKek, context);
    } else if (provider === 'aws') {
      const region = required(env, 'KMS_REGION');
      ciphertext = await (options.awsEncrypt || encryptWithAwsKms)(keyId, runtimeKek, context, region);
    } else if (provider === 'hashicorp-transit') {
      ciphertext = await (options.transitEncrypt || encryptWithHashicorpTransit)({
        baseUrl: required(env, 'HASHICORP_TRANSIT_BASE_URL'),
        mountPath: String(env.HASHICORP_TRANSIT_MOUNT_PATH || 'transit').trim(),
        keyId,
        token: required(env, 'HASHICORP_TRANSIT_TOKEN'),
        namespace: String(env.HASHICORP_NAMESPACE || '').trim(),
        plaintext: runtimeKek,
        context,
      });
    } else {
      throw new Error('Runtime KEK provisioning supports KMS_PROVIDER=gcp, aws, or hashicorp-transit.');
    }
    return `KMS_RUNTIME_KEK_CIPHERTEXT=${ciphertext}`;
  } finally {
    runtimeKek.fill(0);
  }
}

async function encryptWithGoogleKms(keyId, runtimeKek, context) {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const access = await client.getAccessToken();
  const token = typeof access === 'string' ? access : access?.token;
  if (!token) throw new Error('Google authentication returned no access token.');
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${keyId}:encrypt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plaintext: runtimeKek.toString('base64'),
      additionalAuthenticatedData: Buffer.from(JSON.stringify(context)).toString('base64'),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.ciphertext) throw new Error(body?.error?.message || `Cloud KMS encrypt failed (${response.status}).`);
  return body.ciphertext;
}

async function encryptWithAwsKms(keyId, runtimeKek, context, region) {
  const response = await new KMSClient({ region }).send(new EncryptCommand({
    KeyId: keyId,
    Plaintext: runtimeKek,
    EncryptionContext: context,
  }));
  if (!response.CiphertextBlob) throw new Error('AWS KMS encrypt response did not include CiphertextBlob.');
  return Buffer.from(response.CiphertextBlob).toString('base64');
}

async function encryptWithHashicorpTransit(options) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const mountPath = options.mountPath.replace(/^\/+|\/+$/g, '');
  const headers = {
    'Content-Type': 'application/json',
    'X-Vault-Token': options.token,
  };
  if (options.namespace) headers['X-Vault-Namespace'] = options.namespace;
  const response = await fetch(`${baseUrl}/v1/${mountPath}/encrypt/${options.keyId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      plaintext: Buffer.from(options.plaintext).toString('base64'),
      context: Buffer.from(JSON.stringify(options.context)).toString('base64'),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body?.data?.ciphertext) {
    throw new Error(body?.errors?.join('; ') || `HashiCorp Transit encrypt failed (${response.status}).`);
  }
  return body.data.ciphertext;
}

function normalizeProvider(value) {
  if (value === 'gcp-kms') return 'gcp';
  return value;
}

function required(env, name, aliases = []) {
  for (const candidate of [name, ...aliases]) {
    const value = String(env[candidate] || '').trim();
    if (value) return value;
  }
  throw new Error(`${name} is required.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(await provisionRuntimeKek());
}
