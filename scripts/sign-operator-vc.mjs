#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hkdf } from '@noble/hashes/hkdf';
import { sha384 } from '@noble/hashes/sha384';
import { p384 } from '@noble/curves/nist.js';
import { calculateJwkThumbprint } from 'jose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {
    vc: null,
    out: null,
    salt: 'gdc-operator-ica',
    info: 'gdc-operator-v1-es384',
    vm: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--vc') args.vc = value;
    if (argv[i] === '--out') args.out = value;
    if (argv[i] === '--salt') args.salt = value;
    if (argv[i] === '--info') args.info = value;
    if (argv[i] === '--vm') args.vm = value;
  }
  return args;
}

function resolvePath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

async function promptHidden(question) {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  let value = '';
  return new Promise((resolve) => {
    stdin.on('data', (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u0003') {
        process.exit(1);
      }
      value += char;
    });
  });
}

function base64UrlEncode(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function utf8Bytes(value) {
  return new TextEncoder().encode(value);
}

function deepSort(json) {
  if (Array.isArray(json)) return json.map((item) => deepSort(item));
  if (json && typeof json === 'object' && json.constructor === Object) {
    return Object.keys(json)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = deepSort(json[key]);
        return acc;
      }, {});
  }
  return json;
}

function canonicalize(obj) {
  const sorted = deepSort(obj);
  return JSON.stringify(sorted);
}

function derivePrivateKeyFromSeed(seed, salt, info) {
  const ikm = utf8Bytes(seed);
  const okm = hkdf(sha384, ikm, utf8Bytes(salt), utf8Bytes(info), 48);
  const n = p384.CURVE.n;
  const nMinusOne = n - 1n;
  let scalar = 0n;
  for (const byte of okm) scalar = (scalar << 8n) + BigInt(byte);
  scalar = (scalar % nMinusOne) + 1n;

  const privBytes = new Uint8Array(48);
  let temp = scalar;
  for (let i = 47; i >= 0; i -= 1) {
    privBytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return privBytes;
}

function publicKeyFromPrivate(privBytes) {
  const pub = p384.getPublicKey(privBytes, false);
  if (pub[0] !== 4) throw new Error('Unexpected public key format.');
  const x = pub.slice(1, 49);
  const y = pub.slice(49, 97);
  return { x, y };
}

function createDetachedJws(payloadBytes, jwk) {
  const protectedHeader = { alg: 'ES384', kid: jwk.kid };
  const protectedB64 = base64UrlEncode(utf8Bytes(JSON.stringify(protectedHeader)));
  const payloadB64 = base64UrlEncode(payloadBytes);
  const signingInput = `${protectedB64}.${payloadB64}`;
  const signature = p384.sign(utf8Bytes(signingInput), Buffer.from(jwk.d, 'base64url'), { format: 'compact' });
  const signatureB64 = base64UrlEncode(signature);
  return { protectedB64, signatureB64 };
}

async function main() {
  const args = parseArgs(process.argv);
  const defaultVc = path.resolve(__dirname, '..', '..', 'operators', 'operator-credential-accuro-ES_B87617981.json');
  const vcPath = resolvePath(args.vc || defaultVc);
  const outPath = resolvePath(args.out || vcPath);
  if (!vcPath || !fs.existsSync(vcPath)) throw new Error(`VC not found: ${vcPath}`);

  const seed = await promptHidden('Seed (hidden): ');
  if (!seed) throw new Error('Missing seed.');

  const vc = JSON.parse(fs.readFileSync(vcPath, 'utf8'));
  const { proof, ...unsignedVc } = vc;
  const canonical = canonicalize(unsignedVc);
  const payloadHash = createHash('sha256').update(canonical).digest();

  const privBytes = derivePrivateKeyFromSeed(seed, args.salt, args.info);
  const { x, y } = publicKeyFromPrivate(privBytes);
  const jwk = {
    kty: 'EC',
    crv: 'P-384',
    x: base64UrlEncode(x),
    y: base64UrlEncode(y),
    d: base64UrlEncode(privBytes),
  };
  jwk.kid = await calculateJwkThumbprint(jwk);

  const verificationMethod = args.vm || `${vc.issuer}#${jwk.kid}`;
  const { protectedB64, signatureB64 } = createDetachedJws(payloadHash, jwk);
  const proofValue = `${protectedB64}..${signatureB64}`;

  const proofEntry = {
    type: 'JsonWebSignature2020',
    created: new Date().toISOString(),
    verificationMethod,
    proofPurpose: 'assertionMethod',
    proofValue,
  };

  const existingProofs = Array.isArray(vc.proof) ? vc.proof : (vc.proof ? [vc.proof] : []);
  const nextProofs = [proofEntry];
  const signedVc = { ...vc, proof: nextProofs };

  fs.writeFileSync(outPath, JSON.stringify(signedVc, null, 2));
  console.log(`Signed VC: ${path.relative(process.cwd(), outPath)}`);
  console.log(`verificationMethod=${verificationMethod}`);
  console.log(`kid=${jwk.kid}`);
  console.log(`salt=${args.salt}`);
  console.log(`info=${args.info}`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
