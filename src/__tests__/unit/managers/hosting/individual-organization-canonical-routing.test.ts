// Flow contract: individual Organization registration is owned only by FamilyManager and must preserve Offer -> Order -> activation.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('canonical individual Organization routing', () => {
  it('has no deprecated HostingManager shortcut outside the Offer/Order lifecycle', () => {
    const deprecatedModule = resolve(process.cwd(), 'src/managers/hosting/process-individual-organization.ts');
    const hostingManager = readFileSync(resolve(process.cwd(), 'src/managers/HostingManager.ts'), 'utf8');
    const worker = readFileSync(resolve(process.cwd(), 'src/worker.ts'), 'utf8');

    expect(existsSync(deprecatedModule)).toBe(false);
    expect(hostingManager).not.toContain('processIndividualOrganizationFlow');
    expect(worker).toMatch(/job\.section === SUBJECT_SECTION_INDIVIDUAL\s*\? this\.managers\.familyManager/);
  });
});
