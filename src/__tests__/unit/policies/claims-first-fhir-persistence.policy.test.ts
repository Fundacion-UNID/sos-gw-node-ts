// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('claims-first FHIR persistence policy', () => {
  it('keeps the repository rule and research managers aligned on encrypted flat claims', () => {
    const agents = readFileSync(resolve(process.cwd(), 'AGENTS.md'), 'utf8');
    const group = readFileSync(resolve(process.cwd(), 'src/managers/GroupManager.ts'), 'utf8');
    const study = readFileSync(resolve(process.cwd(), 'src/managers/ResearchStudyManager.ts'), 'utf8');
    const consent = readFileSync(resolve(process.cwd(), 'src/managers/ResearchStudyConsentManager.ts'), 'utf8');
    const communication = readFileSync(resolve(process.cwd(), 'src/managers/CommunicationManager.ts'), 'utf8');

    expect(agents).toContain('`resource.meta.claims` is the canonical input and response source');
    expect(agents).toContain('`content: { claims }`');
    expect(agents).toContain('`protectAttributesNameAndValue`');
    expect(agents).toContain('resource-specific flat-claim validator');
    expect(agents).toMatch(/native FHIR JSON exists only at explicit import, projection, or versioned\s+export boundaries/);
    expect(agents).toContain('explicit recoverable migration');
    for (const manager of [group, study, consent]) {
      expect(manager).toContain('requireClaimsOnlyResourceShape');
      expect(manager).toContain('claimsOnlyContent(claims)');
      expect(manager).toContain('protectAttributesNameAndValue');
      expect(manager).not.toMatch(/content:\s*(resource|content)/);
      expect(manager).not.toContain('projectGroupR5SearchClaims');
      expect(manager).not.toContain('projectResearchStudyR5SearchClaims');
    }
    for (const manager of [group, study]) {
      expect(manager).not.toMatch(/if \(!readClaimsOnlyContent\([^)]*\)\) \{\s*await this\.deps\.vaultRepository\.delete/);
    }
    expect(communication).toContain('content: { claims }');
    expect(communication).toContain('requireClaimsOnlyResourceShape');
    expect(communication).toContain('protectAttributesNameAndValue');
    expect(communication).toContain('protectConfidentialData(document, tenantVaultId)');
    expect(communication).toContain('Historical native Communication requires an explicit recoverable migration.');
    expect(communication).not.toMatch(/content:\s*\{\s*resource\s*:/);
  });
});
