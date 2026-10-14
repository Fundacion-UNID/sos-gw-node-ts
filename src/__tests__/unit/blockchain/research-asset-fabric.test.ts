// Copyright (c) 2026 Connecting Solution & Applications Ltd.
// Flow contract: SOS submits each code-only ResearchAsset before its opaque VersionAsset and never serializes the source version identifier to Fabric.
import { jest } from '@jest/globals';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts';
import {
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_OBSERVATION_PANEL_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { BlockchainAdapterFabric } from '../../../adapters/BlockchainAdapterFabric';
import { ManageAssetArtifact } from '../../../blockchain/fabric/v3/manageAssetArtifact';
import {
  RESEARCH_ASSET_RESOURCE_TYPE,
  VERSION_ASSET_RESOURCE_TYPE,
} from '../../../utils/research-asset-versioning';

describe('Fabric SOS research asset boundary', () => {
  test('submits code-only ResearchAsset before VersionAsset without source version identifiers', async () => {
    const transactionId = EXAMPLE_OBSERVATION_PANEL_IDENTIFIER;
    const submit = jest.spyOn(ManageAssetArtifact.prototype, 'upsertResearchVersionsWithTransactionId')
      .mockResolvedValue({ result: {}, transactionId });
    const mapping = {
      resourceType: ResourceTypesFhirR4.Observation,
      researchAssetId: EXAMPLE_OBSERVATION_IDENTIFIER,
      versionAssetId: EXAMPLE_OBSERVATION_PANEL_IDENTIFIER,
      sourceVersionId: 'zPrivateSourceVersion',
      parent: EXAMPLE_OBSERVATION_IDENTIFIER,
      research: true as const,
      tags: [{ id: 'Observation.code', system: 'http://loinc.org', code: '85354-9' }],
    };

    try {
      const result = await new BlockchainAdapterFabric().registerResearchVersionMappings(
        [mapping],
        'health-care-eu-research',
        'artifact-sc',
      );
      expect(result).toEqual({ accepted: 1, txId: transactionId });
      expect(submit).toHaveBeenCalledWith(expect.any(String), { data: [{
        researchAsset: {
          type: RESEARCH_ASSET_RESOURCE_TYPE,
          id: mapping.researchAssetId,
          resource: {
            resourceType: RESEARCH_ASSET_RESOURCE_TYPE,
            meta: { tag: mapping.tags },
          },
        },
        versionAsset: {
          type: VERSION_ASSET_RESOURCE_TYPE,
          id: mapping.versionAssetId,
          resource: {
            resourceType: VERSION_ASSET_RESOURCE_TYPE,
            parent: mapping.researchAssetId,
            research: true,
          },
        },
      }] });
      expect(JSON.stringify(submit.mock.calls[0])).not.toContain(mapping.sourceVersionId);
    } finally {
      submit.mockRestore();
    }
  });
});
