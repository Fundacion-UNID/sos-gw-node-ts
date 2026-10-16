// Flow contract: SOS GW documents the one canonical animal-card DID and keeps its public resolver in the issuing provider BFF without a split-path alias.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('animal-card BFF route contract', () => {
  it('documents the species-bound DID, route ownership and fail-closed split path', () => {
    const portalContract = readFileSync(resolve(process.cwd(), 'docs/101-PORTAL_BFF_CONTRACT.md'), 'utf8');
    const nodeRuntime = readFileSync(resolve(process.cwd(), 'docs/BFF_NODE_RUNTIME.md'), 'utf8');
    const combined = `${portalContract}\n${nodeRuntime}`;

    expect(combined).toContain('did:web:<provider-host>:card:vetchain:<speciesId7>:<cardNumber21>');
    expect(combined).toContain('/card/vetchain/{speciesId7}/{cardNumber21}/did.json');
    expect(combined).toContain('issuing provider BFF');
    expect(combined).toContain('split 5+16 path is invalid');
    expect(combined).not.toContain('/card/vetchain/{jurisdictionCode5}/{animalId16}/did.json');
  });
});
