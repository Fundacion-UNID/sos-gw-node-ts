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
import { loadOrganizationIdentity } from '../src/utils/organization-json';
import { confirmOverwrite, getArgValue, getEnvName, loadKdfConfig, promptSeed } from './utils/pki-script-utils';

async function main() {
  const icaJsonPath = getArgValue('--json') || getArgValue('--ica');
  const caJsonPath = getArgValue('--ca-json') || getArgValue('--ca');
  const caDir = getArgValue('--ca-dir');
  if (!icaJsonPath || !caJsonPath || !caDir) {
    throw new Error(
      'Usage: generate-ica.ts --json <ica-organization.json> --ca-json <ca-organization.json> --ca-dir <root-ca-output-dir> [--seed <hex>] [--env test|prod] [--kdf auto|scrypt|hash|context] [--context <name>] [--kdf-config <path>]'
    );
  }

  const envName = getEnvName();
  const seedArg = getArgValue('--seed');
  const seed = seedArg ?? (await promptSeed('ICA'));

  const { authority: icaAuthority } = loadOrganizationIdentity(icaJsonPath, seed);
  const { authority: caAuthority } = loadOrganizationIdentity(caJsonPath);

  const caKeyPath = path.join(caDir, 'private-jwk.json');
  const caCertDerPath = path.join(caDir, 'root-cert.der');
  const caJwk = JSON.parse(readFileSync(caKeyPath, 'utf8'));
  const caCertDer = readFileSync(caCertDerPath);

  const curve = caJwk.crv === 'P-256' ? 'P-256' : 'P-384';
  const icaKeyPair = await deriveKeyPair(icaAuthority.seed as string, curve, loadKdfConfig());

  const { Crypto } = await import('@peculiar/webcrypto');
  const cryptoInstance = new Crypto();
  const caKey = await cryptoInstance.subtle.importKey(
    'jwk',
    caJwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );
  const icaKey = await cryptoInstance.subtle.importKey(
    'jwk',
    icaKeyPair.jwk,
    { name: 'ECDSA', namedCurve: curve },
    true,
    ['sign']
  );

  const icaCert = await createCertificate(
    icaAuthority.subjectCN,
    caAuthority.subjectCN,
    icaKey,
    caKey,
    icaKeyPair.pub,
    5,
    icaAuthority.legalRegistrationNumber,
    curve,
    true
  );

  const repoRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(repoRoot, '..');
  const fabricMulticloudDir = process.env.FABRIC_MULTICLOUD_DIR || path.join(workspaceRoot, 'fabric-multicloud');
  const baseDir = path.join('artifacts', envName);
  const icaMspId = generateMSPID(icaAuthority);
  const caServerDir = path.join(fabricMulticloudDir, 'fabric-ca-server-ica', icaMspId);

  if (existsSync(caServerDir)) {
    await confirmOverwrite(caServerDir);
    rmSync(caServerDir, { recursive: true, force: true });
  }
  mkdirSync(caServerDir, { recursive: true });
  writeFileSync(path.join(caServerDir, 'ca-cert.pem'), bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync(
    path.join(caServerDir, 'ca-key.pem'),
    bufferToPem(Buffer.from(await cryptoInstance.subtle.exportKey('pkcs8', icaKey)), 'PRIVATE KEY')
  );
  writeFileSync(path.join(caServerDir, 'ca-chain.pem'), bufferToPem(caCertDer, 'CERTIFICATE'));

  const outDir = path.join(baseDir, 'pki-ica', icaMspId);
  if (existsSync(outDir)) {
    await confirmOverwrite(outDir);
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  writeFileSync(path.join(outDir, 'ica-cert.pem'), bufferToPem(icaCert, 'CERTIFICATE'));
  writeFileSync(path.join(outDir, 'ica-cert.der'), icaCert);
  writeFileSync(path.join(outDir, 'private-jwk.json'), JSON.stringify(icaKeyPair.jwk, null, 2));
  writeFileSync(path.join(outDir, 'ca-cert.der'), caCertDer);
  writeX509ChainArtifacts(outDir, [icaCert, caCertDer]);
  const { d: _priv, ...pubJwk } = icaKeyPair.jwk;
  await saveJwkDidAndCredential(icaAuthority, pubJwk, icaKeyPair.kid, outDir, {
    x5c: buildX5cChain([icaCert, caCertDer]),
    x5u: `https://${icaAuthority.domain}/.well-known/x509.der`,
  });
  writeArtifactManifest(outDir, icaAuthority, {
    role: 'ICA',
    did: `did:web:${icaAuthority.domain}`,
    didFile: `did-${icaAuthority.domain}.json`,
    jwksFile: `jwks-${icaAuthority.domain}.json`,
    credentialFile: `LegalParticipantCredential-${icaAuthority.domain}.jsonld`,
    x509DerFile: 'x509.der',
    x509ChainDerFile: 'x509-chain.der',
    extraFiles: ['ica-cert.der', 'ica-cert.pem', 'ca-cert.der'],
  });
}

main().catch((error) => {
  console.error('Failed to generate ICA:', error);
  process.exit(1);
});
