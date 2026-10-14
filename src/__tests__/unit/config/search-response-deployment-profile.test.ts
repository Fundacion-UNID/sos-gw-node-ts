// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SearchResponseProfiles } from '../../../utils/didcomm-response';

describe('GW UNID staging search response profile', () => {
  it('opts staging into one primary resource per outer Bundle entry', () => {
    const source = readFileSync(resolve(process.cwd(), 'deploy/profiles/human/staging/configmap.yaml'), 'utf8');
    expect(source).toContain(`GW_SEARCH_RESPONSE_PROFILE: ${SearchResponseProfiles.PrimaryResource}`);
  });

  it('keeps legacy FHIR and JSON response negotiation disabled in the GKE staging profile', () => {
    const source = readFileSync(resolve(process.cwd(), 'env.staging.example'), 'utf8');
    expect(source).toContain('FHIR_LEGACY=false');
    expect(source).toContain('JSON_LEGACY=false');
  });
});
