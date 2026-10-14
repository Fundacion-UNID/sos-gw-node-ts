// Copyright (c) 2026 Connecting Solution & Applications Ltd.
// Flow contract: SOS creates code-only research parents and opaque version assets, and derives the research channel only from trusted sector, jurisdiction, and network context.
import { VitalSignsCodes } from 'gdc-common-utils-ts/constants/vital-signs';
import {
  buildResearchAssetVersionMapping,
  resolveResearchDataChannel,
} from '../../../utils/research-asset-versioning';

describe('SOS research asset versioning', () => {
  it('builds code-only parents and opaque version assets without publishing source ids or labels', () => {
    const input = {
      resourceType: 'Observation',
      sourceResourceId: '6d9ac6c2-ec3b-4c82-8aa6-e4e0fc120001',
      sourceVersionId: 'zResearchSourceVersionMustRemainPrivate',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: {
        'Observation.code': VitalSignsCodes.BodyTemperature.claim,
        'Observation.code-text': 'Temperatura corporal',
        'Observation.code-display': VitalSignsCodes.BodyTemperature.display,
      },
    };

    const first = buildResearchAssetVersionMapping(input);
    expect(first).toEqual(buildResearchAssetVersionMapping(input));
    expect(first.researchAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.versionAssetId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.versionAssetId).not.toBe(first.sourceVersionId);
    expect(first.parent).toBe(first.researchAssetId);
    expect(first.research).toBe(true);
    expect(first.tags).toEqual([{
      id: 'Observation.code',
      system: VitalSignsCodes.BodyTemperature.system,
      code: VitalSignsCodes.BodyTemperature.code,
    }]);
    expect(JSON.stringify(first)).not.toContain('Temperatura corporal');
    expect(JSON.stringify(first)).not.toContain(VitalSignsCodes.BodyTemperature.display);
  });

  it('does not create a research asset for an uncoded medication', () => {
    expect(() => buildResearchAssetVersionMapping({
      resourceType: 'MedicationStatement',
      sourceResourceId: '6d9ac6c2-ec3b-4c82-8aa6-e4e0fc120002',
      sourceVersionId: 'zUncodedMedicationVersion',
      twinSubjectId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
      claims: { 'MedicationStatement.code-text': 'Extemporaneous medicinal product' },
    })).toThrow('canonical system|code');
  });

  it('derives human and animal research channels from trusted routing context', () => {
    const previous = process.env.NETWORK_MODE;
    try {
      process.env.NETWORK_MODE = 'test';
      expect(resolveResearchDataChannel('health-care', 'ES')).toBe('health-care-eu-research');
      expect(resolveResearchDataChannel('animal-care', 'CA-BC')).toBe('animal-care-na-research');
      process.env.NETWORK_MODE = 'local-network';
      expect(resolveResearchDataChannel('health-care', 'ES')).toBe('health-care-local-research');
      expect(resolveResearchDataChannel('animal-care', 'CA-BC')).toBe('animal-care-local-research');
    } finally {
      if (previous === undefined) delete process.env.NETWORK_MODE;
      else process.env.NETWORK_MODE = previous;
    }
  });
});
