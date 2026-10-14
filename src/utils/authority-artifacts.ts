// src/utils/authority-artifacts.ts

import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

export type AuthorityArtifacts = {
  role: 'CA' | 'ICA';
  didDocument: any;
  jwks: any;
  legalParticipantVc?: any;
  legacySignAlg: 'ES256' | 'ES384';
  legacyPrivateJwk?: any;
  legacyX509ChainBase64: string[];
};

function readJsonFile(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readDerBase64(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath).toString('base64');
}

function findFile(baseDir: string, prefix: string, extensions: string[]): string {
  const files = readdirSync(baseDir);
  const match = files.find((file) => extensions.some((ext) => file.startsWith(prefix) && file.endsWith(ext)));
  if (!match) {
    throw new Error(`Missing ${prefix}* in ${baseDir}`);
  }
  return path.join(baseDir, match);
}

export function loadAuthorityArtifacts(role: 'CA' | 'ICA', baseDir: string, rootDerPath?: string): AuthorityArtifacts {
  const didDocument = readJsonFile(findFile(baseDir, 'did-', ['.json']));
  const jwks = readJsonFile(findFile(baseDir, 'jwks-', ['.json']));
  const legalParticipantVcPath = findFile(baseDir, 'LegalParticipantCredential-', ['.jsonld']);
  const legalParticipantVc = existsSync(legalParticipantVcPath) ? readJsonFile(legalParticipantVcPath) : undefined;
  const legacyPrivateJwkPath = path.join(baseDir, 'private-jwk.json');
  const legacyPrivateJwk = existsSync(legacyPrivateJwkPath) ? readJsonFile(legacyPrivateJwkPath) : undefined;

  const roleDerPath = role === 'CA'
    ? path.join(baseDir, 'root-cert.der')
    : path.join(baseDir, 'ica-cert.der');
  const roleDerBase64 = readDerBase64(roleDerPath);
  const rootDerBase64 = rootDerPath ? readDerBase64(rootDerPath) : undefined;
  const jwkAlg = jwks?.keys?.find((key: any) => key.alg && String(key.alg).startsWith('ES'))?.alg;
  const legacySignAlg: 'ES256' | 'ES384' = jwkAlg === 'ES384' ? 'ES384' : 'ES256';
  const legacyX509ChainBase64 = [
    ...(roleDerBase64 ? [roleDerBase64] : []),
    ...(rootDerBase64 ? [rootDerBase64] : []),
  ];

  return {
    role,
    didDocument,
    jwks,
    legalParticipantVc,
    legacySignAlg,
    legacyPrivateJwk,
    legacyX509ChainBase64,
  };
}
