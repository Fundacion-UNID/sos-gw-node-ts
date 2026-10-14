// Flow contract: the unified SOS gateway exposes shared capabilities once and adds human or veterinary subject behavior without cross-sector fixtures.
import {
  GatewayCapability,
  GatewaySubjectResourceType,
  GATEWAY_PROFILE_TEST_SUBJECTS,
  resolveGatewayCapabilityProfile,
  resolveGatewayOperationalCapabilityProfile,
} from '../../../config/gateway-capability-profile';

describe('unified SOS gateway capability profiles', () => {
  it('keeps shared clinical, consent, encounter and communication capabilities in both sectors', () => {
    const human = resolveGatewayCapabilityProfile('human');
    const veterinary = resolveGatewayCapabilityProfile('veterinary');
    for (const capability of [
      GatewayCapability.Consent,
      GatewayCapability.Communication,
      GatewayCapability.Encounter,
      GatewayCapability.Scheduling,
      GatewayCapability.ClinicalDocument,
    ]) {
      expect(human.capabilities).toContain(capability);
      expect(veterinary.capabilities).toContain(capability);
    }
  });

  it('keeps Patient and human IPS behavior out of the veterinary profile', () => {
    const human = resolveGatewayCapabilityProfile('human');
    const veterinary = resolveGatewayCapabilityProfile('veterinary');
    expect(human.subjectResourceType).toBe(GatewaySubjectResourceType.Patient);
    expect(human.capabilities).toEqual(expect.arrayContaining([
      GatewayCapability.PatientMatch,
      GatewayCapability.HumanIps,
    ]));
    expect(veterinary.capabilities).not.toEqual(expect.arrayContaining([
      GatewayCapability.PatientMatch,
      GatewayCapability.HumanIps,
    ]));
  });

  it('uses Animal fixtures and animal-only capabilities for the veterinary profile', () => {
    const veterinary = resolveGatewayCapabilityProfile('veterinary');
    expect(veterinary.subjectResourceType).toBe(GatewaySubjectResourceType.Animal);
    expect(veterinary.testSubjectReference).toBe(GATEWAY_PROFILE_TEST_SUBJECTS.veterinary);
    expect(veterinary.capabilities).toEqual(expect.arrayContaining([
      GatewayCapability.AnimalIdentity,
      GatewayCapability.SpeciesAndBreed,
      GatewayCapability.AnimalVaccinationVerification,
    ]));
  });

  it('combines both subject profiles without duplicating shared capabilities', () => {
    const combined = resolveGatewayCapabilityProfile('one-health');
    expect(combined.subjectResourceType).toBe(GatewaySubjectResourceType.Subject);
    expect(new Set(combined.capabilities).size).toBe(combined.capabilities.length);
    expect(combined.capabilities).toEqual(expect.arrayContaining([
      GatewayCapability.HumanIps,
      GatewayCapability.AnimalIdentity,
    ]));
  });

  it('keeps organization administration and deployment custody outside clinical profiles', () => {
    const clinicalProfiles = [
      resolveGatewayCapabilityProfile('human'),
      resolveGatewayCapabilityProfile('veterinary'),
      resolveGatewayCapabilityProfile('one-health'),
    ];
    const organizationAdministration = resolveGatewayOperationalCapabilityProfile('organization-administration');
    const deployment = resolveGatewayOperationalCapabilityProfile('deployment');

    for (const profile of clinicalProfiles) {
      expect(profile.capabilities).not.toEqual(expect.arrayContaining([
        GatewayCapability.OrganizationAdministration,
        GatewayCapability.EmployeeAdministration,
        GatewayCapability.LicenseAdministration,
        GatewayCapability.RuntimeDeployment,
        GatewayCapability.KeyCustody,
      ]));
    }
    expect(organizationAdministration.capabilities).toEqual(expect.arrayContaining([
      GatewayCapability.OrganizationAdministration,
      GatewayCapability.EmployeeAdministration,
      GatewayCapability.LicenseAdministration,
    ]));
    expect(deployment.capabilities).toEqual(expect.arrayContaining([
      GatewayCapability.RuntimeDeployment,
      GatewayCapability.KeyCustody,
    ]));
  });
});
