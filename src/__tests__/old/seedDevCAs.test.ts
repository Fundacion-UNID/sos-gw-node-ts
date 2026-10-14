// src/__tests__/setup/seedDevCAs.test.ts

import 'dotenv/config'; // Load .env file
import fs from 'fs';
import path from 'path';
import * as pkijs from 'pkijs';
import { Crypto } from '@peculiar/webcrypto';
import {
  AuthorityConfig,
  deriveKeyPair,
  createCertificate,
  bufferToPem,
} from '../../utils/pki';

// Increase timeout for this test suite as key generation can be slow
jest.setTimeout(30000); 

const crypto = new Crypto();
pkijs.setEngine('nodeEngine', crypto, crypto.subtle);

function getEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing environment variable: ${key}. Please check your .env file.`);
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

const REQUIRED_ENV_VARS = [
  'ROOT_CA_SEED',
  'ICA_SEED',
  'ROOT_CA_DOMAIN',
  'ICA_DOMAIN',
  'ROOT_CA_LEGAL_ID_TYPE',
  'ROOT_CA_LEGAL_ID_NUMBER',
  'ROOT_CA_LEGAL_NAME',
  'ICA_LEGAL_ID_TYPE',
  'ICA_LEGAL_ID_NUMBER',
  'ICA_LEGAL_NAME',
  'ROOT_CA_JURISDICTION',
  'ROOT_CA_CITY',
  'ROOT_CA_STREET',
  'ROOT_CA_POSTAL_CODE',
  'ICA_JURISDICTION',
  'ICA_CITY',
  'ICA_STREET',
  'ICA_POSTAL_CODE',
] as const;

const missingEnv = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
const describeIfEnv = missingEnv.length === 0 ? describe : describe.skip;

const ROOT_CA_SEED = process.env.ROOT_CA_SEED ? getEnv('ROOT_CA_SEED') : '';
const ICA_SEED = process.env.ICA_SEED ? getEnv('ICA_SEED') : '';
const ROOT_CA_DOMAIN = process.env.ROOT_CA_DOMAIN ? getEnv('ROOT_CA_DOMAIN') : '';
const ICA_DOMAIN = process.env.ICA_DOMAIN ? getEnv('ICA_DOMAIN') : '';
const ROOT_CA_REGION = process.env.ROOT_CA_REGION;
const ICA_REGION = process.env.ICA_REGION;

function buildRootCAConfig(): AuthorityConfig {
  return {
    legalRegistrationNumber: buildLegalNumber({
      region: ROOT_CA_REGION,
      jurisdiction: getEnv('ROOT_CA_JURISDICTION'),
      idType: getEnv('ROOT_CA_LEGAL_ID_TYPE'),
      idValue: getEnv('ROOT_CA_LEGAL_ID_NUMBER'),
    }),
    domain: ROOT_CA_DOMAIN,
    subjectCN: ROOT_CA_DOMAIN,
    officialName: getEnv('ROOT_CA_LEGAL_NAME'),
    countryCode: getEnv('ROOT_CA_JURISDICTION'),
    location: { city: getEnv('ROOT_CA_CITY'), street: getEnv('ROOT_CA_STREET'), postalCode: getEnv('ROOT_CA_POSTAL_CODE') },
    seed: ROOT_CA_SEED,
  };
}

function buildIcaConfig(): AuthorityConfig {
  return {
    legalRegistrationNumber: buildLegalNumber({
      region: ICA_REGION,
      jurisdiction: getEnv('ICA_JURISDICTION'),
      idType: getEnv('ICA_LEGAL_ID_TYPE'),
      idValue: getEnv('ICA_LEGAL_ID_NUMBER'),
    }),
    domain: ICA_DOMAIN,
    subjectCN: ICA_DOMAIN,
    officialName: getEnv('ICA_LEGAL_NAME'),
    countryCode: getEnv('ICA_JURISDICTION'),
    location: { city: getEnv('ICA_CITY'), street: getEnv('ICA_STREET'), postalCode: getEnv('ICA_POSTAL_CODE') },
    seed: ICA_SEED,
  };
}

function resolveOutputDir(...segments: string[]) {
    const dir = path.join(process.cwd(), ...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

describeIfEnv('Development CAs Seeding', () => {
  it('should generate all required crypto material for Root CA and Intermediate CA', async () => {
    // console.log('🔥 Starting generation of crypto material for development CAs...');

    const rootCAConfig = buildRootCAConfig();
    const icaConfig = buildIcaConfig();

    const rootDir = resolveOutputDir('fabric-ca-server-root');
    const icaDir = resolveOutputDir('fabric-ca-server-ica');
    
    // console.log('🧹 Cleaning up previous crypto material...');
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(icaDir, { recursive: true, force: true });
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(icaDir, { recursive: true });

    // --- Root CA ---
    // console.log('🌱 Generating Root CA...');
    const rootKeyPair = await deriveKeyPair(rootCAConfig.seed);
    const rootPrivKey = await crypto.subtle.importKey('jwk', rootKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
    
    const rootCertBuffer = await createCertificate(
      rootCAConfig.subjectCN,
      rootCAConfig.subjectCN,
      rootPrivKey,
      rootPrivKey,
      rootKeyPair.pub,
      10,
      rootCAConfig.legalRegistrationNumber
    );

    fs.writeFileSync(path.join(rootDir, 'ca-cert.pem'), bufferToPem(rootCertBuffer, 'CERTIFICATE'));
    const rootPrivKeyPem = bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', rootPrivKey)), 'PRIVATE KEY');
    fs.writeFileSync(path.join(rootDir, 'ca-key.pem'), rootPrivKeyPem);
    // console.log(`✅ Root CA material generated in ${rootDir}`);

    // --- Intermediate CA ---
    // console.log('🌿 Generating Intermediate CA...');
    const icaKeyPair = await deriveKeyPair(icaConfig.seed);
    const icaPrivKey = await crypto.subtle.importKey('jwk', icaKeyPair.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);

    const icaCertBuffer = await createCertificate(
      icaConfig.subjectCN,
      rootCAConfig.subjectCN,
      icaPrivKey,
      rootPrivKey,
      icaKeyPair.pub,
      5,
      icaConfig.legalRegistrationNumber
    );
    
    fs.writeFileSync(path.join(icaDir, 'ca-cert.pem'), bufferToPem(icaCertBuffer, 'CERTIFICATE'));
    const icaPrivKeyPem = bufferToPem(Buffer.from(await crypto.subtle.exportKey('pkcs8', icaPrivKey)), 'PRIVATE KEY');
    fs.writeFileSync(path.join(icaDir, 'ca-key.pem'), icaPrivKeyPem);
    fs.writeFileSync(path.join(icaDir, 'ca-chain.pem'), bufferToPem(rootCertBuffer, 'CERTIFICATE'));
    
    // console.log(`✅ Intermediate CA material generated in ${icaDir}`);
    // console.log('\n🚀 Crypto material generated successfully. You can now start the CAs with \`docker-compose up -d\`.');
  });
});
