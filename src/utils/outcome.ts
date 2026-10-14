// src/utils/outcome.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { OperationOutcome } from 'gdc-common-utils-ts/models/operation-outcome';
import { IssueLevel, IssueTypeCode } from 'gdc-common-utils-ts/models/issue';

/**
 * Creates a standardized FHIR OperationOutcome object.
 * @param issueLevel The severity of the issue (e.g., 'error', 'warning').
 * @param issueType The FHIR issue type code (e.g., 'not-found', 'invalid').
 * @param diagnosticsText Optional detailed error message. If not provided, a default
 *                        message is constructed from the issue level and type for security.
 * @returns A complete OperationOutcome object.
 */
export function createOperationOutcome(
  issueLevel: IssueLevel,
  issueType: IssueTypeCode,
  diagnosticsText?: string
): OperationOutcome {
  // Security: If no specific diagnostic text is provided, create a generic one
  // to avoid leaking internal implementation details.
  const diagnostics = diagnosticsText || `${issueLevel}: ${issueType}`;

  return {
    resourceType: ResourceTypesFhirR4.OperationOutcome,
    issue: [{
      severity: issueLevel,
      code: issueType,
      diagnostics: diagnostics,
    }],
  };
}
