import {
  getConnectionPeerByMspId,
  getConnectionTlsCertPemByMspId,
  getPrivatePemKeyByMspId,
  getPublicCertByMspId,
} from '../../../blockchain/fabric/v3/connection';

const ENV_KEYS = [
  'HLF_CONNECTION_PEER',
  'HLF_CONNECTION_PEM',
  'HLF_CERTIFICATE',
  'HLF_PRIVATE_KEY',
  'HLF_CONNECTION_PEER_ACCUROMSP',
  'HLF_CONNECTION_PEM_ACCUROMSP',
  'HLF_CERTIFICATE_ACCUROMSP',
  'HLF_PRIVATE_KEY_ACCUROMSP',
] as const;

describe('Fabric process-owned connection environment', () => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    originalEnv.clear();
  });

  it('uses canonical unsuffixed variables for the process-owned peer and identity', () => {
    process.env.HLF_CONNECTION_PEER = 'peer.accuro.example:7051';
    process.env.HLF_CONNECTION_PEM = 'tls\\nca';
    process.env.HLF_CERTIFICATE = 'client\\ncert';
    process.env.HLF_PRIVATE_KEY = 'private\\nkey';

    expect(getConnectionPeerByMspId('ACCUROMSP')).toBe('peer.accuro.example:7051');
    expect(getConnectionTlsCertPemByMspId('ACCUROMSP')).toBe('tls\nca');
    expect(getPublicCertByMspId('ACCUROMSP')).toBe('client\ncert');
    expect(getPrivatePemKeyByMspId('ACCUROMSP')).toBe('private\nkey');
  });

  it('keeps suffixed variables as a compatibility fallback', () => {
    process.env.HLF_CONNECTION_PEER_ACCUROMSP = 'peer0:7051';
    process.env.HLF_CONNECTION_PEM_ACCUROMSP = 'legacy-tls';
    process.env.HLF_CERTIFICATE_ACCUROMSP = 'legacy-cert';
    process.env.HLF_PRIVATE_KEY_ACCUROMSP = 'legacy-key';

    expect(getConnectionPeerByMspId('ACCUROMSP')).toBe('peer0:7051');
    expect(getConnectionTlsCertPemByMspId('ACCUROMSP')).toBe('legacy-tls');
    expect(getPublicCertByMspId('ACCUROMSP')).toBe('legacy-cert');
    expect(getPrivatePemKeyByMspId('ACCUROMSP')).toBe('legacy-key');
  });
});
