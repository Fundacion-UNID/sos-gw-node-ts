// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/fhir-ingestion.test.ts

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import {
  clearFhirVersionValidators,
  normalizeFhirIngestionFormat,
  registerFhirVersionValidator,
  validateFhirPayloadByVersion,
} from '../../../utils/fhir-ingestion';

describe('fhir-ingestion utils', () => {
  afterEach(() => {
    clearFhirVersionValidators();
  });

  it('normalizes allowed ingestion formats', () => {
    expect(normalizeFhirIngestionFormat('org.hl7.fhir.api')).toBe('org.hl7.fhir.api');
    expect(normalizeFhirIngestionFormat('ORG.HL7.FHIR.R4')).toBe('org.hl7.fhir.r4');
    expect(normalizeFhirIngestionFormat('ORG.HL7.FHIR.R5')).toBe('org.hl7.fhir.r5');
    expect(() => normalizeFhirIngestionFormat('org.hl7.fhir.r6')).toThrow('Unsupported FHIR format');
  });

  it('skips strict validation in org.hl7.fhir.api mode', () => {
    expect(() =>
      validateFhirPayloadByVersion('org.hl7.fhir.api', 'Observation', { meta: { claims: {} } }),
    ).not.toThrow();
  });

  it('requires resource/resourceType in org.hl7.fhir.r4 mode', () => {
    expect(() =>
      validateFhirPayloadByVersion('org.hl7.fhir.r4', 'Observation', { meta: { claims: {} } }),
    ).toThrow("FHIR R4 validation requires entry.resource for 'Observation'.");

    expect(() =>
      validateFhirPayloadByVersion('org.hl7.fhir.r4', 'Observation', {
        resource: { resourceType: 'DocumentReference' },
      }),
    ).toThrow("FHIR R4 validation failed: expected resourceType 'Observation' but got 'DocumentReference'.");
  });

  it('invokes registered r4 validator when format is org.hl7.fhir.r4', () => {
    const validator = jest.fn();
    registerFhirVersionValidator('r4', validator);
    const resource = { resourceType: 'Observation', status: 'final' };

    validateFhirPayloadByVersion('org.hl7.fhir.r4', 'Observation', { resource });

    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator).toHaveBeenCalledWith(resource, 'Observation');
  });

  it('invokes the UHC-owned r5 validator when format is org.hl7.fhir.r5', () => {
    const validator = jest.fn();
    registerFhirVersionValidator('r5', validator);
    const resource = { resourceType: 'Communication', status: 'completed' };

    validateFhirPayloadByVersion('org.hl7.fhir.r5', 'Communication', { resource });

    expect(validator).toHaveBeenCalledWith(resource, 'Communication');
  });
});
