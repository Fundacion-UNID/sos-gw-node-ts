// Flow contract: Consent actor roles normalize to the shared canonical healthcare vocabulary before authorization comparison.
import {
  getHealthcareRoleByClaim,
  HealthcareActorRoles,
  ISCO08_CODING_SYSTEM,
} from 'gdc-common-utils-ts/constants/healthcare';
import {
  buildConsentRuleKey,
  expandConsentActorRoles,
  isValidFhirRoleCode,
  isValidIsco08RoleCode,
  normalizeConsentActorRole,
} from '../../../utils/consent';

describe('consent utils', () => {
  it('normalizes country targets to FHIR ISO 3166 URN format', () => {
    expect(buildConsentRuleKey({
      subjectId: 's',
      sector: 'health-care',
      target: 'es',
      decision: 'permit',
      purpose: 'TREAT',
    })).toBe('s|health-care|urn:iso:std:iso:3166|ES|permit|TREAT');

    expect(buildConsentRuleKey({
      subjectId: 's',
      sector: 'health-care',
      target: 'urn:iso:std:iso:3166|fr',
      decision: 'permit',
      purpose: 'TREAT',
    })).toBe('s|health-care|urn:iso:std:iso:3166|FR|permit|TREAT');
  });

  it('normalizes phone target to canonical tel:+E164', () => {
    expect(buildConsentRuleKey({
      subjectId: 's',
      sector: 'health-care',
      target: ' +34600111222 ',
      decision: 'permit',
      purpose: 'TREAT',
    })).toBe('s|health-care|tel:+34600111222|permit|TREAT');
  });

  it('normalizes professional role formats to the shared canonical ISCO-08 descriptor', () => {
    const veterinarian = getHealthcareRoleByClaim(HealthcareActorRoles.Veterinarian);
    expect(veterinarian).toBeDefined();
    const canonicalRole = `${veterinarian!.codingSystem}|${veterinarian!.code}`;

    expect(normalizeConsentActorRole(HealthcareActorRoles.Veterinarian, 'professional')).toBe(canonicalRole);
    expect(normalizeConsentActorRole(canonicalRole, 'professional')).toBe(canonicalRole);
  });

  it('validates ISCO and FHIR role codes', () => {
    expect(isValidIsco08RoleCode('221')).toBe(true);
    expect(isValidIsco08RoleCode('ISCO-08|221')).toBe(true);
    expect(isValidIsco08RoleCode('RESPRSN')).toBe(false);

    expect(isValidFhirRoleCode('RESPRSN')).toBe(true);
    expect(isValidFhirRoleCode('v3-RoleCode|RESPRSN')).toBe(true);
    expect(isValidFhirRoleCode('221')).toBe(false);
  });

  it('expands comma-separated actor roles into canonical values', () => {
    expect(expandConsentActorRoles('ISCO-08|221,RESPRSN', 'auto')).toEqual([
      `${ISCO08_CODING_SYSTEM}|221`,
      'v3-RoleCode|RESPRSN',
    ]);
  });

  it('normalizes family role formats to canonical v3-RoleCode', () => {
    expect(normalizeConsentActorRole('RESPRSN', 'family')).toBe('v3-RoleCode|RESPRSN');
    expect(normalizeConsentActorRole('http://terminology.hl7.org/CodeSystem/v3-RoleCode|RESPRSN', 'family'))
      .toBe('v3-RoleCode|RESPRSN');
    expect(normalizeConsentActorRole('org.hl7.terminology.CodeSystem.v3-RoleCode|RESPRSN', 'family'))
      .toBe('v3-RoleCode|RESPRSN');
  });

  it('keeps wildcard role unchanged', () => {
    expect(normalizeConsentActorRole('*', 'professional')).toBe('*');
  });
});
