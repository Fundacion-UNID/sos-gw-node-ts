// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * 1. A clean SOSCHAIN Gateway checkout installs only versions declared by its manifest.
 * 2. Runtime imports introduced by GW source must exist in that exact release.
 * 3. The manifest and lockfile therefore pin the shared package that owns the
 *    imported contract; a developer's pre-existing node_modules is not proof.
 */
import fs from 'node:fs';
import path from 'node:path';

describe('shared runtime dependency contract', () => {
  it('pins the shared releases that export current access and continuity contracts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    expect(packageJson.dependencies?.['gdc-common-utils-ts']).toBe('2.9.29');
    expect(packageJson.dependencies?.['fhir-data-utils-ts']).toBe('0.6.21');
    expect(packageJson.dependencies?.['sos-data-utils-ts']).toBe('0.6.15');
    expect(packageJson.dependencies?.['vet-data-utils-ts']).toBe('0.8.7');
    expect(packageJson.devDependencies?.['vet-sdk-core-ts']).toBe('0.7.1');
  });
});
