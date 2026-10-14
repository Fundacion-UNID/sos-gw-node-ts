import 'dotenv/config';

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

import {
  buildX5cChain,
  bufferToPem,
  createCertificate,
  deriveKeyPair,
  generateMSPID,
  saveJwkDidAndCredential,
  writeArtifactManifest,
  writeX509ChainArtifacts,
} from '../src/utils/pki';
import { buildLeafCertificateName, loadOrganizationIdentity } from '../src/utils/organization-json';
import { confirmOverwrite, getArgValue, getEnvName, loadKdfConfig, promptSeed } from './utils/pki-script-utils';

async function main() {
  const memberJsonPath = getArgValue('--json') || getArgValue('--member');
  const icaJsonPath = getArgValue('--ica-json');
  const icaDir = getArgValue('--ica-dir');
  const caDir = getArgValue('--ca-dir');
  if (!memberJsonPath || !icaJsonPath || !icaDir || !caDir) {
    throw new Error(
      'Usage: generate-member.ts --json <member-organization.json> --ica-json <ica-organization.json> --ica-dir <ica-output-dir> --ca-dir <root-ca-output-dir> [--seed <hex>] [--env test|prod] [--kdf auto|scrypt|hash|context] [--context <name>] [--kdf-config <path>]'
    );
  }

  const envName = getEnvName();
  const seedArg = getArgValue('--seed');
  const seed = seedArg ?? (await promptSeed('Member'));

  const { authority: memberAuthority, countryCode, taxId } = loadOrganizationIdentity(memberJsonPath, seed);
  const { authority: icaAuthority } = loadOrganizationIdentity(icaJsonPath);

  const icaKeyPath = path.join(icaDir, 'private-jwk.json');
  const icaCertDerPath = path.join(icaDir, 'ica-cert.der');
  const caCertDerPath = path.join(caDir, 'root-cert.der');
  const icaJwk = JSON.parse(readFileSync(icaKeyPath, 'utf8'));
  const icaCertDer = readFileSync(icaCertDerPath);
  const caCertDer = readFileSync(caCertDerPath);

  const curve = icaJwk.crv === 'P-256' ? 'P-256' : 'P-384';
  const memberKeyPair = await deriveKeyPair(memberAuthority.seed as string, curve, loadKdfConfig());

  const { Crypto } = await import('@peculiar/webcrypto');
  const cryptoInstance = new Crypto();
  const icaKey = await cryptoInstance.subtle.importKey(
    'jwk',
    icaJwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );
  const memberKey = await cryptoInstance.subtle.importKey(
    'jwk',
    memberKeyPair.jwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );

  const memberCert = await createCertificate(
    memberAuthority.subjectCN,
    icaAuthority.subjectCN,
    memberKey,
    icaKey,
    memberKeyPair.pub,
    2,
    memberAuthority.legalRegistrationNumber,
    curve,
    false
  );

  const mspId = generateMSPID(memberAuthority);
  const baseDir = path.join('artifacts', envName);
  const outDir = path.join(baseDir, 'pki-member', mspId);
  const leafName = buildLeafCertificateName('MEMBER_', countryCode, taxId);

  if (existsSync(outDir)) {
    await confirmOverwrite(outDir);
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, 'keystore'), { recursive: true });
  mkdirSync(path.join(outDir, 'signcerts'), { recursive: true });
  mkdirSync(path.join(outDir, 'cacerts'), { recursive: true });
  mkdirSync(path.join(outDir, 'intermediatecerts'), { recursive: true });

  writeFileSync(path.join(outDir, 'keystore', 'private-jwk.json'), JSON.stringify(memberKeyPair.jwk, null, 2));
  writeFileSync(path.join(outDir, 'signcerts', 'cert.pem'), bufferToPem(memberCert, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'signcerts', `${leafName}.pem`), bufferToPem(memberCert, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'signcerts', 'cert.der'), memberCert);
  writeFileSync(path.join(outDir, 'signcerts', `${leafName}.der`), memberCert);
  writeFileSync(path.join(outDir, 'cacerts', 'root-cert.der'), caCertDer);
  writeFileSync(path.join(outDir, 'intermediatecerts', 'ica-cert.der'), icaCertDer);
  writeFileSync(path.join(outDir, 'cacerts', 'root-cert.pem'), bufferToPem(caCertDer, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'intermediatecerts', 'ica-cert.pem'), bufferToPem(icaCertDer, 'CERTIFICATE'));
  writeX509ChainArtifacts(outDir, [memberCert, icaCertDer, caCertDer]);

  const { d: _priv, ...pubJwk } = memberKeyPair.jwk;
  await saveJwkDidAndCredential(memberAuthority, pubJwk, memberKeyPair.kid, outDir, {
    x5c: buildX5cChain([memberCert, icaCertDer, caCertDer]),
    x5u: `https://${memberAuthority.domain}/.well-known/x509.der`,
  });
  writeArtifactManifest(outDir, memberAuthority, {
    role: 'MEMBER',
    did: `did:web:${memberAuthority.domain}`,
    didFile: `did-${memberAuthority.domain}.json`,
    jwksFile: `jwks-${memberAuthority.domain}.json`,
    credentialFile: `LegalParticipantCredential-${memberAuthority.domain}.jsonld`,
    x509DerFile: 'x509.der',
    x509ChainDerFile: 'x509-chain.der',
    extraFiles: ['signcerts/cert.der', 'signcerts/cert.pem', 'cacerts/root-cert.der', 'intermediatecerts/ica-cert.der'],
  });
}

main().catch((error) => {
  console.error('Failed to generate member certificate:', error);
  process.exit(1);
});
