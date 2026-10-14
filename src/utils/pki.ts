import { createGaiaXLegalParticipantCredential } from './credential-generators';// utils/pki-utils.ts

// Author: Fernando Latorre López
// License: Apache License 2.0 (see LICENSE)
// This code is part of a trusted infrastructure project and is provided "as is", without warranty of any kind.
// You are responsible for verifying that it meets your security and compliance requirements.
// Commercial or derivative reuse outside the original infrastructure context requires prior written consent from the author.

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { randomBytes } from '@noble/hashes/utils.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { scryptSync } from 'node:crypto';
import { sha256, sha384 } from '@noble/hashes/sha2.js';
import { p256, p384 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { calculateJwkThumbprint } from 'jose';
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

import { Crypto } from '@peculiar/webcrypto';
// globalThis.crypto = new Crypto();
const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

export type AuthorityConfig = {
    seed: string | Uint8Array | undefined; // bytes, hex string or empty for being automatically generated
    legalRegistrationNumber: string;
    domain: string;
    subjectCN: string;
    officialName: string;
    countryCode: string;
    location: { city: string; street?: string; postalCode?: string };
    certFile?: string;  // automatically generated
    jwksFile?: string;  // automatically generated
    didFile?: string;   // automatically generated
    sdFile?: string;    // automatically generated
};

type PublicArtifactOptions = {
  x5c?: string[];
  x5u?: string;
  serviceBaseUrl?: string;
};

type ArtifactManifestOptions = {
  role: 'CA' | 'ICA' | 'HOST' | 'TENANT' | 'MEMBER';
  did: string;
  jwksFile: string;
  didFile: string;
  credentialFile: string;
  x509DerFile?: string;
  x509ChainDerFile?: string;
  extraFiles?: string[];
};

export function generateMSPID(entity: AuthorityConfig): string {
  return `${entity.legalRegistrationNumber}_${entity.domain}`.replace(/\./g, '_').toUpperCase();
}

export function resolveOutputDir(...segments: string[]) {
  const dir = path.join('artifacts', ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function resolveOutputDirWithBase(baseDir: string, ...segments: string[]) {
  const dir = path.join(baseDir, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function derToBase64(der: Buffer): string {
  return Buffer.from(der).toString('base64');
}

/**
 * Serializes a certificate chain in the `x5c` format expected by JOSE/JWK consumers.
 */
export function buildX5cChain(chain: Buffer[]): string[] {
  return chain.map((entry) => derToBase64(entry));
}

/**
 * Publishes the concatenated DER chain both under the canonical discovery name and the explicit chain artifact.
 */
export function writeX509ChainArtifacts(outputDir: string, chain: Buffer[]): Buffer {
  const concatenated = Buffer.concat(chain);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'x509.der'), concatenated);
  fs.writeFileSync(path.join(outputDir, 'x509-chain.der'), concatenated);
  return concatenated;
}

function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Records the published trust artifacts with stable hashes so an operator can audit the generated bundle offline.
 */
export function writeArtifactManifest(
  outputDir: string,
  entity: AuthorityConfig,
  options: ArtifactManifestOptions,
): void {
  const files = [
    options.didFile,
    options.jwksFile,
    options.credentialFile,
    ...(options.x509DerFile ? [options.x509DerFile] : []),
    ...(options.x509ChainDerFile ? [options.x509ChainDerFile] : []),
    ...(options.extraFiles || []),
  ];

  const uniqueFiles = Array.from(new Set(files));
  const manifest = {
    version: 1,
    role: options.role,
    domain: entity.domain,
    did: options.did,
    legalRegistrationNumber: entity.legalRegistrationNumber,
    officialName: entity.officialName,
    generatedAt: new Date().toISOString(),
    files: uniqueFiles.map((relativePath) => {
      const absolutePath = path.join(outputDir, relativePath);
      return {
        path: relativePath,
        sha256: sha256File(absolutePath),
      };
    }),
  };

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

/**
 * Writes the public identity bundle for one entity:
 * DID document, JWKS, and the self-description/credential used in the current stack.
 */
export async function saveJwkDidAndCredential(
  entity: AuthorityConfig,
  pubJwk: any,
  kid: string,
  outputDir: string,
  options: PublicArtifactOptions = {},
) {
  const didID = `did:web:${entity.domain}`;
  const serviceBaseUrl = String(options.serviceBaseUrl || `https://${entity.domain}`).replace(/\/+$/, '');
  const resolvedAlg = pubJwk.alg || (pubJwk.crv === 'P-384' ? 'ES384' : 'ES256');
  const publicJwk = {
    ...pubJwk,
    kid,
    alg: resolvedAlg,
    use: pubJwk.use || 'sig',
    // `x5c` is the offline-friendly source of truth; `x5u` is the complementary online pointer.
    ...(options.x5c?.length ? { x5c: options.x5c } : {}),
    ...(options.x5u ? { x5u: options.x5u } : {}),
  };
  const jwks = { keys: [publicJwk] };
  const did = {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: didID,
    verificationMethod: [{
      id: `${didID}#${kid}`,
      type: 'JsonWebKey2020',
      controller: didID,
      publicKeyJwk: publicJwk,
    }],
    authentication: [`${didID}#${kid}`],
    assertionMethod: [`${didID}#${kid}`],
    service: [
      {
        id: `${didID}#did-document`,
        type: 'LinkedDomains',
        serviceEndpoint: `${serviceBaseUrl}/.well-known/did.json`,
      },
      {
        id: `${didID}#jwks`,
        type: 'JsonWebKeyService2020',
        serviceEndpoint: `${serviceBaseUrl}/.well-known/jwks.json`,
      },
      {
        id: `${didID}#x509`,
        type: 'X509CertificateChainService2020',
        serviceEndpoint: `${serviceBaseUrl}/.well-known/x509.der`,
      },
    ],
  };
  
  const credential = createGaiaXLegalParticipantCredential({
    webDomain: `https://${entity.domain}`,
    officialName: entity.officialName,
    did: didID,
    issuerDid: didID, // Current local trust bootstrap keeps this credential self-issued; the X.509 chain carries the CA-backed trust.
    vatId: entity.legalRegistrationNumber,
    countryCode: entity.countryCode,
  });

  fs.mkdirSync(outputDir, { recursive: true });

  fs.writeFileSync(path.join(outputDir, `jwks-${entity.domain}.json`), JSON.stringify(jwks, null, 2));
  fs.writeFileSync(path.join(outputDir, `did-${entity.domain}.json`), JSON.stringify(did, null, 2));
  fs.writeFileSync(path.join(outputDir, `LegalParticipantCredential-${entity.domain}.jsonld`), JSON.stringify(credential, null, 2));
}

export function bufferToPem(buf: Buffer, label: string): string {
  const base64 = buf.toString('base64');
  const lines = base64.match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

export function bigintToBytes(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

type DeriveKeyPairOptions = {
  kdf?: 'hash' | 'scrypt' | 'auto' | 'context';
  context?: string;
  env?: 'test' | 'prod';
  saltPrefix?: string;
  infoPrefix?: string;
  minSeedBytes?: number;
  forceScrypt?: boolean;
  scrypt?: {
    N: number;
    r: number;
    p: number;
    dkLen: number;
    salt: string;
  };
};

const DEFAULT_SCRYPT = {
  N: 16384,
  r: 8,
  p: 1,
  dkLen: 32,
  salt: 'gdc-pki-v1',
};

const DEFAULT_KDF_CONTEXT = {
  saltPrefix: 'gdc-kdf:v1',
  infoPrefix: 'gdc-kdf:v1',
  minSeedBytes: 32,
  env: 'test' as 'test' | 'prod',
};

function isHex32(seed: string): boolean {
  const trimmed = seed.trim().replace(/^0x/i, '');
  return trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed);
}

function deriveSeedBytes(
  seedInput?: string | Uint8Array,
  options?: DeriveKeyPairOptions
): Buffer {
  if (seedInput instanceof Uint8Array) {
    return Buffer.from(seedInput.subarray(0, 32));
  }

  const seed = seedInput?.trim() ?? '';
  if (!seed) {
    return Buffer.from(randomBytes(32));
  }

  const mode = options?.kdf ?? 'hash';
  const scryptConfig = options?.scrypt ?? DEFAULT_SCRYPT;

  if (mode === 'hash') {
    return Buffer.from(seed.replace(/^0x/i, ''), 'hex').subarray(0, 32);
  }

  if (mode === 'auto' && isHex32(seed)) {
    return Buffer.from(seed.replace(/^0x/i, ''), 'hex').subarray(0, 32);
  }

  const salt = Buffer.from(scryptConfig.salt, 'utf8');
  return scryptSync(seed, salt, scryptConfig.dkLen, {
    N: scryptConfig.N,
    r: scryptConfig.r,
    p: scryptConfig.p,
    maxmem: 128 * scryptConfig.N * scryptConfig.r * 2,
  });
}

function toSeedBytes(seedInput?: string | Uint8Array): Buffer {
  if (seedInput instanceof Uint8Array) {
    return Buffer.from(seedInput);
  }
  const seed = seedInput?.trim() ?? '';
  if (!seed) return Buffer.alloc(0);
  if (isHex32(seed)) {
    return Buffer.from(seed.replace(/^0x/i, ''), 'hex');
  }
  return Buffer.from(seed, 'utf8');
}

function resolveContextSalt(options: DeriveKeyPairOptions, context: string): string {
  const saltPrefix = options.saltPrefix ?? DEFAULT_KDF_CONTEXT.saltPrefix;
  const env = options.env ?? DEFAULT_KDF_CONTEXT.env;
  const base = `${saltPrefix}:${env}:${context}`;
  if (options.scrypt?.salt) return `${base}:${options.scrypt.salt}`;
  return base;
}

function resolveContextInfo(options: DeriveKeyPairOptions, context: string, curve: string): string {
  const infoPrefix = options.infoPrefix ?? DEFAULT_KDF_CONTEXT.infoPrefix;
  return `${infoPrefix}:${context}:${curve}`;
}

function deriveSeedBytesContext(
  seedInput: string | Uint8Array | undefined,
  curve: 'P-256' | 'P-384' | 'secp256k1',
  options: DeriveKeyPairOptions
): Buffer {
  const context = options.context?.trim();
  if (!context) {
    throw new Error('KDF context is required when kdf="context".');
  }

  const seedBytes = toSeedBytes(seedInput);
  const minSeedBytes = options.minSeedBytes ?? DEFAULT_KDF_CONTEXT.minSeedBytes;
  const forceScrypt = options.forceScrypt === true;
  const seedIsStrong = seedInput instanceof Uint8Array
    ? seedBytes.length >= minSeedBytes
    : isHex32((seedInput ?? '').toString());
  const useScrypt = forceScrypt || seedBytes.length < minSeedBytes || !seedIsStrong;
  const outLen = curve === 'P-384' ? 48 : 32;

  let ikm: Buffer;
  if (!seedBytes.length) {
    ikm = Buffer.from(randomBytes(outLen));
  } else if (useScrypt) {
    const scryptConfig = options.scrypt ?? DEFAULT_SCRYPT;
    const salt = Buffer.from(resolveContextSalt(options, context), 'utf8');
    const dkLen = Math.max(scryptConfig.dkLen, outLen);
    ikm = scryptSync(seedBytes, salt, dkLen, {
      N: scryptConfig.N,
      r: scryptConfig.r,
      p: scryptConfig.p,
      maxmem: 128 * scryptConfig.N * scryptConfig.r * 2,
    });
  } else {
    ikm = Buffer.from(seedBytes.subarray(0, outLen));
  }

  const salt = Buffer.from(resolveContextSalt(options, context), 'utf8');
  const info = Buffer.from(resolveContextInfo(options, context, curve), 'utf8');
  return Buffer.from(hkdf(sha256, ikm, salt, info, outLen));
}

export async function deriveKeyPair(
  seedInput?: string | Uint8Array,
  curve: 'P-256' | 'P-384' | 'secp256k1' = 'P-256',
  options?: DeriveKeyPairOptions
): Promise<{
  pub: Uint8Array;
  jwk: {
    kty: string;
    crv: string;
    x: string;
    y: string;
    d: string;
  };
  seed: string;
  kid: string;
}> {
  const mode = options?.kdf ?? 'hash';
  const seedBuf = mode === 'context'
    ? deriveSeedBytesContext(seedInput, curve, options ?? {})
    : deriveSeedBytes(seedInput, options);
  const seed = Buffer.from(seedBuf).toString('hex');
  const privateKey = mode === 'context'
    ? seedBuf
    : (curve === 'P-384' ? sha384(seedBuf) : sha256(seedBuf));
  const pub = curve === 'P-384'
    ? p384.getPublicKey(privateKey, false)
    : (curve === 'secp256k1'
      ? secp256k1.getPublicKey(privateKey, false)
      : p256.getPublicKey(privateKey, false)); // 0x04 | X | Y

  const coordLen = (pub.length - 1) / 2;
  const x = Buffer.from(pub.slice(1, 1 + coordLen)).toString('base64url');
  const y = Buffer.from(pub.slice(1 + coordLen)).toString('base64url');
  const d = Buffer.from(privateKey).toString('base64url');

  const jwk = { kty: 'EC', crv: curve, x, y, d };
  const { d: _, ...pubJwk } = jwk;
  const thumb = await calculateJwkThumbprint(pubJwk, 'sha256');
  const kid = Buffer.from(thumb).toString('base64url');

  // console.log(`🔐 Generated seed: ${seed}`);
  // console.log(`🆔 Corresponding kid: ${kid}`);

  return { pub, jwk, seed, kid };
}

export async function createCertificate(
  subjectCN: string,
  issuerCN: string,
  subjectKey: CryptoKey,
  issuerKey: CryptoKey,
  publicKeyBytes: Uint8Array,
  years: number,
  legalRegistrationNumber: string,
  curve: 'P-256' | 'P-384' = 'P-256',
  isCA = false
): Promise<Buffer> {
  const cert = new pkijs.Certificate();
  cert.version = 2; // v3
  cert.serialNumber = new asn1js.Integer({ value: Math.floor(Date.now() / 1000) });

  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: issuerCN })
  }));
  cert.issuer.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.97', // organizationIdentifier
    value: new asn1js.PrintableString({ value: legalRegistrationNumber })
  }));
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.3',
    value: new asn1js.PrintableString({ value: subjectCN })
  }));
  cert.subject.typesAndValues.push(new pkijs.AttributeTypeAndValue({
    type: '2.5.4.97', // organizationIdentifier for ETSI EN 319 412-1, Gaia-X, eIDAS
    value: new asn1js.PrintableString({ value: legalRegistrationNumber })
  }));

  cert.notBefore.value = new Date();
  cert.notAfter.value = new Date();
  cert.notAfter.value.setFullYear(cert.notBefore.value.getFullYear() + years);

  const rawPublicKey = new Uint8Array(publicKeyBytes); // ensure correct format
  const cryptoPub = await crypto.subtle.importKey(
    'raw',
    rawPublicKey,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['verify']
  );
  await cert.subjectPublicKeyInfo.importKey(cryptoPub);

  const basicConstraints = new pkijs.Extension({
    extnID: '2.5.29.19',
    critical: true,
    extnValue: new pkijs.BasicConstraints({ cA: isCA }).toSchema().toBER(false),
  });

  const keyUsageBits = new Uint8Array(2);
  if (!isCA) {
    keyUsageBits[0] |= 0x80; // digitalSignature
    keyUsageBits[0] |= 0x20; // keyEncipherment
  } else {
    keyUsageBits[0] |= 0x80; // digitalSignature
    keyUsageBits[0] |= 0x04; // keyCertSign
    keyUsageBits[0] |= 0x02; // cRLSign
  }

  const keyUsage = new pkijs.Extension({
    extnID: '2.5.29.15',
    critical: true,
    extnValue: new asn1js.BitString({ valueHex: keyUsageBits.buffer }).toBER(false),
  });

  const skiValue = await crypto.subtle.digest(
    'SHA-1',
    cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHex
  );
  const subjectKeyIdentifier = new pkijs.Extension({
    extnID: '2.5.29.14',
    critical: false,
    extnValue: new asn1js.OctetString({ valueHex: skiValue }).toBER(false),
  });

  cert.extensions = [basicConstraints, keyUsage, subjectKeyIdentifier];

  await cert.sign(issuerKey, 'SHA-256');
  return Buffer.from(cert.toSchema(true).toBER(false));
}
