// Flow contract: SOSChain accepts personal symptom reports as Communication records; it exposes no direct Observation batch manager or OpenAPI route.
import { readFileSync } from 'node:fs';

describe('SOSChain personal-report boundary', () => {
  it('does not wire or advertise a direct Observation batch endpoint', () => {
    const bootstrap = readFileSync(new URL('../../../bootstrap/build-managers.ts', import.meta.url), 'utf8');
    const api = readFileSync(new URL('../../../routes/api.ts', import.meta.url), 'utf8');

    expect(bootstrap).not.toContain('new ObservationManager(');
    expect(bootstrap).not.toContain('observationManager,');
    expect(api).not.toContain('/Observation/_batch:');
    expect(api).not.toContain('/Observation/_batch-response:');
  });
});
