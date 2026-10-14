import { existsSync, readFileSync } from 'fs';
import { createInterface } from 'node:readline/promises';

export type KdfOptions = {
  kdf: 'hash' | 'scrypt' | 'auto' | 'context';
  context?: string;
  env?: 'test' | 'prod';
  saltPrefix?: string;
  infoPrefix?: string;
  minSeedBytes?: number;
  forceScrypt?: boolean;
  scrypt?: any;
};
export type EnvName = 'test' | 'prod';

export function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

export function getEnvName(): EnvName {
  const value = (getArgValue('--env') ?? 'test').toLowerCase();
  if (value !== 'test' && value !== 'prod') {
    throw new Error(`Invalid --env value "${value}". Use "test" or "prod".`);
  }
  return value as EnvName;
}

export async function promptSeed(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${label} seed (hex, empty for random): `);
  await rl.close();
  return answer.trim();
}

export async function confirmOverwrite(target: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${target} exists. Overwrite? (y/N): `);
  await rl.close();
  if (answer.trim().toLowerCase() !== 'y') {
    throw new Error('Cancelled by user.');
  }
}

export function loadKdfConfig(): KdfOptions {
  const kdfArg = (getArgValue('--kdf') ?? 'auto') as 'hash' | 'scrypt' | 'auto' | 'context';
  const configPath = getArgValue('--kdf-config') || 'pki-kdf.json';
  if (kdfArg === 'scrypt' || kdfArg === 'auto' || kdfArg === 'context') {
    if (existsSync(configPath)) {
      const raw = JSON.parse(readFileSync(configPath, 'utf8'));
      const context = getArgValue('--context') ?? raw.context;
      const env = getEnvName();
      return {
        kdf: kdfArg,
        context,
        env,
        saltPrefix: raw.saltPrefix,
        infoPrefix: raw.infoPrefix,
        minSeedBytes: raw.minSeedBytes,
        forceScrypt: raw.forceScrypt === true,
        scrypt: raw.scrypt ?? raw,
      };
    }
  }
  return { kdf: kdfArg, env: getEnvName(), context: getArgValue('--context') };
}
