// src/utils/pki-chain.ts

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import path from 'path';
import { Crypto } from '@peculiar/webcrypto';
import * as pkijs from 'pkijs';
import {
  AuthorityConfig,
  buildX5cChain,
  bufferToPem,
  createCertificate,
  deriveKeyPair,
  generateMSPID,
  resolveOutputDir,
  saveJwkDidAndCredential,
  writeArtifactManifest,
  writeX509ChainArtifacts,
} from './pki';

type PkiChainOptions = {
  cleanOutput?: boolean;
};

const FABRIC_MULTICLOUD_DIR = process.env.FABRIC_MULTICLOUD_DIR || path.resolve(process.cwd(), '..', 'fabric-multicloud');

const EnvKeys = {
  ROOT_CA_DOMAIN: 'ROOT_CA_DOMAIN',
  ROOT_CA_JURISDICTION: 'ROOT_CA_JURISDICTION',
  ROOT_CA_CERT_COUNTRY: 'ROOT_CA_CERT_COUNTRY',
  ROOT_CA_CITY: 'ROOT_CA_CITY',
  ROOT_CA_STREET: 'ROOT_CA_STREET',
  ROOT_CA_POSTAL_CODE: 'ROOT_CA_POSTAL_CODE',
  ROOT_CA_LEGAL_ID_TYPE: 'ROOT_CA_LEGAL_ID_TYPE',
  ROOT_CA_LEGAL_ID_NUMBER: 'ROOT_CA_LEGAL_ID_NUMBER',
  ROOT_CA_LEGAL_NAME: 'ROOT_CA_LEGAL_NAME',
  ICA_DOMAIN: 'ICA_DOMAIN',
  ICA_JURISDICTION: 'ICA_JURISDICTION',
  ICA_CERT_COUNTRY: 'ICA_CERT_COUNTRY',
  ICA_CITY: 'ICA_CITY',
  ICA_STREET: 'ICA_STREET',
  ICA_POSTAL_CODE: 'ICA_POSTAL_CODE',
  ICA_LEGAL_ID_TYPE: 'ICA_LEGAL_ID_TYPE',
  ICA_LEGAL_ID_NUMBER: 'ICA_LEGAL_ID_NUMBER',
  ICA_LEGAL_NAME: 'ICA_LEGAL_NAME',
  HOST_JURISDICTION: 'HOST_JURISDICTION',
  HOST_CERT_COUNTRY: 'HOST_CERT_COUNTRY',
  HOST_CITY: 'HOST_CITY',
  HOST_STREET: 'HOST_STREET',
  HOST_POSTAL_CODE: 'HOST_POSTAL_CODE',
  HOST_ID_TYPE: 'HOST_ID_TYPE',
  HOST_ID_VALUE: 'HOST_ID_VALUE',
  HOST_LEGAL_ID_TYPE: 'HOST_LEGAL_ID_TYPE',
  HOST_LEGAL_ID_NUMBER: 'HOST_LEGAL_ID_NUMBER',
  HOST_LEGAL_NAME: 'HOST_LEGAL_NAME',
  HOST_DOMAIN: 'HOST_DOMAIN',
  HOST_CN: 'HOST_CN',
} as const;

/**
 * Resolves the ISO 3166-1 alpha-2 value written into an X.509 certificate.
 * A business jurisdiction may be more specific (for example `CA-BC`) and is
 * therefore kept separate from the certificate country (`CA`).
 */
export function resolveCertificateCountryCode(jurisdiction: string, override?: string): string {
  const countryCode = String(override || jurisdiction).trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(countryCode)) {
    throw new Error(`Certificate country must use ISO 3166-1 alpha-2: ${countryCode}`);
  }
  return countryCode;
}

function getEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function buildLegalNumber(options: {
  region?: string;
  jurisdiction: string;
  idType: string;
  idValue: string;
}): string {
  const region = (options.region || '').toUpperCase();
  const jurisdiction = options.jurisdiction.toUpperCase();
  const idType = options.idType.toUpperCase();
  const idValue = options.idValue;
  const normalizedType = region === 'EU' && idType === 'TAX' ? 'VAT' : idType;

  if (region === 'EU' && normalizedType === 'VAT') {
    return `VAT${jurisdiction}-${idValue}`;
  }
  return `${normalizedType}-${idValue}`;
}

export async function generatePkiChainFromEnv(options?: PkiChainOptions): Promise<void> {
  const crypto = new Crypto();
  pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

  const ROOT_CA_DOMAIN = getEnv(EnvKeys.ROOT_CA_DOMAIN);
  const ICA_DOMAIN = getEnv(EnvKeys.ICA_DOMAIN);
  const ROOT_CA_JURISDICTION = getEnv(EnvKeys.ROOT_CA_JURISDICTION);
  const ROOT_CA_CITY = getEnv(EnvKeys.ROOT_CA_CITY);
  const ROOT_CA_STREET = getEnv(EnvKeys.ROOT_CA_STREET);
  const ROOT_CA_POSTAL_CODE = getEnv(EnvKeys.ROOT_CA_POSTAL_CODE);
  const ICA_JURISDICTION = getEnv(EnvKeys.ICA_JURISDICTION);
  const ICA_CITY = getEnv(EnvKeys.ICA_CITY);
  const ICA_STREET = getEnv(EnvKeys.ICA_STREET);
  const ICA_POSTAL_CODE = getEnv(EnvKeys.ICA_POSTAL_CODE);
  const HOST_JURISDICTION = getEnv(EnvKeys.HOST_JURISDICTION);
  const HOST_CITY = getEnv(EnvKeys.HOST_CITY);
  const HOST_STREET = getEnv(EnvKeys.HOST_STREET);
  const HOST_POSTAL_CODE = getEnv(EnvKeys.HOST_POSTAL_CODE);
  const HOST_ID_TYPE = getEnv(EnvKeys.HOST_ID_TYPE);
  const HOST_ID_VALUE = getEnv(EnvKeys.HOST_ID_VALUE);
  const HOST_REGION = process.env.HOST_REGION;
  const ROOT_CA_REGION = process.env.ROOT_CA_REGION;
  const ICA_REGION = process.env.ICA_REGION;
  const ROOT_CA_LEGAL_ID_TYPE = getEnv(EnvKeys.ROOT_CA_LEGAL_ID_TYPE);
  const ROOT_CA_LEGAL_ID_NUMBER = getEnv(EnvKeys.ROOT_CA_LEGAL_ID_NUMBER);
  const ICA_LEGAL_ID_TYPE = getEnv(EnvKeys.ICA_LEGAL_ID_TYPE);
  const ICA_LEGAL_ID_NUMBER = getEnv(EnvKeys.ICA_LEGAL_ID_NUMBER);
  const HOST_LEGAL_ID_TYPE = getEnv(EnvKeys.HOST_LEGAL_ID_TYPE);
  const HOST_LEGAL_ID_NUMBER = getEnv(EnvKeys.HOST_LEGAL_ID_NUMBER);

  const ROOT_CA_SEED = process.env.ROOT_CA_SEED || 'a0a1a2a3a4a5a6a7a8a9aaabacadaeaf';
  const ICA_SEED = process.env.ICA_SEED || '';
  const LEGACY_SIGN_ALG = (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
    ? process.env.LEGACY_SIGN_ALG
    : 'ES384';
  const LEGACY_CURVE: 'P-256' | 'P-384' = LEGACY_SIGN_ALG === 'ES384' ? 'P-384' : 'P-256';

  const rootCA: AuthorityConfig = {
    legalRegistrationNumber: buildLegalNumber({
      region: ROOT_CA_REGION,
      jurisdiction: ROOT_CA_JURISDICTION,
      idType: ROOT_CA_LEGAL_ID_TYPE,
      idValue: ROOT_CA_LEGAL_ID_NUMBER,
    }),
    domain: ROOT_CA_DOMAIN,
    subjectCN: ROOT_CA_DOMAIN,
    officialName: getEnv(EnvKeys.ROOT_CA_LEGAL_NAME),
    countryCode: resolveCertificateCountryCode(ROOT_CA_JURISDICTION, process.env[EnvKeys.ROOT_CA_CERT_COUNTRY]),
    location: { city: ROOT_CA_CITY, street: ROOT_CA_STREET, postalCode: ROOT_CA_POSTAL_CODE },
    seed: ROOT_CA_SEED,
  };

  const ica: AuthorityConfig = {
    legalRegistrationNumber: buildLegalNumber({
      region: ICA_REGION,
      jurisdiction: ICA_JURISDICTION,
      idType: ICA_LEGAL_ID_TYPE,
      idValue: ICA_LEGAL_ID_NUMBER,
    }),
    domain: ICA_DOMAIN,
    subjectCN: ICA_DOMAIN,
    officialName: getEnv(EnvKeys.ICA_LEGAL_NAME),
    countryCode: resolveCertificateCountryCode(ICA_JURISDICTION, process.env[EnvKeys.ICA_CERT_COUNTRY]),
    location: { city: ICA_CITY, street: ICA_STREET, postalCode: ICA_POSTAL_CODE },
    seed: ICA_SEED,
  };

  const hostCert: AuthorityConfig = {
    legalRegistrationNumber: buildLegalNumber({
      region: HOST_REGION,
      jurisdiction: HOST_JURISDICTION,
      idType: HOST_LEGAL_ID_TYPE,
      idValue: HOST_LEGAL_ID_NUMBER,
    }),
    domain: getEnv(EnvKeys.HOST_DOMAIN),
    subjectCN: getEnv(EnvKeys.HOST_CN),
    officialName: getEnv(EnvKeys.HOST_LEGAL_NAME),
    countryCode: resolveCertificateCountryCode(HOST_JURISDICTION, process.env[EnvKeys.HOST_CERT_COUNTRY]),
    location: { city: HOST_CITY, street: HOST_STREET, postalCode: HOST_POSTAL_CODE },
    seed: process.env.HOST_SEED || '',
  };

  if (options?.cleanOutput) {
    rmSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-root'), { recursive: true, force: true });
    rmSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-ica'), { recursive: true, force: true });
  }

  mkdirSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-root'), { recursive: true });
  mkdirSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-ica'), { recursive: true });

  // Root CA
  const rootKeyPair = await deriveKeyPair(rootCA.seed as string, LEGACY_CURVE);
  const rootKey = await crypto.subtle.importKey('jwk', rootKeyPair.jwk, { name: 'ECDSA', namedCurve: LEGACY_CURVE }, true, ['sign']);
  const rootCert = await createCertificate(rootCA.subjectCN, rootCA.subjectCN, rootKey, rootKey, rootKeyPair.pub, 10, rootCA.legalRegistrationNumber, LEGACY_CURVE, true);

  writeFileSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-root', 'ca-cert.pem'), bufferToPem(rootCert, 'CERTIFICATE'));
  writeFileSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-root', 'ca-key.pem'), bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', rootKey)), 'PRIVATE KEY'));

  const rootOut = resolveOutputDir('full-pki-chain-root-ca');
  writeFileSync(`${rootOut}/root-cert.pem`, bufferToPem(rootCert, 'CERTIFICATE'));
  writeFileSync(`${rootOut}/root-cert.der`, rootCert);
  writeX509ChainArtifacts(rootOut, [rootCert]);
  const { d: _rootPriv, ...rootPubJwk } = rootKeyPair.jwk;
  await saveJwkDidAndCredential(rootCA, rootPubJwk, rootKeyPair.kid, rootOut, {
    x5c: buildX5cChain([rootCert]),
    x5u: `https://${rootCA.domain}/.well-known/x509.der`,
  });
  writeArtifactManifest(rootOut, rootCA, {
    role: 'CA',
    did: `did:web:${rootCA.domain}`,
    didFile: `did-${rootCA.domain}.json`,
    jwksFile: `jwks-${rootCA.domain}.json`,
    credentialFile: `LegalParticipantCredential-${rootCA.domain}.jsonld`,
    x509DerFile: 'x509.der',
    x509ChainDerFile: 'x509-chain.der',
    extraFiles: ['root-cert.der', 'root-cert.pem'],
  });
  writeFileSync(`${rootOut}/private-jwk.json`, JSON.stringify(rootKeyPair.jwk, null, 2));

  // ICA
  const icaKeyPair = await deriveKeyPair(ica.seed as string, LEGACY_CURVE);
  const icaKey = await crypto.subtle.importKey('jwk', icaKeyPair.jwk, { name: 'ECDSA', namedCurve: LEGACY_CURVE }, true, ['sign']);
  const icaCert = await createCertificate(ica.subjectCN, rootCA.subjectCN, icaKey, rootKey, icaKeyPair.pub, 5, ica.legalRegistrationNumber, LEGACY_CURVE, true);

  writeFileSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-ica', 'ca-cert.pem'), bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-ica', 'ca-key.pem'), bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', icaKey)), 'PRIVATE KEY'));
  writeFileSync(path.join(FABRIC_MULTICLOUD_DIR, 'fabric-ca-server-ica', 'ca-chain.pem'), bufferToPem(rootCert, 'CERTIFICATE'));

  const icaOut = resolveOutputDir('full-pki-chain-ica');
  writeFileSync(`${icaOut}/ica-cert.pem`, bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync(`${icaOut}/ica-cert.der`, icaCert);
  writeX509ChainArtifacts(icaOut, [icaCert, rootCert]);
  const { d: _icaPriv, ...icaPubJwk } = icaKeyPair.jwk;
  await saveJwkDidAndCredential(ica, icaPubJwk, icaKeyPair.kid, icaOut, {
    x5c: buildX5cChain([icaCert, rootCert]),
    x5u: `https://${ica.domain}/.well-known/x509.der`,
  });
  writeArtifactManifest(icaOut, ica, {
    role: 'ICA',
    did: `did:web:${ica.domain}`,
    didFile: `did-${ica.domain}.json`,
    jwksFile: `jwks-${ica.domain}.json`,
    credentialFile: `LegalParticipantCredential-${ica.domain}.jsonld`,
    x509DerFile: 'x509.der',
    x509ChainDerFile: 'x509-chain.der',
    extraFiles: ['ica-cert.der', 'ica-cert.pem'],
  });
  writeFileSync(`${icaOut}/private-jwk.json`, JSON.stringify(icaKeyPair.jwk, null, 2));

  // Host / MSP
  const hostKeyPair = await deriveKeyPair(hostCert.seed as string, LEGACY_CURVE);
  const hostKey = await crypto.subtle.importKey('jwk', hostKeyPair.jwk, { name: 'ECDSA', namedCurve: LEGACY_CURVE }, true, ['sign']);
  const hostCertBuffer = await createCertificate(hostCert.subjectCN, ica.subjectCN, hostKey, icaKey, hostKeyPair.pub, 2, hostCert.legalRegistrationNumber, LEGACY_CURVE, false);

  const hostMspId = generateMSPID(hostCert);
  const hostOut = resolveOutputDir(`full-pki-chain-msp-${hostMspId}`);
  mkdirSync(`${hostOut}/keystore`, { recursive: true });
  mkdirSync(`${hostOut}/signcerts`, { recursive: true });
  mkdirSync(`${hostOut}/cacerts`, { recursive: true });
  mkdirSync(`${hostOut}/intermediatecerts`, { recursive: true });

  writeFileSync(`${hostOut}/keystore/private-jwk.json`, JSON.stringify(hostKeyPair.jwk, null, 2));
  writeFileSync(`${hostOut}/signcerts/cert.pem`, bufferToPem(hostCertBuffer, 'CERTIFICATE'));
  writeFileSync(`${hostOut}/signcerts/cert.der`, hostCertBuffer);
  writeFileSync(`${hostOut}/cacerts/root-cert.pem`, bufferToPem(rootCert, 'CERTIFICATE'));
  writeFileSync(`${hostOut}/intermediatecerts/ica-cert.pem`, bufferToPem(icaCert, 'CERTIFICATE'));
  writeX509ChainArtifacts(hostOut, [hostCertBuffer, icaCert, rootCert]);
  const { d: _hostPriv, ...hostPubJwk } = hostKeyPair.jwk;
  await saveJwkDidAndCredential(hostCert, hostPubJwk, hostKeyPair.kid, hostOut, {
    x5c: buildX5cChain([hostCertBuffer, icaCert, rootCert]),
    x5u: `https://${hostCert.domain}/.well-known/x509.der`,
  });
  writeArtifactManifest(hostOut, hostCert, {
    role: 'HOST',
    did: `did:web:${hostCert.domain}`,
    didFile: `did-${hostCert.domain}.json`,
    jwksFile: `jwks-${hostCert.domain}.json`,
    credentialFile: `LegalParticipantCredential-${hostCert.domain}.jsonld`,
    x509DerFile: 'x509.der',
    x509ChainDerFile: 'x509-chain.der',
    extraFiles: ['signcerts/cert.der', 'signcerts/cert.pem', 'cacerts/root-cert.pem', 'intermediatecerts/ica-cert.pem'],
  });
}
