// src/__tests__/unit/utils/pki-chain.test.ts

import { Crypto } from '@peculiar/webcrypto';
import * as pkijs from 'pkijs';
import {
  createCertificate,
  deriveKeyPair,
  generateMSPID,
} from '../../../utils/pki';

const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

describe('pki utils', () => {
  it('should derive a deterministic P-256 key pair from a seed', async () => {
    const seed = 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
    const first = await deriveKeyPair(seed);
    const second = await deriveKeyPair(seed);
    expect(first.kid).toEqual(second.kid);
    expect(first.jwk.crv).toEqual('P-256');
    expect(first.jwk.kty).toEqual('EC');
  });

  it('should create an X.509 certificate buffer', async () => {
    const seed = 'b0b1b2b3b4b5b6b7b8b9babbbcbdbebf';
    const root = await deriveKeyPair(seed);
    const rootKey = await crypto.subtle.importKey('jwk', root.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);

    const cert = await createCertificate(
      'root-ca.example.com',
      'root-ca.example.com',
      rootKey,
      rootKey,
      root.pub,
      1,
      'VAT-ROOT-001'
    );

    expect(cert).toBeInstanceOf(Buffer);
    expect(cert.length).toBeGreaterThan(0);
  });

  it('should generate a stable MSP ID', () => {
    const mspId = generateMSPID({
      legalRegistrationNumber: 'VATES-ACME',
      domain: 'example.com',
      subjectCN: 'example.com',
      officialName: 'ACME',
      countryCode: 'ES',
      location: { city: 'Madrid' },
      seed: '',
    });
    expect(mspId).toContain('VATES-ACME');
    expect(mspId).toContain('EXAMPLE_COM');
  });
});
