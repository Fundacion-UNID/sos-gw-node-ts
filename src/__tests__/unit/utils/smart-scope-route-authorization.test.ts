// Flow contract: SMART summary authorization binds subject and governed section tokens before materialization.
import {
  constrainSmartCompositionReadSections,
  enforceSmartScopeRouteCompatibility,
} from '../../../utils/smart-scope-route-authorization';
import {
  EXAMPLE_CLINICAL_CODE_PROBLEM,
  EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import {
  HealthcareBasicSections,
  HealthcareTypeOfServiceSections,
} from 'gdc-common-utils-ts/constants/healthcare';

describe('smart scope route authorization', () => {
  it('allows individual routes when one organization/Composition root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'individual',
      bearerPayload: {
        scope: 'organization/Composition.rs?subject=did:web:example:individual:123&section=LOINC|48765-2',
      },
    })).not.toThrow();
  });

  it('rejects individual routes when only organization/ResearchSubject root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'individual',
      bearerPayload: {
        scope: 'organization/ResearchSubject.rs?subject=did:web:example:individual:123',
      },
    })).toThrow('Individual endpoints require one SMART scope rooted at organization/Composition.');
  });

  it('allows digitaltwin routes when one organization/ResearchSubject root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'digitaltwin',
      bearerPayload: {
        scope: 'organization/ResearchSubject.rs?subject=did:web:example:individual:123',
      },
    })).not.toThrow();
  });

  it('rejects digitaltwin routes when only organization/Composition root scope is present', () => {
    expect(() => enforceSmartScopeRouteCompatibility({
      section: 'digitaltwin',
      bearerPayload: {
        scope: 'organization/Composition.rs?subject=did:web:example:individual:123&section=LOINC|48765-2',
      },
    })).toThrow('digitaltwin endpoints require one SMART scope rooted at organization/ResearchSubject.');
  });

  it('inherits exact SMART sections when a summary request omits its own section filter', () => {
    expect(constrainSmartCompositionReadSections({
      subject: EXAMPLE_SUBJECT_DID,
      requestedSections: [],
      bearerPayload: {
        scope: `organization/Composition.rs?subject=${encodeURIComponent(EXAMPLE_SUBJECT_DID)}&section=${EXAMPLE_CLINICAL_CODE_PROBLEM},${EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION}`,
      },
    })).toEqual([
      EXAMPLE_CLINICAL_CODE_PROBLEM,
      EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION,
    ]);
  });

  it('intersects explicit summary sections with the SMART-authorized section set', () => {
    expect(constrainSmartCompositionReadSections({
      subject: EXAMPLE_SUBJECT_DID,
      requestedSections: [
        HealthcareBasicSections.AllergiesAndIntolerances.attributeValue,
        EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION,
      ],
      bearerPayload: {
        scope: `organization/Composition.rs?subject=${encodeURIComponent(EXAMPLE_SUBJECT_DID)}&section=${EXAMPLE_CLINICAL_CODE_PROBLEM},${EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION}`,
      },
    })).toEqual([EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION]);
  });

  it('rejects reuse of a SMART token for another individual summary', () => {
    expect(() => constrainSmartCompositionReadSections({
      subject: `${EXAMPLE_SUBJECT_DID}:other`,
      requestedSections: [],
      bearerPayload: {
        scope: `organization/Composition.rs?subject=${encodeURIComponent(EXAMPLE_SUBJECT_DID)}&section=${EXAMPLE_CLINICAL_SECTION_HISTORY_MEDICATION}`,
      },
    })).toThrow('SMART scope subject does not authorize the requested individual summary.');
  });

  it('does not equate the same code value from different coding systems', () => {
    expect(() => constrainSmartCompositionReadSections({
      subject: EXAMPLE_SUBJECT_DID,
      requestedSections: ['SNOMED|10160-0'],
      bearerPayload: {
        scope: `organization/Composition.rs?subject=${encodeURIComponent(EXAMPLE_SUBJECT_DID)}&section=LOINC|10160-0`,
      },
    })).toThrow('SMART scope sections do not authorize the requested individual summary.');
  });

  it('preserves a governed non-IPS section instead of applying an IPS-only allowlist', () => {
    const appointmentSection = HealthcareTypeOfServiceSections['LP438240-6'].attributeValue;
    expect(constrainSmartCompositionReadSections({
      subject: EXAMPLE_SUBJECT_DID,
      requestedSections: [],
      bearerPayload: {
        scope: `organization/Composition.rs?subject=${encodeURIComponent(EXAMPLE_SUBJECT_DID)}&section=${appointmentSection}`,
      },
    })).toEqual([appointmentSection]);
  });
});
