import type { IServerConfig } from '../config';
import {
  AesGcmEnvelopeAdapter,
  KmsEnvelopeAdapterAws,
  CloudKmsEnvelopeAdapter,
  HashicorpTransitEnvelopeAdapter,
  InMemoryEnvelopeAdapter,
  RuntimeKekEnvelopeAdapter,
  type KmsEnvelopeAdapter,
} from './kms-envelope-adapter';

export type KmsProvider = 'memory' | 'local' | 'gcp' | 'aws' | 'hashicorp-transit';

export function resolveKmsProvider(config: IServerConfig): KmsProvider {
  if (config.kms?.provider) return config.kms.provider;
  if (config.envelope?.provider) {
    if (config.envelope.provider === 'gcp-kms') return 'gcp';
    return config.envelope.provider;
  }
  if (config.kekSecret) {
    return 'local';
  }
  return 'memory';
}

function assertProductionCustody(config: IServerConfig, provider: KmsProvider): void {
  if (config.nodeEnv !== 'production') return;
  if (provider === 'memory' || provider === 'local') {
    throw new Error(
      `NODE_ENV=production requires external KMS custody; KMS_PROVIDER=${provider} is not permitted. Use gcp, aws, or hashicorp-transit.`,
    );
  }
}

export async function createEnvelopeAdapter(
  config: IServerConfig,
  deps: { rootAdapter?: KmsEnvelopeAdapter } = {},
): Promise<{
  adapter: KmsEnvelopeAdapter;
  provider: KmsProvider;
}> {
  const provider = resolveKmsProvider(config);
  assertProductionCustody(config, provider);

  if (provider === 'memory') {
    return { adapter: new InMemoryEnvelopeAdapter(), provider };
  }

  if (provider === 'local') {
    if (!config.kekSecret) {
      throw new Error('KMS_PROVIDER=local requires KEK_SECRET.');
    }
    return { adapter: new AesGcmEnvelopeAdapter(config.kekSecret), provider };
  }

  if (provider === 'gcp' || provider === 'aws' || provider === 'hashicorp-transit') {
    const legacyGcp = provider === 'gcp' ? config.gcpKms : undefined;
    const legacyTransit = provider === 'hashicorp-transit' ? config.hashicorpTransit : undefined;
    const keyId = String(config.kms?.keyId || legacyGcp?.keyName || legacyTransit?.keyName || '').trim();
    if (!keyId) throw new Error(`KMS_PROVIDER=${provider} requires KMS_KEY_ID.`);
    if (provider === 'gcp' && !/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(keyId)) {
      throw new Error('KMS_PROVIDER=gcp requires KMS_KEY_ID as a full CryptoKey resource name (without a CryptoKeyVersion suffix).');
    }
    const runtimeKekCiphertext = String(config.kms?.runtimeKekCiphertext || legacyGcp?.runtimeKekCiphertext || '').trim();
    const runtimeKekId = String(config.kms?.runtimeKekId || legacyGcp?.runtimeKekId || '').trim();
    if (!runtimeKekCiphertext || !runtimeKekId) {
      throw new Error(`KMS_PROVIDER=${provider} requires KMS_RUNTIME_KEK_CIPHERTEXT and KMS_RUNTIME_KEK_ID.`);
    }
    const region = String(config.kms?.region || '').trim();
    if (provider === 'aws' && !region) {
      throw new Error('KMS_PROVIDER=aws requires KMS_REGION. AWS_REGION and AWS_DEFAULT_REGION are not supported aliases.');
    }
    const rootAdapter = deps.rootAdapter || buildExternalRootAdapter(config, provider, keyId, region);
    const runtimeKek = await rootAdapter.unwrapKeyMaterial(runtimeKekCiphertext, {
      entityVaultId: runtimeKekId,
      purpose: 'service-runtime-kek-v1',
    });
    try {
      return { adapter: new RuntimeKekEnvelopeAdapter(runtimeKek, rootAdapter), provider };
    } finally {
      Buffer.from(runtimeKek.buffer, runtimeKek.byteOffset, runtimeKek.byteLength).fill(0);
    }
  }

  throw new Error(`Unsupported KMS provider: ${provider}`);
}

function buildExternalRootAdapter(
  config: IServerConfig,
  provider: 'gcp' | 'aws' | 'hashicorp-transit',
  keyId: string,
  region: string,
): KmsEnvelopeAdapter {
  if (provider === 'gcp') return new CloudKmsEnvelopeAdapter(keyId);
  if (provider === 'aws') return new KmsEnvelopeAdapterAws(keyId, { region });

  const baseUrl = String(config.hashicorpTransit?.baseUrl || '').trim();
  const token = String(config.hashicorpTransit?.token || '').trim();
  if (!baseUrl || !token) {
    throw new Error(
      'KMS_PROVIDER=hashicorp-transit requires HASHICORP_TRANSIT_BASE_URL and HASHICORP_TRANSIT_TOKEN.',
    );
  }
  return new HashicorpTransitEnvelopeAdapter({
    baseUrl,
    keyName: keyId,
    token,
    mountPath: config.hashicorpTransit?.mountPath,
    namespace: config.hashicorpTransit?.namespace,
  });
}
