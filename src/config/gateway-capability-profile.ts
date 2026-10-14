/**
 * Product-neutral runtime capability boundaries for the unified SOS gateway.
 *
 * Shared capabilities are implemented once. Human and veterinary profiles add
 * only subject-specific identity and clinical behavior. Deployment and
 * organization administration remain separate operational capabilities and
 * must never be inferred merely from a clinical profile.
 */
export const GatewayCapability = Object.freeze({
  Identity: 'identity',
  Consent: 'consent',
  Communication: 'communication',
  Encounter: 'encounter',
  Scheduling: 'scheduling',
  ClinicalDocument: 'clinical-document',
  EmergencyAccess: 'emergency-access',
  PatientMatch: 'patient-match',
  HumanIps: 'human-ips',
  AnimalIdentity: 'animal-identity',
  SpeciesAndBreed: 'species-and-breed',
  AnimalVaccinationVerification: 'animal-vaccination-verification',
  OrganizationAdministration: 'organization-administration',
  EmployeeAdministration: 'employee-administration',
  LicenseAdministration: 'license-administration',
  RuntimeDeployment: 'runtime-deployment',
  KeyCustody: 'key-custody',
} as const);

export type GatewayCapability = typeof GatewayCapability[keyof typeof GatewayCapability];
export type GatewayCapabilityProfileName = 'human' | 'veterinary' | 'one-health';
export type GatewayOperationalCapabilityProfileName = 'organization-administration' | 'deployment';

export const GatewaySubjectResourceType = Object.freeze({
  Patient: 'Patient',
  Animal: 'Animal',
  Subject: 'Subject',
} as const);

export type GatewaySubjectResourceType = typeof GatewaySubjectResourceType[keyof typeof GatewaySubjectResourceType];

export const GATEWAY_PROFILE_TEST_SUBJECTS = Object.freeze({
  human: 'Patient/patricia-doe',
  veterinary: 'Animal/animal-one',
  'one-health': 'Subject/synthetic-one-health',
} as const);

const SHARED_CAPABILITIES: readonly GatewayCapability[] = Object.freeze([
  GatewayCapability.Identity,
  GatewayCapability.Consent,
  GatewayCapability.Communication,
  GatewayCapability.Encounter,
  GatewayCapability.Scheduling,
  GatewayCapability.ClinicalDocument,
  GatewayCapability.EmergencyAccess,
]);

const HUMAN_CAPABILITIES: readonly GatewayCapability[] = Object.freeze([
  GatewayCapability.PatientMatch,
  GatewayCapability.HumanIps,
]);

const VETERINARY_CAPABILITIES: readonly GatewayCapability[] = Object.freeze([
  GatewayCapability.AnimalIdentity,
  GatewayCapability.SpeciesAndBreed,
  GatewayCapability.AnimalVaccinationVerification,
]);

const ORGANIZATION_ADMINISTRATION_CAPABILITIES: readonly GatewayCapability[] = Object.freeze([
  GatewayCapability.OrganizationAdministration,
  GatewayCapability.EmployeeAdministration,
  GatewayCapability.LicenseAdministration,
]);

const DEPLOYMENT_CAPABILITIES: readonly GatewayCapability[] = Object.freeze([
  GatewayCapability.RuntimeDeployment,
  GatewayCapability.KeyCustody,
]);

export type GatewayCapabilityProfile = Readonly<{
  name: GatewayCapabilityProfileName;
  subjectResourceType: GatewaySubjectResourceType;
  testSubjectReference: string;
  capabilities: readonly GatewayCapability[];
}>;

export type GatewayOperationalCapabilityProfile = Readonly<{
  name: GatewayOperationalCapabilityProfileName;
  capabilities: readonly GatewayCapability[];
}>;

function uniqueCapabilities(...sets: readonly (readonly GatewayCapability[])[]): readonly GatewayCapability[] {
  return Object.freeze([...new Set(sets.flat())]);
}

export function resolveGatewayCapabilityProfile(name: GatewayCapabilityProfileName): GatewayCapabilityProfile {
  if (name === 'human') {
    return Object.freeze({
      name,
      subjectResourceType: GatewaySubjectResourceType.Patient,
      testSubjectReference: GATEWAY_PROFILE_TEST_SUBJECTS.human,
      capabilities: uniqueCapabilities(SHARED_CAPABILITIES, HUMAN_CAPABILITIES),
    });
  }
  if (name === 'veterinary') {
    return Object.freeze({
      name,
      subjectResourceType: GatewaySubjectResourceType.Animal,
      testSubjectReference: GATEWAY_PROFILE_TEST_SUBJECTS.veterinary,
      capabilities: uniqueCapabilities(SHARED_CAPABILITIES, VETERINARY_CAPABILITIES),
    });
  }
  return Object.freeze({
    name,
    subjectResourceType: GatewaySubjectResourceType.Subject,
    testSubjectReference: GATEWAY_PROFILE_TEST_SUBJECTS['one-health'],
    capabilities: uniqueCapabilities(SHARED_CAPABILITIES, HUMAN_CAPABILITIES, VETERINARY_CAPABILITIES),
  });
}

/**
 * Resolves non-clinical gateway operation surfaces. These capabilities are
 * intentionally unavailable from human, veterinary and one-health clinical
 * profiles; an authenticated clinical role never implies organization or
 * deployment authority.
 */
export function resolveGatewayOperationalCapabilityProfile(
  name: GatewayOperationalCapabilityProfileName,
): GatewayOperationalCapabilityProfile {
  return Object.freeze({
    name,
    capabilities: name === 'organization-administration'
      ? ORGANIZATION_ADMINISTRATION_CAPABILITIES
      : DEPLOYMENT_CAPABILITIES,
  });
}
