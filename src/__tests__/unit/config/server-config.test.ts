/**
 * Flow contract: deployment configuration accepts canonical sectors plus
 * explicitly named signed-identity compatibility sectors and fails closed for
 * every unrecognized value.
 */
import {
  DEFAULT_HOST_JURISDICTION,
  buildSectorsFromMainAndSubsectors,
  determineApiBaseUrl,
  getConfig,
  parseAndValidateMainSector,
  parseAndValidateSectors,
  parseAndValidateSubsectors,
  parseResearchStoreCodeIndexMode,
  parseResearchStoreProvider,
  parseResearchStoreTextSearchMode,
  parseNetworkMode,
  parseSecurityMode,
  resetServerConfig,
  resolveAllowedSectorsFromEnv,
} from '../../../config/server-config';

describe('server-config sector resolution', () => {
  it('centralizes the host jurisdiction default', () => {
    expect(DEFAULT_HOST_JURISDICTION).toBe('es');
  });

  it('should resolve synthetic sectors from MAINSECTOR + SUBSECTORSALLOWED', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      MAINSECTOR: 'animal',
      SUBSECTORSALLOWED: 'research,care,index,tech',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['animal-research', 'animal-care', 'animal-index', 'animal-tech']);
  });

  it('should default subsectors when SUBSECTORSALLOWED is missing', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      MAINSECTOR: 'health',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['health-research', 'health-care', 'health-index']);
  });

  it('should prioritize canonical ALLOWED_SECTORS over every legacy sector setting', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      ALLOWED_SECTORS: 'health-care,onehealth-research',
      SECTORS_ALLOWED: 'animal-care',
      MAINSECTOR: 'animal',
      SUBSECTORSALLOWED: 'research,care,index',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['health-care', 'onehealth-research']);
  });

  it('should prioritize deprecated SECTORS_ALLOWED when present', () => {
    const sectors = resolveAllowedSectorsFromEnv({
      MAINSECTOR: 'animal',
      SUBSECTORSALLOWED: 'research,care,index',
      SECTORS_ALLOWED: 'health-care,research',
    } as NodeJS.ProcessEnv);

    expect(sectors).toEqual(['health-care', 'research']);
  });

  it('should accept synthetic sectors in an explicit allowed-sector list', () => {
    expect(parseAndValidateSectors('animal-care,animal-index,animal-tech,animal-insurance')).toEqual([
      'animal-care',
      'animal-index',
      'animal-tech',
      'animal-insurance',
    ]);
  });

  it('should preserve the independently addressable onehealth-research compatibility sector', () => {
    expect(parseAndValidateSectors(
      'health-care,health-research,health-tech,health-insurance,onehealth-research',
    )).toEqual([
      'health-care',
      'health-research',
      'health-tech',
      'health-insurance',
      'onehealth-research',
    ]);
  });

  it('should validate MAINSECTOR values', () => {
    expect(parseAndValidateMainSector('animal')).toBe('animal');
    expect(() => parseAndValidateMainSector('finance')).toThrow(
      /Invalid MAINSECTOR/
    );
  });

  it('should validate SUBSECTORSALLOWED values', () => {
    expect(parseAndValidateSubsectors('research,care,index,tech,insurance')).toEqual([
      'research',
      'care',
      'index',
      'tech',
      'insurance',
    ]);
    expect(() => parseAndValidateSubsectors('care,unknown')).toThrow(
      /Invalid SUBSECTORSALLOWED/
    );
  });

  it('should build sectors consistently from main and subsectors', () => {
    expect(buildSectorsFromMainAndSubsectors('animal', ['care', 'insurance'])).toEqual([
      'animal-care',
      'animal-insurance',
    ]);
  });

  it('should parse SECURITY_MODE values', () => {
    expect(parseSecurityMode('strict')).toBe('strict');
    expect(parseSecurityMode('compat')).toBe('compat');
    expect(parseSecurityMode('demo')).toBe('demo');
    expect(parseSecurityMode(undefined)).toBe('strict');
    expect(() => parseSecurityMode('invalid-mode')).toThrow(/Invalid SECURITY_MODE/);
  });

  it('should parse NETWORK_MODE values and fallback by NODE_ENV', () => {
    expect(parseNetworkMode('test')).toBe('test');
    expect(parseNetworkMode('test-network')).toBe('test-network');
    expect(parseNetworkMode('network')).toBe('network');

    expect(parseNetworkMode(undefined, 'production')).toBe('network');
    expect(parseNetworkMode(undefined, 'staging')).toBe('test-network');
    expect(parseNetworkMode(undefined, 'test')).toBe('test');
    expect(() => parseNetworkMode('invalid-mode')).toThrow(/Invalid NETWORK_MODE/);
  });

  it('should parse research store mode values', () => {
    expect(parseResearchStoreProvider(undefined)).toBeUndefined();
    expect(parseResearchStoreProvider('postgres')).toBe('postgres');
    expect(parseResearchStoreProvider('supabase')).toBe('supabase');
    expect(parseResearchStoreProvider('firestore')).toBe('firestore');
    expect(() => parseResearchStoreProvider('mongo')).toThrow(/Invalid RESEARCH_STORE_PROVIDER/);

    expect(parseResearchStoreTextSearchMode(undefined)).toBeUndefined();
    expect(parseResearchStoreTextSearchMode('postgres-simple')).toBe('postgres-simple');
    expect(parseResearchStoreTextSearchMode('postgres-tsvector')).toBe('postgres-tsvector');
    expect(() => parseResearchStoreTextSearchMode('ilike')).toThrow(/Invalid RESEARCH_STORE_TEXT_SEARCH_MODE/);

    expect(parseResearchStoreCodeIndexMode(undefined)).toBeUndefined();
    expect(parseResearchStoreCodeIndexMode('normalized-claims-v1')).toBe('normalized-claims-v1');
    expect(() => parseResearchStoreCodeIndexMode('legacy')).toThrow(/Invalid RESEARCH_STORE_CODE_INDEX_MODE/);
  });

  it('should expose security and network flags from environment', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      SECURITY_MODE: 'compat',
      NETWORK_MODE: 'test-network',
      FHIR_LEGACY: 'true',
      JSON_LEGACY: '1',
      DIDCOMM_PLAIN: 'enabled',
      DEMO_ALLOW_INSECURE_BEARER: 'yes',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.securityMode).toBe('compat');
    expect(config.networkMode).toBe('test-network');
    expect(config.fhirLegacy).toBe(true);
    expect(config.jsonLegacy).toBe(true);
    expect(config.didcommPlainEnabled).toBe(true);
    expect(config.demoAllowInsecureBearer).toBe(true);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should default security flags to disabled and map NETWORK_MODE by NODE_ENV', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      NODE_ENV: 'production',
      SECURITY_MODE: '',
      NETWORK_MODE: '',
      FHIR_LEGACY: '',
      JSON_LEGACY: '',
      DIDCOMM_PLAIN: '',
      DEMO_ALLOW_INSECURE_BEARER: '',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.securityMode).toBe('strict');
    expect(config.networkMode).toBe('network');
    expect(config.fhirLegacy).toBe(false);
    expect(config.jsonLegacy).toBe(false);
    expect(config.didcommPlainEnabled).toBe(false);
    expect(config.demoAllowInsecureBearer).toBe(false);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('uses the dedicated SOS GW local port when no port override is configured', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      PORT: '',
      HOST_INTERNAL_PORT: '',
    };

    resetServerConfig();
    expect(getConfig().port).toBe(3500);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('uses the regional organization channel for host ledger bootstrap', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      LEDGER_IDENTITY_CHANNEL_DEFAULT: 'identity-global',
      LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT: 'identity-na',
    };

    resetServerConfig();
    expect(getConfig().ledger?.channelName).toBe('identity-na');

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should expose Supabase storage settings from environment', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      STORAGE_PROVIDER: 'supabase',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
      SUPABASE_STORAGE_BUCKET: 'gw-files',
      SUPABASE_STORAGE_PUBLIC: 'true',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.storageProvider).toBe('supabase');
    expect(config.supabase).toEqual({
      url: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
      storageBucket: 'gw-files',
      storagePublic: true,
    });

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should expose IPFS storage settings from environment', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      STORAGE_PROVIDER: 'ipfs',
      IPFS_API_URL: 'http://127.0.0.1:5001',
      IPFS_GATEWAY_URL: 'http://127.0.0.1:8080',
      IPFS_MFS_ROOT: '/gwtemplate/blobs',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.storageProvider).toBe('ipfs');
    expect(config.ipfs).toEqual({
      apiUrl: 'http://127.0.0.1:5001',
      gatewayUrl: 'http://127.0.0.1:8080',
      mfsRoot: '/gwtemplate/blobs',
    });

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should default the research store block to disabled without changing runtime behavior', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      RESEARCH_STORE_ENABLED: '',
      RESEARCH_STORE_PROVIDER: '',
      RESEARCH_STORE_SEPARATE_DB: '',
      RESEARCH_STORE_POSTGRES_HOST: '',
      RESEARCH_STORE_POSTGRES_PORT: '',
      RESEARCH_STORE_POSTGRES_DB: '',
      RESEARCH_STORE_POSTGRES_USER: '',
      RESEARCH_STORE_POSTGRES_PASSWORD: '',
      RESEARCH_STORE_POSTGRES_SCHEMA: '',
      RESEARCH_STORE_POSTGRES_SSL: '',
      RESEARCH_STORE_INDEX_PREFIX: '',
      RESEARCH_STORE_DEFAULT_LOCALE: '',
      RESEARCH_STORE_TEXT_SEARCH_MODE: '',
      RESEARCH_STORE_CODE_INDEX_MODE: '',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.researchStore).toEqual({
      enabled: false,
      provider: undefined,
      separateDb: true,
      indexPrefix: '',
      defaultLocale: '',
      textSearchMode: undefined,
      codeIndexMode: undefined,
      postgres: undefined,
    });

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should expose dedicated research-store postgres settings when enabled', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      RESEARCH_STORE_ENABLED: 'true',
      RESEARCH_STORE_PROVIDER: 'postgres',
      RESEARCH_STORE_SEPARATE_DB: 'true',
      RESEARCH_STORE_POSTGRES_HOST: 'research-pg.internal',
      RESEARCH_STORE_POSTGRES_PORT: '6543',
      RESEARCH_STORE_POSTGRES_DB: 'gw_research',
      RESEARCH_STORE_POSTGRES_USER: 'gw_research_user',
      RESEARCH_STORE_POSTGRES_PASSWORD: 'secret',
      RESEARCH_STORE_POSTGRES_SCHEMA: 'digital_twin',
      RESEARCH_STORE_POSTGRES_SSL: 'true',
      RESEARCH_STORE_INDEX_PREFIX: 'rtwin',
      RESEARCH_STORE_DEFAULT_LOCALE: 'es',
      RESEARCH_STORE_TEXT_SEARCH_MODE: 'postgres-tsvector',
      RESEARCH_STORE_CODE_INDEX_MODE: 'normalized-claims-v1',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.researchStore).toEqual({
      enabled: true,
      provider: 'postgres',
      separateDb: true,
      indexPrefix: 'rtwin',
      defaultLocale: 'es',
      textSearchMode: 'postgres-tsvector',
      codeIndexMode: 'normalized-claims-v1',
      postgres: {
        host: 'research-pg.internal',
        port: 6543,
        database: 'gw_research',
        user: 'gw_research_user',
        password: 'secret',
        ssl: true,
        schema: 'digital_twin',
      },
    });

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should require a research-store provider when the research store is enabled', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      RESEARCH_STORE_ENABLED: 'true',
      RESEARCH_STORE_PROVIDER: '',
    };

    resetServerConfig();
    expect(() => getConfig()).toThrow(/RESEARCH_STORE_PROVIDER is required/);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should require dedicated research-store postgres settings when separateDb is true', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      RESEARCH_STORE_ENABLED: 'true',
      RESEARCH_STORE_PROVIDER: 'postgres',
      RESEARCH_STORE_SEPARATE_DB: 'true',
      RESEARCH_STORE_POSTGRES_HOST: '',
      RESEARCH_STORE_POSTGRES_PORT: '',
      RESEARCH_STORE_POSTGRES_DB: '',
      RESEARCH_STORE_POSTGRES_USER: '',
      RESEARCH_STORE_POSTGRES_PASSWORD: '',
    };

    resetServerConfig();
    expect(() => getConfig()).toThrow(/Dedicated RESEARCH_STORE_POSTGRES_\* settings are required/);

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should allow explicit shared-db opt-in for the research store', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      DB_PROVIDER: 'postgres',
      POSTGRES_HOST: 'main-pg.internal',
      POSTGRES_PORT: '5432',
      POSTGRES_DB: 'gw_main',
      POSTGRES_USER: 'gw_main_user',
      POSTGRES_PASSWORD: 'main-secret',
      POSTGRES_SCHEMA: 'public',
      POSTGRES_SSL: 'false',
      RESEARCH_STORE_ENABLED: 'true',
      RESEARCH_STORE_PROVIDER: 'postgres',
      RESEARCH_STORE_SEPARATE_DB: 'false',
      RESEARCH_STORE_POSTGRES_HOST: '',
      RESEARCH_STORE_POSTGRES_PORT: '',
      RESEARCH_STORE_POSTGRES_DB: '',
      RESEARCH_STORE_POSTGRES_USER: '',
      RESEARCH_STORE_POSTGRES_PASSWORD: '',
      RESEARCH_STORE_POSTGRES_SCHEMA: '',
      RESEARCH_STORE_POSTGRES_SSL: '',
    };

    resetServerConfig();
    const config = getConfig();

    expect(config.researchStore).toEqual({
      enabled: true,
      provider: 'postgres',
      separateDb: false,
      indexPrefix: undefined,
      defaultLocale: undefined,
      textSearchMode: undefined,
      codeIndexMode: undefined,
      postgres: {
        host: 'main-pg.internal',
        port: 5432,
        database: 'gw_main',
        user: 'gw_main_user',
        password: 'main-secret',
        ssl: false,
        schema: 'public',
      },
    });

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should accept every SECURITY_MODE x NETWORK_MODE pair independently', () => {
    const previousEnv = process.env;
    const securityModes = ['strict', 'compat', 'demo'] as const;
    const networkModes = ['test', 'test-network', 'network'] as const;

    for (const securityMode of securityModes) {
      for (const networkMode of networkModes) {
        process.env = {
          ...previousEnv,
          SECURITY_MODE: securityMode,
          NETWORK_MODE: networkMode,
        };
        resetServerConfig();
        const config = getConfig();
        expect(config.securityMode).toBe(securityMode);
        expect(config.networkMode).toBe(networkMode);
      }
    }

    process.env = previousEnv;
    resetServerConfig();
  });

  it('should prefer HOST_PUBLIC_URL over HOST_DEPLOY_URL and local fallback', () => {
    const previousEnv = process.env;
    process.env = {
      ...previousEnv,
      HOST_EXTERNAL_DOMAIN: '',
      HOST_PUBLIC_URL: 'http://34.175.78.233/',
      HOST_DEPLOY_URL: 'https://stale.example.org/',
    };

    expect(determineApiBaseUrl(3300, '0.0.0.0')).toBe('http://34.175.78.233');

    process.env = previousEnv;
    resetServerConfig();
  });
});
