import { deriveKeyPair } from '../../../utils/pki';

describe('Nautilus (Pontus-X) secp256k1 keys', () => {
  it('derives a deterministic secp256k1 key from a context seed', async () => {
    const seed = '0d9619d1702c7a4ff89ecf3720132812f0d124ca503a61c5f3a60e0451236365';
    const options = {
      kdf: 'context' as const,
      context: 'pontus-x',
      env: 'test' as const,
      saltPrefix: 'gdc-kdf:v1',
      infoPrefix: 'gdc-kdf:v1',
      minSeedBytes: 32,
      scrypt: { N: 32768, r: 8, p: 1, dkLen: 32, salt: 'gdc-pki-v1' },
    };

    const first = await deriveKeyPair(seed, 'secp256k1', options);
    const second = await deriveKeyPair(seed, 'secp256k1', options);

    expect(first.jwk.d).toBe(second.jwk.d);
    expect(first.pub[0]).toBe(4);
    expect(Buffer.from(first.jwk.d, 'base64url').length).toBe(32);
  });
});
