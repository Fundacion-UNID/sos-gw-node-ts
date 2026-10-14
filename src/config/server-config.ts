import { IServerConfig } from '../config';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';

let configInstance: IServerConfig;
const DEFAULT_MAX_HEADER_SIZE_BYTES = 128 * 1024;
export const DEFAULT_HOST_JURISDICTION = 'es';

const MAIN_SECTORS = ['animal', 'health'] as const;
const SUBSECTORS = ['research', 'care', 'index', 'tech', 'insurance'] as const;
const COMPATIBILITY_SECTORS = ['onehealth-research'] as const;

export type NetworkMode = 'test' | 'local-network' | 'test-network' | 'network';
export type ResearchStoreProvider = 'postgres' | 'supabase' | 'firestore';
export type ResearchStoreTextSearchMode = 'postgres-simple' | 'postgres-tsvector';
export type ResearchStoreCodeIndexMode = 'normalized-claims-v1';

type MainSector = typeof MAIN_SECTORS[number];
type Subsector = typeof SUBSECTORS[number];

const DEFAULT_MAIN_SECTOR: MainSector = 'health';
const DEFAULT_SUBSECTORS: Subsector[] = ['research', 'care', 'index'];

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'disabled') return false;
  return fallback;
}

function hasAnyConfiguredValue(values: Array<string | number | boolean | undefined>): boolean {
  return values.some((value) => {
    if (value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  });
}

export function parseResearchStoreProvider(value: string | undefined): ResearchStoreProvider | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'postgres' || normalized === 'supabase' || normalized === 'firestore') {
    return normalized;
  }
  throw new Error('Config Error: Invalid RESEARCH_STORE_PROVIDER. Allowed: postgres, supabase, firestore');
}

/**
 * Parses the planned text-search mode for the separate research store.
 *
 * This setting is easy to misread, so keep the mental model explicit:
 * - it does not change the current operational vault search,
 * - it does not enable fuzzy search by itself,
 * - it selects how a future research-store adapter should index/search
 *   human-readable text fields that were explicitly allowlisted.
 *
 * Values:
 * - `postgres-simple`:
 *   Conservative default for an initial MVP. Think "basic PostgreSQL-backed
 *   normalized text search" without promising advanced linguistic behavior.
 * - `postgres-tsvector`:
 *   PostgreSQL full-text-oriented mode for a later, more explicit text index.
 */
export function parseResearchStoreTextSearchMode(value: string | undefined): ResearchStoreTextSearchMode | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'postgres-simple' || normalized === 'postgres-tsvector') {
    return normalized;
  }
  throw new Error('Config Error: Invalid RESEARCH_STORE_TEXT_SEARCH_MODE. Allowed: postgres-simple, postgres-tsvector');
}

/**
 * Parses the planned code-index extraction mode for the separate research
 * store.
 *
 * Current supported value:
 * - `normalized-claims-v1`
 *   Means the adapter/projector should derive exact code rows from canonical
 *   allowlisted claims such as `*.code`, `*.type`, `*.category`, etc.,
 *   especially values encoded as `SYSTEM|CODE`.
 *
 * This setting is intentionally versioned because future extraction rules may
 * evolve without changing the meaning of the existing stored indexes.
 */
export function parseResearchStoreCodeIndexMode(value: string | undefined): ResearchStoreCodeIndexMode | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'normalized-claims-v1') {
    return normalized;
  }
  throw new Error('Config Error: Invalid RESEARCH_STORE_CODE_INDEX_MODE. Allowed: normalized-claims-v1');
}

export function parseSecurityMode(value: string | undefined): 'strict' | 'compat' | 'demo' {
  const normalized = String(value || 'strict').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'compat' || normalized === 'demo') {
    return normalized;
  }
  throw new Error("Config Error: Invalid SECURITY_MODE. Allowed: strict, compat, demo");
}

function mapNodeEnvToNetworkMode(nodeEnv: string | undefined): NetworkMode {
  const normalized = String(nodeEnv || '').trim().toLowerCase();
  if (normalized === 'production') return 'network';
  if (normalized === 'development' || normalized === 'staging') return 'test-network';
  return 'test';
}

export function parseNetworkMode(value: string | undefined, nodeEnv?: string): NetworkMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return mapNodeEnvToNetworkMode(nodeEnv);
  if (normalized === 'test' || normalized === 'local-network' || normalized === 'test-network' || normalized === 'network') {
    return normalized;
  }
  throw new Error("Config Error: Invalid NETWORK_MODE. Allowed: test, local-network, test-network, network");
}

export function resetServerConfig(): void {
  configInstance = undefined as unknown as IServerConfig;
}

export function determineApiBaseUrl(port: number, apiHostname: string): string {
  if (process.env.HOST_EXTERNAL_DOMAIN) {
    const domain = process.env.HOST_EXTERNAL_DOMAIN.replace(/^(https?:\/\/)/, '').replace(/\/$/, '');
    return `https://${domain}`;
  }
  if (process.env.HOST_PUBLIC_URL) {
    return process.env.HOST_PUBLIC_URL.replace(/\/$/, '');
  }
  if (process.env.HOST_DEPLOY_URL) {
    return process.env.HOST_DEPLOY_URL.replace(/\/$/, '');
  }
  const protocol = 'http';
  const publicHost = (apiHostname === '0.0.0.0' || apiHostname === '127.0.0.1')
    ? 'localhost'
    : apiHostname;
  return `${protocol}://${publicHost}:${port}`;
}

export function parseAndValidateSectors(csv: string | undefined): Sector[] {
  if (!csv) return [];
  const legacySectors = new Set(Object.values(Sector) as string[]);
  const compatibilitySectors = new Set<string>(COMPATIBILITY_SECTORS);
  const requestedSectors = csv.split(',').map((s) => s.trim());
  const syntheticSectorPattern = /^(animal|health)-(research|care|index|tech|insurance)$/;
  for (const sector of requestedSectors) {
    if (sector === Sector.SYSTEM) {
      throw new Error(`Config Error: The '${Sector.SYSTEM}' sector is reserved and cannot be set in SECTORS_ALLOWED.`);
    }
    if (!legacySectors.has(sector) && !compatibilitySectors.has(sector) && !syntheticSectorPattern.test(sector)) {
      throw new Error(
          `Config Error: Invalid sector '${sector}'. Allowed legacy sectors (${Array.from(legacySectors).join(', ')}), ` +
          `compatibility sectors (${Array.from(compatibilitySectors).join(', ')}), ` +
          "or synthetic sectors '<animal|health>-<research|care|index|tech|insurance>'."
      );
    }
  }
  return requestedSectors as Sector[];
}

export function parseAndValidateMainSector(value: string | undefined): MainSector {
  const normalized = String(value || DEFAULT_MAIN_SECTOR).trim().toLowerCase();
  if (!MAIN_SECTORS.includes(normalized as MainSector)) {
    throw new Error(
      `Config Error: Invalid MAINSECTOR '${value}'. Allowed: ${MAIN_SECTORS.join(', ')}`
    );
  }
  return normalized as MainSector;
}

export function parseAndValidateSubsectors(csv: string | undefined): Subsector[] {
  const values = String(csv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (values.length === 0) {
    return [...DEFAULT_SUBSECTORS];
  }

  const deduped: Subsector[] = [];
  for (const value of values) {
    if (!SUBSECTORS.includes(value as Subsector)) {
      throw new Error(
        `Config Error: Invalid SUBSECTORSALLOWED value '${value}'. Allowed: ${SUBSECTORS.join(', ')}`
      );
    }
    const typed = value as Subsector;
    if (!deduped.includes(typed)) {
      deduped.push(typed);
    }
  }
  return deduped;
}

export function buildSectorsFromMainAndSubsectors(main: MainSector, subsectors: Subsector[]): Sector[] {
  return subsectors.map((sub) => `${main}-${sub}` as Sector);
}

export function resolveAllowedSectorsFromEnv(env: NodeJS.ProcessEnv): Sector[] {
  const canonicalCsv = String(env.ALLOWED_SECTORS || '').trim();
  if (canonicalCsv) {
    return parseAndValidateSectors(canonicalCsv);
  }

  const legacyCsv = String(env.SECTORS_ALLOWED || '').trim();
  if (legacyCsv) {
    console.warn('[Config] SECTORS_ALLOWED is deprecated. Use ALLOWED_SECTORS.');
    return parseAndValidateSectors(legacyCsv);
  }

  console.warn('[Config] MAINSECTOR + SUBSECTORSALLOWED are deprecated. Use ALLOWED_SECTORS.');
  const main = parseAndValidateMainSector(env.MAINSECTOR);
  const subsectors = parseAndValidateSubsectors(env.SUBSECTORSALLOWED);
  return buildSectorsFromMainAndSubsectors(main, subsectors);
}

function getHostEnv(key: string): string | undefined {
  const newKey = `HOST_${key}`;
  const legacyKey = `ORG_HOST_${key}`;
  return process.env[newKey] ?? process.env[legacyKey];
}

export function getConfig(): IServerConfig {
  if (!configInstance) {
    const port = parseInt(process.env.PORT || process.env.HOST_INTERNAL_PORT || '3500', 10);
    const parsedMaxHeaderSize = parseInt(process.env.GW_MAX_HEADER_SIZE || '', 10);
    const maxHeaderSize = Number.isFinite(parsedMaxHeaderSize) && parsedMaxHeaderSize > 0
      ? parsedMaxHeaderSize
      : DEFAULT_MAX_HEADER_SIZE_BYTES;
    const isCloudRun = Boolean(process.env.K_SERVICE || process.env.K_REVISION || process.env.K_CONFIGURATION);
    const apiHostname = isCloudRun ? '0.0.0.0' : (process.env.HOST_INTERNAL_IP || 'localhost');
    const apiBaseUrl = determineApiBaseUrl(port, apiHostname);

    const localServiceRoles = (process.env.LOCAL_SERVICE_ROLE || 'HOST')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    const nodeEnv = process.env.NODE_ENV || 'development';
    const securityMode = parseSecurityMode(process.env.SECURITY_MODE);
    const networkMode = parseNetworkMode(process.env.NETWORK_MODE, nodeEnv);
    const fhirLegacy = parseBooleanEnv(process.env.FHIR_LEGACY, false);
    const jsonLegacy = parseBooleanEnv(process.env.JSON_LEGACY, false);
    const didcommPlainEnabled = parseBooleanEnv(process.env.DIDCOMM_PLAIN, false);
    const didcommPlaintextLegacyMediaTypeEnabled = parseBooleanEnv(
      process.env.DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE,
      false,
    );
    const demoAllowInsecureBearer = parseBooleanEnv(process.env.DEMO_ALLOW_INSECURE_BEARER, false);
    const researchStoreEnabled = parseBooleanEnv(process.env.RESEARCH_STORE_ENABLED, false);
    const researchStoreSeparateDb = parseBooleanEnv(process.env.RESEARCH_STORE_SEPARATE_DB, true);
    const researchStoreProvider = parseResearchStoreProvider(process.env.RESEARCH_STORE_PROVIDER);
    const researchStoreTextSearchMode = parseResearchStoreTextSearchMode(process.env.RESEARCH_STORE_TEXT_SEARCH_MODE);
    const researchStoreCodeIndexMode = parseResearchStoreCodeIndexMode(process.env.RESEARCH_STORE_CODE_INDEX_MODE);
    const researchStorePostgres = {
      host: process.env.RESEARCH_STORE_POSTGRES_HOST,
      port: process.env.RESEARCH_STORE_POSTGRES_PORT ? parseInt(process.env.RESEARCH_STORE_POSTGRES_PORT, 10) : undefined,
      database: process.env.RESEARCH_STORE_POSTGRES_DB,
      user: process.env.RESEARCH_STORE_POSTGRES_USER,
      password: process.env.RESEARCH_STORE_POSTGRES_PASSWORD,
      ssl: parseBooleanEnv(process.env.RESEARCH_STORE_POSTGRES_SSL, false),
      schema: process.env.RESEARCH_STORE_POSTGRES_SCHEMA,
    };
    const researchStorePostgresConfigured = hasAnyConfiguredValue([
      researchStorePostgres.host,
      researchStorePostgres.port,
      researchStorePostgres.database,
      researchStorePostgres.user,
      researchStorePostgres.password,
      researchStorePostgres.schema,
      process.env.RESEARCH_STORE_POSTGRES_SSL,
    ]);

    if (researchStoreEnabled && !researchStoreProvider) {
      throw new Error('Config Error: RESEARCH_STORE_PROVIDER is required when RESEARCH_STORE_ENABLED=true');
    }
    if (researchStoreEnabled && researchStoreProvider === 'postgres' && researchStoreSeparateDb) {
      const hasDedicatedPostgresConfig = hasAnyConfiguredValue([
        researchStorePostgres.host,
        researchStorePostgres.port,
        researchStorePostgres.database,
        researchStorePostgres.user,
        researchStorePostgres.password,
      ]);
      if (!hasDedicatedPostgresConfig) {
        throw new Error(
          'Config Error: Dedicated RESEARCH_STORE_POSTGRES_* settings are required when RESEARCH_STORE_ENABLED=true, RESEARCH_STORE_PROVIDER=postgres, and RESEARCH_STORE_SEPARATE_DB=true',
        );
      }
    }
    if (!researchStoreEnabled && researchStorePostgresConfigured) {
      console.warn('[Config] RESEARCH_STORE_POSTGRES_* is configured while RESEARCH_STORE_ENABLED=false. The research store remains disabled.');
    }
    if (researchStoreEnabled && researchStoreProvider === 'postgres' && !researchStoreSeparateDb && researchStorePostgresConfigured) {
      console.warn('[Config] RESEARCH_STORE_SEPARATE_DB=false reuses the main operational PostgreSQL runtime by explicit opt-in. Dedicated RESEARCH_STORE_POSTGRES_* settings are ignored.');
    }

    configInstance = {
      securityMode,
      networkMode,
      fhirLegacy,
      jsonLegacy,
      didcommPlainEnabled,
      didcommPlaintextLegacyMediaTypeEnabled,
      demoAllowInsecureBearer,
      nodeEnv,
      port: port,
      maxHeaderSize,
      apiHostname,
      hostExternalDomain: process.env.HOST_EXTERNAL_DOMAIN || new URL(apiBaseUrl).host,
      apiBaseUrl,
      namespace: process.env.URN_NAMESPACE || 'gdc',
      sectorsAllowed: resolveAllowedSectorsFromEnv(process.env),
      allowedPaymentMethods: (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(','),
      dbProvider: process.env.DB_PROVIDER || 'mem',
      storageProvider: process.env.STORAGE_PROVIDER || 'mem',
      queueProvider: process.env.QUEUE_PROVIDER || 'mem',
      postgres: {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : undefined,
        database: process.env.POSTGRES_DB,
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        ssl: parseBooleanEnv(process.env.POSTGRES_SSL, false),
        schema: process.env.POSTGRES_SCHEMA,
        maxPoolSize: process.env.POSTGRES_MAX_POOL_SIZE ? parseInt(process.env.POSTGRES_MAX_POOL_SIZE, 10) : undefined,
      },
      researchStore: {
        enabled: researchStoreEnabled,
        provider: researchStoreProvider,
        separateDb: researchStoreSeparateDb,
        indexPrefix: process.env.RESEARCH_STORE_INDEX_PREFIX,
        defaultLocale: process.env.RESEARCH_STORE_DEFAULT_LOCALE,
        textSearchMode: researchStoreTextSearchMode,
        codeIndexMode: researchStoreCodeIndexMode,
        postgres: researchStoreEnabled && researchStoreProvider === 'postgres'
          ? (
            researchStoreSeparateDb
              ? researchStorePostgres
              : {
                  host: process.env.POSTGRES_HOST,
                  port: process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : undefined,
                  database: process.env.POSTGRES_DB,
                  user: process.env.POSTGRES_USER,
                  password: process.env.POSTGRES_PASSWORD,
                  ssl: parseBooleanEnv(process.env.POSTGRES_SSL, false),
                  schema: process.env.POSTGRES_SCHEMA,
                }
          )
          : undefined,
      },
      gcsBucketName: process.env.GCS_BUCKET_NAME,
      supabase: {
        url: process.env.SUPABASE_URL,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        storageBucket: process.env.SUPABASE_STORAGE_BUCKET,
        storagePublic: parseBooleanEnv(process.env.SUPABASE_STORAGE_PUBLIC, true),
      },
      ipfs: {
        apiUrl: process.env.IPFS_API_URL,
        gatewayUrl: process.env.IPFS_GATEWAY_URL,
        mfsRoot: process.env.IPFS_MFS_ROOT,
      },
      kekSecret: process.env.KEK_SECRET,
      kms: {
        provider: (() => {
          const value = String(process.env.KMS_PROVIDER || process.env.ENVELOPE_PROVIDER || '').trim().toLowerCase();
          if (!value) return undefined;
          if (value === 'memory' || value === 'local' || value === 'gcp' || value === 'aws' || value === 'hashicorp-transit') return value;
          if (value === 'gcp-kms') return 'gcp';
          if (value === 'aws-kms') return 'aws';
          throw new Error("Config Error: Invalid KMS_PROVIDER. Allowed: memory, local, gcp, aws, hashicorp-transit");
        })(),
        region: process.env.KMS_REGION,
        keyId: process.env.KMS_KEY_ID,
        runtimeKekCiphertext: process.env.KMS_RUNTIME_KEK_CIPHERTEXT,
        runtimeKekId: process.env.KMS_RUNTIME_KEK_ID,
      },
      gcpKms: {
        keyName: process.env.GCP_KMS_KEY_NAME,
        runtimeKekCiphertext: process.env.GCP_KMS_RUNTIME_KEK_CIPHERTEXT,
        runtimeKekId: process.env.GCP_KMS_RUNTIME_KEK_ID,
      },
      hashicorpTransit: {
        baseUrl: process.env.HASHICORP_TRANSIT_BASE_URL,
        mountPath: process.env.HASHICORP_TRANSIT_MOUNT_PATH,
        keyName: process.env.HASHICORP_TRANSIT_KEY_NAME,
        token: process.env.HASHICORP_TRANSIT_TOKEN,
        namespace: process.env.HASHICORP_NAMESPACE,
      },
      host: {
        legalName: getHostEnv('LEGAL_NAME'),
        jurisdiction: getHostEnv('JURISDICTION') || DEFAULT_HOST_JURISDICTION,
        coverageScope: process.env.HOST_COVERAGE_SCOPE || 'EU',
        idType: getHostEnv('ID_TYPE'),
        idValue: getHostEnv('ID_VALUE'),
        adminEmail: getHostEnv('ADMIN_EMAIL'),
        adminUid: getHostEnv('ADMIN_UID'),
        adminRole: getHostEnv('ADMIN_ROLE'),
      },
      mongo: {
        uri: process.env.MONGO_URI,
        dbName: process.env.MONGO_DB_NAME || 'default',
      },
      firebase: {
        // Primary Firebase Admin/data project. Additional Auth-only token
        // audiences are owned by FirebaseTokenVerifier and must not redirect
        // this storage/runtime configuration.
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      },
      googleClientId: process.env.GOOGLE_CLIENT_ID,
      legacySignAlg: (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
        ? process.env.LEGACY_SIGN_ALG
        : 'ES384',
      legacyX509DerBase64: process.env.LEGACY_X509_DER_BASE64,
      legacyX509ChainBase64: process.env.LEGACY_X509_CHAIN_BASE64
        ? process.env.LEGACY_X509_CHAIN_BASE64.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      ica: {
        mode: (process.env.ICA_MODE === 'internal' || process.env.ICA_MODE === 'external')
          ? process.env.ICA_MODE
          : undefined,
        internalUrl: process.env.ICA_URL_INTERNAL,
        externalUrl: process.env.ICA_URL_EXTERNAL,
        jurisdiction: process.env.ICA_JURISDICTION,
        didWeb: process.env.ICA_DID_WEB,
        tlsCaPem: process.env.ICA_TLS_CA_PEM,
      },
      ledger: {
        enabled: process.env.LEDGER_ENABLED ? process.env.LEDGER_ENABLED === 'true' : undefined,
        mspId: process.env.LEDGER_MSP_ID,
        channelName: process.env.LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT
          || process.env.LEDGER_IDENTITY_CHANNEL_DEFAULT,
        chaincodeName: process.env.LEDGER_ORG_CHAINCODE,
        schemaUrl: process.env.GOVERNANCE_SCHEMA_URL,
      },
      localServiceRoles,
    };
  }
  return configInstance;
}
