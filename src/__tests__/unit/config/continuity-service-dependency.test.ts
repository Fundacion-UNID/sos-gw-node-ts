// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('continuity service dependency contract', () => {
  it('pins the shared package release that owns continuity capabilities', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    const version = packageJson.dependencies?.['sos-data-utils-ts'];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/u);
    expect(version).not.toMatch(/^[~^]/u);
  });
});
