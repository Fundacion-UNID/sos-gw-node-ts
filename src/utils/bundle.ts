// src/utils/bundle.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

import { BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { safelyJoinUrl } from 'gdc-common-utils-ts/utils/url';

export const BundleType = {
  BatchResponse: 'batch-response',
  Searchset: 'searchset',
  TransactionResponse: 'transaction-response',
} as const;

export type BundleType = typeof BundleType[keyof typeof BundleType];

/**
 * Maps a request action to the corresponding FHIR-like Bundle type for the response,
 * based on the semantic nature of the operation.
 * @param action The action from the JobRequest (e.g., '_batch', '_search').
 * @returns The corresponding BundleType for the response.
 */
export function getBundleResponseTypeForAction(action?: string): BundleType {
  switch (action) {
    // Read/Query Operations -> searchset
    case '_search':
    case '_history':
      return BundleType.Searchset;

    // Atomic Transactional Operations -> transaction-response
    case '_transaction':
    case '_seal':
      return BundleType.TransactionResponse;

    // Independent Batch Operations -> batch-response
    case '_batch':
    case '_verify':
    default:
      // Default to batch-response as it's the most common multi-entry operation.
      return BundleType.BatchResponse;
  }
}

/**
 * Creates a response Bundle containing a single, fatal error entry.
 * This is used by the Worker when a catastrophic error occurs.
 *
 * @param errorMessage The high-level error message to report.
 * @param action The action from the original request, used to set the bundle type.
 * @param originalEntryType The 'type' from the original request entry, if available.
 * @returns A response Bundle containing a single error entry.
 */
export function createErrorBundle(errorMessage: string, action?: string, originalEntryType?: string): BundleJsonApi {
  const errorEntry: ErrorEntry = {
    // Reflect the original type if known, otherwise use a generic error type.
    type: originalEntryType || 'unknown-error-v1.0',
    response: {
      status: String(HttpStatusCodes.InternalServerError),
      outcome: {
        resourceType: ResourceTypesFhirR4.OperationOutcome,
        issue: [{
          severity: IssueLevel.Error,
          code: IssueType.Exception,
          diagnostics: errorMessage,
        }]
      }
    }
  };

  return {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: getBundleResponseTypeForAction(action),
    data: [errorEntry]
  };
}


/**
* Converts a resource (FHIR Bundle or single resource) or a JSON:API object
* to a canonical array of entries. This is the primary normalization function.
* @param inputData The raw input body.
* @param requestPath The path from the original request URL.
* @param webDomain The domain of the service.
* @returns A canonical array of data entries.
*/
export const convertResourceDataToArrayOfDataEntries = (inputData: any, requestPath: string, webDomain: string): any[] => {
  if (!inputData) return [];

  if (inputData.resourceType) { // FHIR data
    if (inputData.resourceType === 'Bundle') {
      return inputData.entry || []; // Return the array of "entries"
    } else {
      // It's a single FHIR resource
      const resourceIdentifier = inputData.id || "";
      const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
      return [{ fullUrl: fullUrl, resource: inputData }];
    }
  } else if (inputData.data) { // JSON:API Primary Document
    return inputData.data;
  } else {
    // Assume it's a single JSON:API Resource Object
    const resourceIdentifier = inputData.id || "";
    const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
    return [{ ...inputData }];
  }
};

/**
* Converts a resource or a bundle into a JSON:API Primary Document structure.
* @param resourceData The source data.
* @param webDomain The domain of the service.
* @param requestPath The path from the request.
* @returns A JSON:API Primary Document.
*/
export const convertResourceOrBundleToPrimaryDoc = (resourceData: any, webDomain: string, requestPath: string): any => {
  const entries = convertResourceDataToArrayOfDataEntries(resourceData, requestPath, webDomain);
  return {
    data: entries.map(entry => ({
      // This mapping can be made more sophisticated if needed
      ...entry,
    })),
  };
};

/**
* Converts a JSON:API Primary Document back to a FHIR Bundle.
* @param primaryDocument The JSON:API document.
* @param bundleType The desired type of the output bundle (e.g., 'batch-response').
* @returns A FHIR Bundle.
*/
export const convertPrimaryDocToBundleFHIR = (primaryDocument: any, bundleType: string): any => {
  const entries: any[] = [];

  if (primaryDocument.data) {
    entries.push(...primaryDocument.data.map((jsonApiResourceObject: any) => ({
      fullUrl: jsonApiResourceObject.fullUrl,
      resource: jsonApiResourceObject.resource
    })));
  }

  if (primaryDocument.errors) {
    entries.push(...primaryDocument.errors.map((errorObject: any) => ({
      resource: {
        resourceType: ResourceTypesFhirR4.OperationOutcome,
        id: errorObject.id,
        issue: [{
          code: errorObject.status,
          severity: 'error',
          details: { text: errorObject.detail },
        }]
      }
    })));
  }

  const bundle: any = {
    entry: entries,
    resourceType: ResourceTypesFhirR4.Bundle,
    total: primaryDocument.data ? primaryDocument.data.length : 0,
    type: bundleType
  };

  if (primaryDocument.id) {
    bundle.identifier = [{ value: primaryDocument.id }];
  }

  return bundle;
};
