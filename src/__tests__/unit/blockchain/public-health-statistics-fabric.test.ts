// Flow contract: the Fabric adapter serializes only the anonymous public-statistics projection to artifact-sc and returns the exact transaction id; it never emits policy authority or private clinical identities.
import { jest } from '@jest/globals';
import { PublicHealthStatisticsContributionPaths } from 'sos-data-utils-ts/public-health-statistics-policy';
import { BlockchainAdapterFabric } from '../../../adapters/BlockchainAdapterFabric';
import { ManageAssetArtifact } from '../../../blockchain/fabric/v3/manageAssetArtifact';
import { buildPublicHealthStatisticLedgerMapping } from '../../../utils/public-health-statistics';

describe('Fabric public health statistics boundary', () => {
  it('submits one identifier-free immutable statistic and preserves the Fabric transaction id', async () => {
    const transactionId = 'fabric-public-statistics-transaction';
    const submit = jest.spyOn(ManageAssetArtifact.prototype, 'upsertPublicHealthStatisticsWithTransactionId')
      .mockResolvedValue({ result: {}, transactionId });
    const mapping = buildPublicHealthStatisticLedgerMapping({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      evidence: {
        subjectKind: 'animal',
        section: 'http://loinc.org|11450-4',
        codingSystem: 'http://snomed.info/sct',
        code: '386661006',
        jurisdiction: 'CA-BC',
        occurredOn: '2026-10-23',
        speciesTaxonomyId: '9615',
        ageBand: '5-9',
        sex: 'female',
      },
      authority: { qualifiedCreator: true, attachmentPresent: true, reviewAttested: true },
    });

    try {
      await expect(new BlockchainAdapterFabric().registerPublicHealthStatistics?.(
        [mapping], 'animal-care-na-research', 'artifact-sc',
      )).resolves.toEqual({ accepted: 1, txId: transactionId });
      const payload = submit.mock.calls[0][1];
      expect(payload).toEqual({ data: [{
        type: 'PublicHealthStatistic',
        id: mapping.statisticId,
        resource: {
          resourceType: 'PublicHealthStatistic',
          collectionPurpose: 'public-clinical-statistics',
          subjectKind: 'animal',
          section: 'http://loinc.org|11450-4',
          coding: { system: 'http://snomed.info/sct', code: '386661006' },
          jurisdiction: 'CA-BC',
          occurredOn: '2026-10-23',
          demographics: { speciesTaxonomyId: '9615', ageBand: '5-9', sex: 'female' },
        },
      }] });
      expect(JSON.stringify(payload)).not.toMatch(/documentHash|sourceVersionId|authority|qualifiedCreator|subjectDid|organizationDid|twinSubjectId/);
    } finally {
      submit.mockRestore();
    }
  });
});
