export { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

/**
 * Transitional GW-local FHIR resource constants that are still missing from
 * `gdc-common-utils-ts@^2.0.15`.
 *
 * `ResourceTypesFhirR4` must come from the published shared package. Keep this
 * file only for the small local fallback set that is not exported upstream
 * yet, so future migration to common-utils remains mechanical.
 */
export const GatewayLocalFhirResourceTypes = Object.freeze({
  OperationOutcome: 'OperationOutcome',
  Parameters: 'Parameters',
} as const);
