// Flow contract: GW assigns a fresh random public-statistic id to each anonymous coded event; neither clinical certification, later clinical reporting nor individual self-reporting reuses a source hash, private record id or Digital Twin alias.
import { PublicHealthStatisticsContributionPaths } from 'sos-data-utils-ts/public-health-statistics-policy';
import {
  buildPublicHealthStatisticLedgerMapping,
  buildPublicHealthStatisticLedgerMappingFromClinicalClaims,
  buildPublicHealthStatisticLedgerMappingFromSelfReport,
} from '../../../utils/public-health-statistics';

const evidence = {
  subjectKind: 'human',
  section: 'http://loinc.org|11450-4',
  codingSystem: 'http://snomed.info/sct',
  code: '386661006',
  jurisdiction: 'CA-BC',
  occurredOn: '2026-10-23',
  ageBand: '40-49',
  sex: 'female',
};

describe('public health statistics ledger mapping', () => {
  it('builds fresh unrelated opaque ids for otherwise identical statistical events', () => {
    const professional = buildPublicHealthStatisticLedgerMapping({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      evidence,
      authority: { qualifiedCreator: true, attachmentPresent: true, reviewAttested: true },
    });
    const individual = buildPublicHealthStatisticLedgerMapping({
      path: PublicHealthStatisticsContributionPaths.IndividualClinicalRecord,
      evidence,
      authority: { individualAuthorized: true, clinicOriginVerified: true, selfCreated: false },
    });

    expect(professional.statisticId).toMatch(/^[0-9a-f-]{36}$/);
    expect(individual.statisticId).toMatch(/^[0-9a-f-]{36}$/);
    expect(individual.statisticId).not.toBe(professional.statisticId);
    expect(professional.contribution.collectionPurpose).toBe('public-clinical-statistics');
    expect(individual.contribution.collectionPurpose).toBe('public-health-user-reports');
    expect(JSON.stringify([professional, individual])).not.toMatch(/documentHash|sourceVersionId|subjectDid|patientId|organizationDid|twinSubjectId/);
  });

  it('is independent from SHC issuance and rejects browser-authored authority through shared policy', () => {
    const authority = { qualifiedCreator: true, attachmentPresent: true, reviewAttested: true };
    const withoutShc = buildPublicHealthStatisticLedgerMapping({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      evidence: { ...evidence, smartHealthCardIssued: false },
      authority,
    });
    const withShc = buildPublicHealthStatisticLedgerMapping({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      evidence: { ...evidence, smartHealthCardIssued: true },
      authority,
    });
    expect(withShc.contribution).toEqual(withoutShc.contribution);
    expect(withShc.statisticId).not.toBe(withoutShc.statisticId);
    expect(() => buildPublicHealthStatisticLedgerMapping({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      evidence,
      authority: { qualifiedCreator: false, attachmentPresent: true, reviewAttested: true },
    })).toThrow(/qualified_creator_required/);
  });

  it.each([
    ['animal-care', undefined, 'animal'],
    ['health-care', undefined, 'human'],
    ['onehealth-research', 'human', 'human'],
    ['onehealth-research', 'animal', 'animal'],
  ] as const)('derives a %s professional contribution from trusted provider context', (sector, trustedSubjectKind, subjectKind) => {
    const mapping = buildPublicHealthStatisticLedgerMappingFromClinicalClaims({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      resourceType: 'Observation',
      sector,
      trustedSubjectKind,
      jurisdiction: 'ca-bc',
      section: 'http://loinc.org|11450-4',
      claims: {
        'Observation.status': 'final',
        'Observation.code': 'http://snomed.info/sct|386661006',
        'Observation.effective-datetime': '2026-10-23T11:42:00Z',
        'Composition.attester': 'urn:uuid:professional-assignment',
        'Composition.attester-mode': 'professional',
      },
      authority: { qualifiedCreator: true, attachmentPresent: true, reviewAttested: true },
    });

    expect(mapping.contribution.projection).toEqual({
      subjectKind,
      section: 'http://loinc.org|11450-4',
      codingSystem: 'http://snomed.info/sct',
      code: '386661006',
      jurisdiction: 'CA-BC',
      occurredOn: '2026-10-23',
    });
  });

  it('rejects an ambiguous One Health subject instead of guessing human or animal', () => {
    expect(() => buildPublicHealthStatisticLedgerMappingFromClinicalClaims({
      path: PublicHealthStatisticsContributionPaths.ClinicalCertification,
      resourceType: 'Observation',
      sector: 'onehealth-research',
      jurisdiction: 'ca-bc',
      section: 'http://loinc.org|11450-4',
      claims: {
        'Observation.status': 'final',
        'Observation.code': 'http://snomed.info/sct|386661006',
        'Observation.effective-datetime': '2026-10-23',
      },
      authority: { qualifiedCreator: true, attachmentPresent: true, reviewAttested: true },
    })).toThrow(/subject_kind_required/);
  });

  it('builds an individual coded self-report without clinical or Digital Twin correlation', () => {
    const mapping = buildPublicHealthStatisticLedgerMappingFromSelfReport({
      sector: 'health-care',
      jurisdiction: 'ca-bc',
      evidence: {
        section: 'http://loinc.org|11450-4',
        codingSystem: 'http://snomed.info/sct',
        code: '386661006',
        occurredOn: '2026-10-23',
        ageBand: '40-49',
      },
      authority: { individualAuthorized: true },
    });
    expect(mapping.contribution.path).toBe('individual-self-report');
    expect(mapping.contribution.collectionPurpose).toBe('public-health-user-reports');
    expect(JSON.stringify(mapping)).not.toMatch(/documentHash|sourceVersionId|resourceId|twin/i);
  });
});
