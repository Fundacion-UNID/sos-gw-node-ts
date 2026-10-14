#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { FlattenedSign, calculateJwkThumbprint, exportJWK } from 'jose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { input: null, output: null, p12: null, pass: null };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i + 1];
    if (argv[i] === '--input') args.input = value;
    if (argv[i] === '--output') args.output = value;
    if (argv[i] === '--p12') args.p12 = value;
    if (argv[i] === '--pass') args.pass = value;
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

function extractPemBlocks(p12Path, passphrase) {
  const result = spawnSync('openssl', ['pkcs12', '-in', p12Path, '-nodes', '-passin', 'stdin'], {
    input: `${passphrase}\n`,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const error = result.stderr || result.stdout || 'openssl failed';
    throw new Error(error);
  }
  const output = result.stdout;
  const keyMatch = output.match(/-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----/);
  if (!keyMatch) throw new Error('Private key not found in PKCS#12 output.');

  const certMatches = output.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || [];
  if (certMatches.length === 0) throw new Error('Certificate not found in PKCS#12 output.');

  return { privateKeyPem: keyMatch[0], certPemChain: certMatches };
}

function pemToBase64Der(pem) {
  return pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
}

async function main() {
  const args = parseArgs(process.argv);
  const inputPath = resolvePath(args.input || 'trust/operators.json');
  const outputPath = resolvePath(args.output || 'trust/operators.json.jws');
  const defaultP12 = path.join(os.homedir(), 'Documents', 'unid-nuria-fnmt.p12');
  const p12Path = resolvePath(args.p12 || defaultP12);
  const passphrase = args.pass || process.env.P12_PASS || (await promptHidden('P12 password: '));

  if (!fs.existsSync(inputPath)) throw new Error(`Input not found: ${inputPath}`);
  if (!fs.existsSync(p12Path)) throw new Error(`P12 not found: ${p12Path}`);

  const payload = fs.readFileSync(inputPath);
  const { privateKeyPem, certPemChain } = extractPemBlocks(p12Path, passphrase);

  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKey = crypto.createPublicKey(certPemChain[0]);
  const jwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(jwk);

  const alg = publicKey.asymmetricKeyType === 'ec' ? 'ES256' : 'RS256';
  const x5c = certPemChain.map(pemToBase64Der);

  const signer = new FlattenedSign(payload);
  signer.setProtectedHeader({ alg, kid, b64: false, crit: ['b64'], x5c });
  const jws = await signer.sign(privateKey);

  const detached = { protected: jws.protected, signature: jws.signature };
  fs.writeFileSync(outputPath, JSON.stringify(detached, null, 2));

  console.log(`Signed: ${path.relative(process.cwd(), outputPath)}`);
  console.log(`alg=${alg}`);
  console.log(`kid=${kid}`);
  console.log(`x5c=${x5c.length} cert(s)`);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
