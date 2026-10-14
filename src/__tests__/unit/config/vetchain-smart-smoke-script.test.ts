// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// The release runner must calculate the same private research Consent identifier
// and Fabric rule id that GW derives before persisting the authorized rule.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('VetChain SMART local-network release runner', () => {
  it('overrides the canonical individual registration and order claims for the active VetChain sector', () => {
    const individualBootstrap = readFileSync(
      resolve(process.cwd(), 'scripts/demo-create-individual-organization.sh'),
      'utf8',
    );

    expect(individualBootstrap).toContain(
      '"/body/data/0/resource/meta/claims/Service.category": $sector',
    );
    expect(individualBootstrap).toContain(
      '"/body/data/0/resource/meta/claims/Organization.identifier.value": $organizationIdentifier',
    );
    expect(individualBootstrap).not.toContain('"/body/data/0/meta/claims/');
    expect(individualBootstrap).toContain(
      '"/body/data/0/resource/meta/claims/org.schema.Order.acceptedOffer.identifier": $offerIdentifier',
    );
  });

  it('projects GW-owned research Consent identifiers in the active animal sector', () => {
    const renderer = readFileSync(
      resolve(process.cwd(), 'scripts/render-demo-smart-access-payload.mts'),
      'utf8',
    );
    const smoke = readFileSync(
      resolve(process.cwd(), 'scripts/smoke-smart-access-local-network.sh'),
      'utf8',
    );

    expect(renderer).toContain('ensureDigitalTwinSecondaryUseConsentIdentifier({');
    expect(renderer).toContain("sector: process.env.SECTOR || 'animal-care'");
    expect(smoke).toMatch(/export TENANT_ID SUBJECT_ID PROVIDER_ORGANIZATION_DID SECTOR/);
  });

  it('renders active Consent status as a flat claim before the Fabric smoke', () => {
    const renderer = readFileSync(
      resolve(process.cwd(), 'scripts/render-demo-consentaccess-payload.mts'),
      'utf8',
    );

    expect(renderer).toContain('[ClaimConsent.status]: DEFAULT_RESOURCE_STATUS');
  });

  it('verifies the canonical R4 ResearchSubject contained Composition and prints failures', () => {
    const smoke = readFileSync(
      resolve(process.cwd(), 'scripts/smoke-smart-access-local-network.sh'),
      'utf8',
    );

    expect(smoke).toContain('.data[0].resource.data[0].contained[0].resourceType == "Composition"');
    expect(smoke).toContain('digital-twin search returned no R4 ResearchSubject with its contained Composition');
    expect(smoke).toContain('echo "${search_payload}" >&2');
    expect(smoke).not.toContain('.data[0].resource.data[0].composition | type');
  });
});
