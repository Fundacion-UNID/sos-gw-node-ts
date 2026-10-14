// Flow contract: the VetChain GCS adapter must obtain its GKE Workload Identity
// token through metadata clients compatible with the workspace gaxios runtime.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('VetChain GCS Workload Identity metadata dependency', () => {
  it('does not install a pre-v8 gcp-metadata client anywhere in the runtime tree', () => {
    const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: string }>;
    };
    const installed = Object.entries(lock.packages || {})
      .filter(([path]) => path.endsWith('node_modules/gcp-metadata'))
      .map(([path, metadata]) => ({ path, version: String(metadata.version || '') }));

    expect(installed.length).toBeGreaterThan(0);
    expect(installed.filter(({ version }) => !/^8\./.test(version))).toEqual([]);
  });
});
