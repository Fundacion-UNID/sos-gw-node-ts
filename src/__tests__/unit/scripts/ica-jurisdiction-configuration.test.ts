// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

const repositoryRoot = process.cwd();

describe('ICA executable jurisdiction configuration', () => {
  it('requires the generic full-cycle runner jurisdiction instead of defaulting to Spain', () => {
    const source = readFileSync(resolve(repositoryRoot, 'scripts/run-ica-a4-fullcycle.mjs'), 'utf8');

    expect(source).toContain('JURISDICTION must be set');
    expect(source).not.toMatch(/JURISDICTION\s*=.*\|\|\s*['"]ES['"]/);
  });

  it('requires the live signed-PDF fixture jurisdiction independently from the host route', () => {
    const source = readFileSync(
      resolve(repositoryRoot, 'src/__tests__/e2e/hosting-connect-ica.e2e.spec.ts'),
      'utf8',
    );

    expect(source).toContain('ICA_REAL_TERMS_PDF_JURISDICTION must be set');
    expect(source).toContain('ICA_E2E_NETWORK_KIND must be set');
    expect(source).not.toMatch(/jurisdiction:\s*['"]ES['"]/);
    expect(source).not.toContain('/test/pdf/');
  });
});
