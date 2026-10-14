// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/**
 * 1. One member transports an individual-authored section batch with personal attestation.
 * 2. GW stores resource and Composition provenance as independent indexed claims.
 * 3. Subject summary rebuilds the native Composition and supporting RelatedPerson graph.
 * Authorization invariant: author remains the individual and attester remains the registered member.
 * Persistence invariant: summary export does not replace either reference with transport actorDid.
 */
import {
  CompositionAttesterModes,
  CompositionClaim,
  FhirIpsCreatorKinds,
  HealthcareActorRoles,
  HealthcareBasicSections,
  HL7_RELATED_PERSON_FUNCTIONAL_ROLES,
  ResourceTypesFhirR4,
} from 'gdc-common-utils-ts';
import {
  EXAMPLE_ALLERGY_IDENTIFIER,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_CLIENT_INSTANCE_UUID,
  EXAMPLE_LICENSE_SEAT_UUID_ACTIVE,
  EXAMPLE_LICENSE_SEAT_UUID_AVAILABLE,
  EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
  EXAMPLE_OBSERVATION_IDENTIFIER,
  EXAMPLE_OBSERVATION_IDENTIFIER_IPS,
  EXAMPLE_OBSERVATION_PANEL_IDENTIFIER,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
  EXAMPLE_RELATED_PERSON_MEMBER_DID,
  EXAMPLE_RELATED_PERSON_ROLE,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { buildConsolidatedIpsBundleDocument, getClinicalCreatorBindingsSectionId } from '../../../utils/ips-bundle';
import { getSubjectScopedSectionId } from '../../../utils/individual-sections';

describe('IPS Bundle personal provenance export', () => {
  it('keeps the individual author and member attester with its RelatedPerson resource', async () => {
    const tenantVaultId = 'health-care_test-tenant';
    const memberAuthor = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
    const records = new Map<string, unknown[]>([
      [getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'composition'), [{
        [CompositionClaim.Identifier]: 'urn:uuid:composition-personal-provenance',
        [CompositionClaim.Subject]: EXAMPLE_SUBJECT_DID,
        [CompositionClaim.Section]: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
        [CompositionClaim.Author]: EXAMPLE_SUBJECT_DID,
        [CompositionClaim.Attester]: memberAuthor,
        [CompositionClaim.AttesterMode]: CompositionAttesterModes.Personal,
      }]],
      [getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'allergies'), [{
        id: EXAMPLE_ALLERGY_IDENTIFIER.split(':').at(-1),
        'AllergyIntolerance.identifier': EXAMPLE_ALLERGY_IDENTIFIER,
        'AllergyIntolerance.patient': EXAMPLE_SUBJECT_DID,
        [CompositionClaim.Section]: HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
      }]],
      [getClinicalCreatorBindingsSectionId(), [{
        kind: FhirIpsCreatorKinds.IndividualMember,
        actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
        authorIdentifier: memberAuthor,
        ownerIdentifier: EXAMPLE_SUBJECT_DID,
        role: EXAMPLE_RELATED_PERSON_ROLE,
        actorDids: [EXAMPLE_RELATED_PERSON_MEMBER_DID],
      }]],
    ]);
    const vaultRepository = {
      listContainersInSection: jest.fn(async (_vaultId: string, sectionId: string) => records.get(sectionId) || []),
    };

    const bundle = await buildConsolidatedIpsBundleDocument({
      vaultRepository: vaultRepository as any,
      tenantVaultId,
      subject: EXAMPLE_SUBJECT_DID,
      scope: 'individual',
      requiredSections: [HealthcareBasicSections.AllergiesAndIntolerances.attributeValue],
      excludedSections: [],
      requiredTypes: [],
    });
    const composition = bundle.entry[0].resource;
    expect(composition.author).toEqual([{ reference: EXAMPLE_SUBJECT_DID }]);
    expect(composition.attester).toEqual([{
      mode: CompositionAttesterModes.Personal,
      party: { reference: memberAuthor },
    }]);
    expect(bundle.entry).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fullUrl: memberAuthor,
        resource: expect.objectContaining({ resourceType: ResourceTypesFhirR4.RelatedPerson }),
      }),
    ]));
  });

  it('exports imported, professional, controller and caregiver provenance as one resolvable IPS graph', async () => {
    /**
     * 1. An administrative employee imports provider-authored IPS data and is its PractitionerRole attester.
     * 2. An individual controller records body weight as a RelatedPerson author/attester.
     * 3. A caregiver records another body weight as a different RelatedPerson author/attester.
     * 4. Summary export returns every Observation plus Organization, Practitioner,
     *    PractitionerRole and both RelatedPerson resources.
     * Authorization invariant: operational employee/member DIDs remain audit identities, not FHIR references.
     * Persistence invariant: LOINC 29463-7 and UCUM kg facts keep their distinct source assignments.
     */
    const tenantVaultId = 'health-care_test-tenant';
    const professionalRole = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
    const controllerRole = `urn:uuid:${EXAMPLE_LICENSE_SEAT_UUID_ACTIVE}`;
    const caregiverRole = `urn:uuid:${EXAMPLE_LICENSE_SEAT_UUID_SECONDARY}`;
    const caregiverDescriptor = HL7_RELATED_PERSON_FUNCTIONAL_ROLES.find(({ code }) => code === 'CAREGIVER')!;
    const caregiverRoleToken = `${caregiverDescriptor.codingSystem}|${caregiverDescriptor.code}`;
    const vitalSigns = HealthcareBasicSections.VitalSigns.attributeValue;
    const observationRecords = [
      [EXAMPLE_OBSERVATION_IDENTIFIER, EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS, professionalRole],
      [EXAMPLE_OBSERVATION_IDENTIFIER_IPS, controllerRole, controllerRole],
      [EXAMPLE_OBSERVATION_PANEL_IDENTIFIER, caregiverRole, caregiverRole],
    ].map(([identifier, author, attester]) => ({
      id: identifier.split(':').at(-1),
      'Observation.identifier': identifier,
      'Observation.subject': EXAMPLE_SUBJECT_DID,
      'Observation.code': 'http://loinc.org|29463-7',
      'Observation.value-quantity': '70|http://unitsofmeasure.org|kg',
      [CompositionClaim.Section]: vitalSigns,
      [CompositionClaim.Author]: author,
      [CompositionClaim.Attester]: attester,
    }));
    const compositionRecords = observationRecords.map((record, index) => ({
      [CompositionClaim.Identifier]: `urn:uuid:composition-aggregate-${index + 1}`,
      [CompositionClaim.Subject]: EXAMPLE_SUBJECT_DID,
      [CompositionClaim.Section]: vitalSigns,
      [CompositionClaim.Author]: record[CompositionClaim.Author],
      [CompositionClaim.Attester]: record[CompositionClaim.Attester],
      [CompositionClaim.AttesterMode]: index === 0
        ? CompositionAttesterModes.Professional
        : CompositionAttesterModes.Personal,
    }));
    const bindings = [{
      kind: FhirIpsCreatorKinds.Professional,
      actorIdentifier: `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`,
      authorIdentifier: professionalRole,
      ownerIdentifier: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS,
      role: HealthcareActorRoles.Receptionist,
      actorDids: [EXAMPLE_PROFESSIONAL_DID],
    }, {
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: `urn:uuid:${EXAMPLE_CLIENT_INSTANCE_UUID}`,
      authorIdentifier: controllerRole,
      ownerIdentifier: EXAMPLE_SUBJECT_DID,
      role: EXAMPLE_RELATED_PERSON_ROLE,
    }, {
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: `urn:uuid:${EXAMPLE_LICENSE_SEAT_UUID_AVAILABLE}`,
      authorIdentifier: caregiverRole,
      ownerIdentifier: EXAMPLE_SUBJECT_DID,
      role: caregiverRoleToken,
    }];
    const records = new Map<string, unknown[]>([
      [getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'composition'), compositionRecords],
      [getSubjectScopedSectionId(EXAMPLE_SUBJECT_DID, 'individual', 'observations'), observationRecords],
      [getClinicalCreatorBindingsSectionId(), bindings],
    ]);
    const vaultRepository = {
      listContainersInSection: jest.fn(async (_vaultId: string, sectionId: string) => records.get(sectionId) || []),
    };

    const bundle = await buildConsolidatedIpsBundleDocument({
      vaultRepository: vaultRepository as any,
      tenantVaultId,
      subject: EXAMPLE_SUBJECT_DID,
      scope: 'individual',
      requiredSections: [vitalSigns],
      excludedSections: [],
      requiredTypes: [],
    });
    const composition = bundle.entry[0].resource;
    expect(composition.author).toEqual([
      { reference: EXAMPLE_PROVIDER_ORGANIZATION_AUTHORIZATION_URN_CDS },
      { reference: controllerRole },
      { reference: caregiverRole },
    ]);
    expect(composition.attester.map(({ party }: any) => party.reference)).toEqual([
      professionalRole,
      controllerRole,
      caregiverRole,
    ]);
    const resourceTypes = bundle.entry.slice(1).map(({ resource }: any) => resource.resourceType);
    expect(resourceTypes.filter((value: string) => value === ResourceTypesFhirR4.Observation)).toHaveLength(3);
    expect(resourceTypes).toEqual(expect.arrayContaining([
      ResourceTypesFhirR4.Organization,
      ResourceTypesFhirR4.Practitioner,
      ResourceTypesFhirR4.PractitionerRole,
      ResourceTypesFhirR4.RelatedPerson,
    ]));
    expect(resourceTypes.filter((value: string) => value === ResourceTypesFhirR4.RelatedPerson)).toHaveLength(2);
  });
});
