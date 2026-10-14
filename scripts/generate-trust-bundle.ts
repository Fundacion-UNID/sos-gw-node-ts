import 'dotenv/config';

import { existsSync, readdirSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

type TrustBundleMemberConfig = {
  json: string;
  seed?: string;
  context?: string;
};

type TrustBundleConfig = {
  env?: 'test' | 'prod';
  kdf?: 'auto' | 'scrypt' | 'hash' | 'context';
  kdfConfig?: string;
  rootCa: { json: string; seed?: string; context?: string; };
  ica: { json: string; caJson: string; seed?: string; context?: string; };
  host?: { json: string; icaJson: string; seed?: string; context?: string; };
  members?: TrustBundleMemberConfig[];
};

/**
 * Reads a flat CLI flag from `process.argv` without introducing an extra dependency.
 */
function getArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

/**
 * Resolves a required input file relative to the current repo root and fails fast if it is missing.
 */
function requireFile(filePath: string, label: string): string {
  const absolute = path.resolve(process.cwd(), filePath);
  if (!existsSync(absolute)) {
    throw new Error(`Missing ${label}: ${absolute}`);
  }
  return absolute;
}

/**
 * Delegates to the existing PKI scripts instead of duplicating their logic here.
 */
function runNodeScript(scriptPath: string, args: string[]): void {
  const result = spawnSync(
    process.execPath,
    ['--loader', 'ts-node/esm', '--experimental-specifier-resolution=node', scriptPath, ...args],
    {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: process.env,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Command failed: ${scriptPath} ${args.join(' ')}`);
  }
}

/**
 * Host/member generation needs the concrete ICA output directory, which is only known after ICA generation.
 */
function resolveGeneratedEntityDir(baseDir: string, requiredFile: string, label: string): string {
  if (!existsSync(baseDir)) {
    throw new Error(`Missing ${label} base directory: ${baseDir}`);
  }

  const match = readdirSync(baseDir)
    .map((entry) => path.join(baseDir, entry))
    .find((entryPath) => existsSync(path.join(entryPath, requiredFile)));

  if (!match) {
    throw new Error(`Could not resolve generated ${label} output directory under ${baseDir}`);
  }

  return match;
}

/**
 * Keeps seed/KDF handling consistent across root, ICA, host, and member generation.
 */
function appendCommonArgs(config: TrustBundleConfig, scoped: { seed?: string; context?: string; }): string[] {
  const args: string[] = [];
  if (config.env) args.push('--env', config.env);
  if (config.kdf) args.push('--kdf', config.kdf);
  if (config.kdfConfig) args.push('--kdf-config', requireFile(config.kdfConfig, 'kdf config'));
  if (scoped.seed) args.push('--seed', scoped.seed);
  if (scoped.context) args.push('--context', scoped.context);
  return args;
}

async function main(): Promise<void> {
  const configPath = getArgValue('--config');
  if (!configPath) {
    throw new Error('Usage: generate-trust-bundle.ts --config <trust-bundle.config.json>');
  }

  const absoluteConfigPath = requireFile(configPath, 'trust bundle config');
  const config = JSON.parse(readFileSync(absoluteConfigPath, 'utf8')) as TrustBundleConfig;

  const rootJson = requireFile(config.rootCa.json, 'root ca organization json');
  const icaJson = requireFile(config.ica.json, 'ica organization json');
  const caJson = requireFile(config.ica.caJson, 'ca organization json');

  // Root CA must exist before the ICA can be signed.
  runNodeScript('scripts/generate-root-ca.ts', [
    '--json', rootJson,
    ...appendCommonArgs(config, config.rootCa),
  ]);

  const envName = config.env || 'test';
  const caDir = path.resolve(process.cwd(), 'artifacts', envName, 'pki-root-ca');
  runNodeScript('scripts/generate-ica.ts', [
    '--json', icaJson,
    '--ca-json', caJson,
    '--ca-dir', caDir,
    ...appendCommonArgs(config, config.ica),
  ]);

  // Hosts and members receive leaf certificates from the generated ICA, so we resolve its final output directory here.
  const generatedIcaDir = resolveGeneratedEntityDir(
    path.resolve(process.cwd(), 'artifacts', envName, 'pki-ica'),
    'ica-cert.der',
    'ICA',
  );

  if (config.host) {
    runNodeScript('scripts/generate-host.ts', [
      '--json', requireFile(config.host.json, 'host organization json'),
      '--ica-json', requireFile(config.host.icaJson, 'host ica organization json'),
      '--ica-dir', generatedIcaDir,
      '--ca-dir', caDir,
      ...appendCommonArgs(config, config.host),
    ]);
  }

  for (const member of config.members || []) {
    runNodeScript('scripts/generate-member.ts', [
      '--json', requireFile(member.json, 'member organization json'),
      '--ica-json', icaJson,
      '--ica-dir', generatedIcaDir,
      '--ca-dir', caDir,
      ...appendCommonArgs(config, member),
    ]);
  }
}

main().catch((error) => {
  console.error('Failed to generate trust bundle:', error);
  process.exit(1);
});
