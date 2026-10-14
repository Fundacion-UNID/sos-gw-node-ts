// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import {
  getHealthcareRoleByClaim,
  HealthcareActorRoles,
} from 'gdc-common-utils-ts/constants/healthcare';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import {
  ANIMAL_INSURANCE_CONSENT_TEST_DATA,
  ANIMAL_INSURANCE_CONSENT_TEST_INPUT,
  AnimalInsuranceConsentErrors,
  buildAnimalInsuranceEligibilityConsent,
} from 'vet-data-utils-ts/insurance-consent';
import { persistConsentRuleAndAttachment } from '../../../utils/consent-storage';
import { getIndividualSectionId, getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('consent storage projections', () => {
  /**
   * Permission/contact link contract:
   * Consent.actor-identifier remains the operational value evaluated by GW
   * and the smart contract, while Consent.actor-reference retains the stable
   * address-book resource selected by the controller. Removing a contact can
   * therefore be blocked while a permission still references it.
   */
  it('persists a readable subject projection and canonicalizes all actor roles', async () => {
    const physician = getHealthcareRoleByClaim(HealthcareActorRoles.Physician);
    expect(physician).toBeDefined();
    const canonicalPhysicianRole = `${physician!.codingSystem}|${physician!.code}`;
    const put = jest.fn().mockResolvedValue(undefined);
    const subject = 'did:web:unid.online:card:uhc:personal:subject-1';
    const claims = {
      '@context': 'org.hl7.fhir.api',
      [ClaimConsent.decision]: 'permit',
      [ClaimConsent.subject]: subject,
      [ClaimConsent.identifier]: 'urn:uuid:consent-1',
      [ClaimConsent.date]: '2026-07-15',
      [ClaimConsent.purpose]: 'TREAT',
      [ClaimConsent.action]: 'LOINC|10160-0',
      [ClaimConsent.actorIdentifier]: 'doctor@example.org',
      'Consent.actor-reference': 'RelatedPerson/contact-doctor',
      [ClaimConsent.actorRole]: 'ISCO-08|2211,RESPRSN',
      [ClaimConsent.attachmentContentType]: 'application/odrl+json',
      [ClaimConsent.attachmentData]: Buffer.from('{"agreement":"read"}').toString('base64'),
    };

    await persistConsentRuleAndAttachment({
      vaultRepository: { put } as any,
      tenantVaultId: 'health-care_acme',
      sector: 'health-care',
      claims,
    });

    const projectionWrite = put.mock.calls.find((call) => (
      call[2] === getSubjectScopedSectionId(subject, 'individual', 'consents')
    ));
    expect(projectionWrite).toBeDefined();
    expect(projectionWrite?.[1]?.[0]).toMatchObject({
      [ClaimConsent.actorRole]: `${canonicalPhysicianRole},v3-RoleCode|RESPRSN`,
      [ClaimConsent.identifier]: 'urn:uuid:consent-1',
      'Consent.actor-reference': 'RelatedPerson/contact-doctor',
    });
    expect(projectionWrite?.[1]?.[0]?.[ClaimConsent.attachmentData]).toBeUndefined();
    expect(put).toHaveBeenCalledWith(
      'health-care_acme',
      expect.any(Array),
      getIndividualSectionId(subject, 'rules'),
    );
  });

  it('validates the animal-insurance ODRL mirror before storing its claims and attachment', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const consent = buildAnimalInsuranceEligibilityConsent(ANIMAL_INSURANCE_CONSENT_TEST_INPUT);

    await persistConsentRuleAndAttachment({
      vaultRepository: { put } as any,
      tenantVaultId: ANIMAL_INSURANCE_CONSENT_TEST_DATA.managerReference,
      sector: DataspaceSectors.AnimalInsurance,
      claims: { ...consent.meta.claims },
    });

    expect(put).toHaveBeenCalled();
  });

  it('writes nothing when animal-insurance ODRL and canonical Consent claims diverge', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const consent = buildAnimalInsuranceEligibilityConsent(ANIMAL_INSURANCE_CONSENT_TEST_INPUT);
    const claims = {
      ...consent.meta.claims,
      [ClaimConsent.grantee]: ANIMAL_INSURANCE_CONSENT_TEST_DATA.divergentInsurerReference,
    };

    await expect(persistConsentRuleAndAttachment({
      vaultRepository: { put } as any,
      tenantVaultId: ANIMAL_INSURANCE_CONSENT_TEST_DATA.managerReference,
      sector: DataspaceSectors.AnimalInsurance,
      claims,
    })).rejects.toThrow(AnimalInsuranceConsentErrors.OdrlClaimsDiverge);
    expect(put).not.toHaveBeenCalled();
  });
});
