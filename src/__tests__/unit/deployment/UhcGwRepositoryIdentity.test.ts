// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// The deployable human-health profile uses the shared SOS gateway identity without restoring the historical GDC UNID service identity.
import { readFile } from 'node:fs/promises';

describe('shared SOS GW repository identity', () => {
  it('does not retain the historical GDC UNID service identity', async () => {
    const historicalName = ['gdc', 'unid', 'node', 'ts'].join('-');
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { name?: string };
    const readme = await readFile('README.md', 'utf8');

    expect(packageJson.name).toBe('sos-gw-node-ts');
    expect(readme).not.toMatch(new RegExp(`^#\\s+${historicalName}$`, 'imu'));
  });

  it('gives every repository test layer the eight-gigabyte heap required by the full gate', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    for (const scriptName of ['test', 'test:unit', 'test:integration', 'test:e2e']) {
      expect(packageJson.scripts?.[scriptName]).toContain('--max-old-space-size=8192');
    }
    expect(packageJson.scripts?.['test:unit']).toContain('--maxWorkers=4');
  });
});
