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
  const hostJsonPath = getArgValue('--json') || getArgValue('--host');
  const icaJsonPath = getArgValue('--ica-json');
  const icaDir = getArgValue('--ica-dir');
  const caDir = getArgValue('--ca-dir');
  if (!hostJsonPath || !icaJsonPath || !icaDir || !caDir) {
    throw new Error(
      'Usage: generate-host.ts --json <host-organization.json> --ica-json <ica-organization.json> --ica-dir <ica-output-dir> --ca-dir <root-ca-output-dir> [--seed <hex>] [--env test|prod] [--kdf auto|scrypt|hash|context] [--context <name>] [--kdf-config <path>]'
    );
  }

  const envName = getEnvName();
  const seedArg = getArgValue('--seed');
  const seed = seedArg ?? (await promptSeed('Host'));

  const { authority: hostAuthority, countryCode, taxId } = loadOrganizationIdentity(hostJsonPath, seed);
  const { authority: icaAuthority } = loadOrganizationIdentity(icaJsonPath);

  const icaKeyPath = path.join(icaDir, 'private-jwk.json');
  const icaCertDerPath = path.join(icaDir, 'ica-cert.der');
  const caCertDerPath = path.join(caDir, 'root-cert.der');
  const icaJwk = JSON.parse(readFileSync(icaKeyPath, 'utf8'));
  const icaCertDer = readFileSync(icaCertDerPath);
  const caCertDer = readFileSync(caCertDerPath);

  const curve = icaJwk.crv === 'P-256' ? 'P-256' : 'P-384';
  const hostKeyPair = await deriveKeyPair(hostAuthority.seed as string, curve, loadKdfConfig());

  const { Crypto } = await import('@peculiar/webcrypto');
  const cryptoInstance = new Crypto();
  const icaKey = await cryptoInstance.subtle.importKey(
    'jwk',
    icaJwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );
  const hostKey = await cryptoInstance.subtle.importKey(
    'jwk',
    hostKeyPair.jwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );

  const hostCert = await createCertificate(
    hostAuthority.subjectCN,
    icaAuthority.subjectCN,
    hostKey,
    icaKey,
    hostKeyPair.pub,
    2,
    hostAuthority.legalRegistrationNumber,
    curve,
    false
  );

  const mspId = generateMSPID(hostAuthority);
  const baseDir = path.join('artifacts', envName);
  const outDir = path.join(baseDir, 'pki-host', mspId);
  const leafName = buildLeafCertificateName('HOST_', countryCode, taxId);

  if (existsSync(outDir)) {
    await confirmOverwrite(outDir);
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, 'keystore'), { recursive: true });
  mkdirSync(path.join(outDir, 'signcerts'), { recursive: true });
  mkdirSync(path.join(outDir, 'cacerts'), { recursive: true });
  mkdirSync(path.join(outDir, 'intermediatecerts'), { recursive: true });

  writeFileSync(path.join(outDir, 'keystore', 'private-jwk.json'), JSON.stringify(hostKeyPair.jwk, null, 2));
  writeFileSync(path.join(outDir, 'signcerts', 'cert.pem'), bufferToPem(hostCert, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'signcerts', `${leafName}.pem`), bufferToPem(hostCert, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'signcerts', 'cert.der'), hostCert);
  writeFileSync(path.join(outDir, 'signcerts', `${leafName}.der`), hostCert);
  writeFileSync(path.join(outDir, 'cacerts', 'root-cert.der'), caCertDer);
  writeFileSync(path.join(outDir, 'intermediatecerts', 'ica-cert.der'), icaCertDer);
  writeFileSync(path.join(outDir, 'cacerts', 'root-cert.pem'), bufferToPem(caCertDer, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'intermediatecerts', 'ica-cert.pem'), bufferToPem(icaCertDer, 'CERTIFICATE'));
  writeX509ChainArtifacts(outDir, [hostCert, icaCertDer, caCertDer]);

  const { d: _priv, ...pubJwk } = hostKeyPair.jwk;
  await saveJwkDidAndCredential(hostAuthority, pubJwk, hostKeyPair.kid, outDir, {
    x5c: buildX5cChain([hostCert, icaCertDer, caCertDer]),
    x5u: `https://${hostAuthority.domain}/.well-known/x509.der`,
  });
  writeArtifactManifest(outDir, hostAuthority, {
    role: 'HOST',
    did: `did:web:${hostAuthority.domain}`,
    didFile: `did-${hostAuthority.domain}.json`,
    jwksFile: `jwks-${hostAuthority.domain}.json`,
    credentialFile: `LegalParticipantCredential-${hostAuthority.domain}.jsonld`,
    x509DerFile: 'x509.der',
    x509ChainDerFile: 'x509-chain.der',
    extraFiles: ['signcerts/cert.der', 'signcerts/cert.pem', 'cacerts/root-cert.der', 'intermediatecerts/ica-cert.der'],
  });
}

main().catch((error) => {
  console.error('Failed to generate host certificate:', error);
  process.exit(1);
});
