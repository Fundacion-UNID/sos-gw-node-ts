// src/utils/jsonapi.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { safelyJoinUrl } from "gdc-common-utils-ts/utils/url";

/**
* Converts a resource (FHIR or JSON:API) into a standardized array of entries.
* @param inputData The resource or bundle to convert.
* @param requestPath The base request path for the resource.
* @param webDomain The domain of the service.
* @returns An array of standardized resource entries.
*/
export const convertResourceDataToArrayOfDataEntries = (inputData: any, requestPath: string, webDomain: string): any[] => {
    if (inputData.resourceType) {
        // Handle FHIR resources
        if (inputData.resourceType === 'Bundle') {
            return inputData.entry || [];
        } else {
            const resourceIdentifier = inputData.identifier?.[0]?.value || '';
            const fullUrl = safelyJoinUrl(webDomain, safelyJoinUrl(requestPath, resourceIdentifier));
            return [{ fullUrl, resource: inputData }];
        }
    } else {
        // Handle JSON:API resources
        return [inputData];
    }
};
  
/**
* Converts a resource or bundle into a JSON:API Primary Document structure.
* @param resourceData The input FHIR or JSON:API resource/bundle.
* @param specification A namespace for the type.
* @param webDomain The domain of the service.
* @param requestPath The base request path.
* @param bundleType The desired bundle type.
* @returns A JSON:API Primary Document.
*/
export const convertResourceOrBundleToPrimaryDoc = (resourceData: any, specification: string, webDomain: string, requestPath: string, bundleType: string): any => {
    const entries = convertResourceDataToArrayOfDataEntries(resourceData, requestPath, webDomain);
    return {
      data: entries,
    };
};
  
/**
 * Converts a JSON:API Primary Document back into a FHIR Bundle.
 * @param primaryDocument The JSON:API document with a `data` or `errors` array.
 * @param bundleType The type of the FHIR Bundle (e.g., 'searchset').
 * @returns A FHIR Bundle object.
 */
export const convertPrimaryDocToFhirBundle = (primaryDocument: any, bundleType: string): any => {
    const entries: any[] = [];
    
    if (primaryDocument.data) {
        entries.push(...primaryDocument.data.map((jsonApiResourceObject: any) => ({
            fullUrl: jsonApiResourceObject.fullUrl,
            resource: jsonApiResourceObject.resource,
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
                }],
            }
        })));
    }
    
    const bundle: any = {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: bundleType,
        total: entries.length,
        entry: entries,
    };
    
    return bundle;
};
