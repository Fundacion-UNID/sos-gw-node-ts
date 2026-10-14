// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { LICENSE_STATUS_ACTIVE } from '../../../constants/domain';
import { hasActiveProfessionalIdentityAndLicense } from '../../../utils/professional-license';
import {
  RESEARCH_STUDY_ACCESS_FIXTURE as fixture,
  RESEARCH_STUDY_REVIEWER_EMAIL,
  buildResearchStudyAccessClaims,
} from '../../data/research-study-access.data';

const reviewerRole = buildResearchStudyAccessClaims()[ClaimConsent.actorRole][0];
const reviewerStableIdentifier = buildStableActorIdentifier({
  contactKind: 'email',
  contact: RESEARCH_STUDY_REVIEWER_EMAIL,
});

describe('active professional identity and protected licence verification', () => {
  it('decrypts every licence with the tenant vault id and skips an unreadable document before a valid match', async () => {
    const corruptLicenseDocument = { id: 'corrupt-license', jwe: { ciphertext: 'corrupt' } };
    const validLicenseDocument = { id: 'valid-license', jwe: { ciphertext: 'valid' } };
    const harness = createHarness({}, [corruptLicenseDocument, validLicenseDocument]);

    await expect(hasActiveProfessionalIdentityAndLicense(harness.input)).resolves.toBe(true);

    expect(harness.unprotectConfidentialData).toHaveBeenCalledWith(corruptLicenseDocument, fixture.vaultId);
    expect(harness.unprotectConfidentialData).toHaveBeenCalledWith(validLicenseDocument, fixture.vaultId);
  });

  it.each([
    ['inactive status', { status: 'inactive' }],
    ['expired timestamp', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['different role', { issuedToRole: 'ISCO-08|2211' }],
    ['different email', { issuedToEmail: 'another@example.test' }],
    ['different stable binding', { activatedBy: 'urn:multibase:different' }],
  ])('fails closed for a protected licence with %s', async (_caseName, licenseOverrides) => {
    const harness = createHarness(licenseOverrides);

    await expect(hasActiveProfessionalIdentityAndLicense(harness.input)).resolves.toBe(false);
  });
});

function createHarness(
  licenseOverrides: Record<string, unknown> = {},
  licenseDocuments: any[] = [{ id: 'valid-license', jwe: { ciphertext: 'valid' } }],
) {
  const employeeDocument = { id: 'active-employee', jwe: { ciphertext: 'employee' } };
  const validLicense = {
    status: LICENSE_STATUS_ACTIVE,
    exp: Math.floor(Date.now() / 1000) + 3600,
    issuedToRole: reviewerRole,
    issuedToEmail: RESEARCH_STUDY_REVIEWER_EMAIL,
    activatedBy: reviewerStableIdentifier,
    ...licenseOverrides,
  };
  const unprotectConfidentialData = jest.fn(async (document: any, tenantVaultId: string) => {
    expect(tenantVaultId).toBe(fixture.vaultId);
    if (document === employeeDocument) return {
      status: LICENSE_STATUS_ACTIVE,
      claims: {
        [ClaimsPersonSchemaorg.email]: RESEARCH_STUDY_REVIEWER_EMAIL,
        [ClaimsPersonSchemaorg.hasOccupation]: reviewerRole,
      },
    };
    if (document?.jwe?.ciphertext === 'corrupt') throw new Error('licence cannot be decrypted');
    return validLicense;
  });
  const getContainersInSection = jest.fn(async (_collection: string, section: string) => (
    section.includes('employees') ? [employeeDocument] : licenseDocuments
  ));
  return {
    input: {
      tenantVaultId: fixture.vaultId,
      employeeCollectionName: fixture.collectionName,
      identity: { stableActorIdentifier: reviewerStableIdentifier, role: reviewerRole },
      vaultRepository: { getContainersInSection } as any,
      kmsService: { unprotectConfidentialData } as any,
    },
    unprotectConfidentialData,
  };
}
