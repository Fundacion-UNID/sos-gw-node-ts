import { afterEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { X509Certificate } from 'crypto';

import {
  buildX5cChain,
  createCertificate,
  deriveKeyPair,
  saveJwkDidAndCredential,
  writeX509ChainArtifacts,
} from '../../../utils/pki';

describe('PKI public artifact publication', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('publishes ICA did/jwks linked to the CA-signed x509 chain', async () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'gw-pki-publication-'));
    tempDirs.push(outDir);

    const rootAuthority = {
      seed: '1111111111111111111111111111111111111111111111111111111111111111',
      legalRegistrationNumber: 'VATES-ROOT-001',
      domain: 'root.example.test',
      subjectCN: 'root.example.test',
      officialName: 'Root Example',
      countryCode: 'ES',
      location: { city: 'Madrid' },
    };
    const icaAuthority = {
      seed: '2222222222222222222222222222222222222222222222222222222222222222',
      legalRegistrationNumber: 'VATES-ICA-001',
      domain: 'ica.example.test',
      subjectCN: 'ica.example.test',
      officialName: 'ICA Example',
      countryCode: 'ES',
      location: { city: 'Madrid' },
    };

    const rootKeyPair = await deriveKeyPair(rootAuthority.seed, 'P-384', { kdf: 'auto' });
    const icaKeyPair = await deriveKeyPair(icaAuthority.seed, 'P-384', { kdf: 'auto' });

    const { Crypto } = await import('@peculiar/webcrypto');
    const crypto = new Crypto();
    const rootKey = await crypto.subtle.importKey('jwk', rootKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign']);
    const icaKey = await crypto.subtle.importKey('jwk', icaKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-384' }, true, ['sign']);

    const rootCert = await createCertificate(
      rootAuthority.subjectCN,
      rootAuthority.subjectCN,
      rootKey,
      rootKey,
      rootKeyPair.pub,
      10,
      rootAuthority.legalRegistrationNumber,
      'P-384',
      true,
    );
    const icaCert = await createCertificate(
      icaAuthority.subjectCN,
      rootAuthority.subjectCN,
      icaKey,
      rootKey,
      icaKeyPair.pub,
      5,
      icaAuthority.legalRegistrationNumber,
      'P-384',
      true,
    );

    writeFileSync(path.join(outDir, 'ica-cert.der'), icaCert);
    writeFileSync(path.join(outDir, 'ca-cert.der'), rootCert);
    writeX509ChainArtifacts(outDir, [icaCert, rootCert]);

    const { d: _privatePart, ...icaPublicJwk } = icaKeyPair.jwk;
    await saveJwkDidAndCredential(icaAuthority, icaPublicJwk, icaKeyPair.kid, outDir, {
      x5c: buildX5cChain([icaCert, rootCert]),
      x5u: 'https://ica.example.test/.well-known/x509.der',
    });

    const did = JSON.parse(readFileSync(path.join(outDir, 'did-ica.example.test.json'), 'utf8'));
    const jwks = JSON.parse(readFileSync(path.join(outDir, 'jwks-ica.example.test.json'), 'utf8'));
    const x509Der = readFileSync(path.join(outDir, 'x509.der'));

    expect(did.id).toBe('did:web:ica.example.test');
    expect(did.assertionMethod).toEqual([`did:web:ica.example.test#${icaKeyPair.kid}`]);
    expect(did.service).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'did:web:ica.example.test#jwks',
        serviceEndpoint: 'https://ica.example.test/.well-known/jwks.json',
      }),
      expect.objectContaining({
        id: 'did:web:ica.example.test#x509',
        serviceEndpoint: 'https://ica.example.test/.well-known/x509.der',
      }),
    ]));

    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kid).toBe(icaKeyPair.kid);
    expect(jwks.keys[0].x5u).toBe('https://ica.example.test/.well-known/x509.der');
    expect(jwks.keys[0].x5c).toHaveLength(2);
    expect(did.verificationMethod[0].publicKeyJwk.x5c).toHaveLength(2);
    expect(x509Der.equals(Buffer.concat([icaCert, rootCert]))).toBe(true);

    const icaX509 = new X509Certificate(icaCert);
    const rootX509 = new X509Certificate(rootCert);
    expect(icaX509.verify(rootX509.publicKey)).toBe(true);

    const certPublicJwk = icaX509.publicKey.export({ format: 'jwk' }) as Record<string, string>;
    expect(certPublicJwk.kty).toBe('EC');
    expect(certPublicJwk.crv).toBe('P-384');
    expect(certPublicJwk.x).toBe(jwks.keys[0].x);
    expect(certPublicJwk.y).toBe(jwks.keys[0].y);
    expect(did.verificationMethod[0].publicKeyJwk.x).toBe(jwks.keys[0].x);
    expect(did.verificationMethod[0].publicKeyJwk.y).toBe(jwks.keys[0].y);
  });
});
