// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/http-parser.ts

import { URL } from 'url';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { v4 as uuidv4 } from 'uuid';

// --- Helper Functions ---

export function convertUrlEncodedDataToJson(formEncodedData: string): { [key: string]: string; } {
  // ... (Your implementation is solid, no changes needed)
  const extractedData: { [key: string]: string } = {};
  if (!formEncodedData) return extractedData;
  const queryString = formEncodedData.startsWith('http') ? new URL(formEncodedData).search.slice(1).trim() : formEncodedData.trim();
  queryString.replace(/(\r\n|\n|\r)/gm, '').split('&').forEach((pair) => {
    const [key, value] = pair.split('=');
    if (key !== undefined && value !== undefined) {
        const decodedKey = decodeURIComponent(key.replace(/\+/g, ' '));
        const decodedValue = decodeURIComponent(value.replace(/\+/g, ' '));
        extractedData[decodedKey] = decodedValue;
    }
  });
  return extractedData;
}

export function convertPlainMessageToJson(message: any, contentType: string): any {
  try {
    if (contentType.includes('json')) {
      return JSON.parse(message);
    } else if (contentType.includes('x-www-form-urlencoded')) {
      return convertUrlEncodedDataToJson(message);
    } else {
      // In a real scenario, you might support XML, etc.
      return message; // Return as is if not a known type to parse
    }
  } catch (error) {
    const errorMessage = (error as Error).message;
    throw new Error(`Error processing the message: ${errorMessage}`);
  }
}

function inferFhirVersionFromFormat(format: string | undefined): string | undefined {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized === 'org.hl7.fhir.r5' || normalized.endsWith('.r5')) return '5.0';
  if (normalized === 'org.hl7.fhir.r4' || normalized.endsWith('.r4')) return '4.0';
  return undefined;
}

function inferDidcommPayloadType(
  payload: any,
  format: string | undefined,
  contentType: string | undefined,
): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;

  const existingType = typeof payload.type === 'string' ? payload.type.trim() : '';
  if (existingType) return existingType;

  const body = payload.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;

  const normalizedContentType = String(contentType || '').toLowerCase();
  const inferredFhirVersion = inferFhirVersionFromFormat(format);

  if (Array.isArray(body.entry) || normalizedContentType.includes('application/fhir+json')) {
    return inferredFhirVersion
      ? `application/fhir+json; fhirVersion=${inferredFhirVersion}`
      : 'application/fhir+json';
  }

  if (Array.isArray(body.data)) {
    return 'application/vnd.api+json';
  }

  return undefined;
}

function normalizeDidcommPayloadType(
  payload: any,
  format: string | undefined,
  contentType: string | undefined,
): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const inferredType = inferDidcommPayloadType(payload, format, contentType);
  if (!inferredType) return payload;
  return {
    ...payload,
    type: inferredType,
  };
}


// --- Main Parsing Logic (Adapted for the new URL structure) ---

/**
 * Extracts and structures HTTP request data based on the defined CDS path structure.
 * URL Structure: /:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType/:action
 */
export function extractHttpRequestDataAsJson(
  url: string,
  input: any,
  contentType: string,
  httpMethod: string
): JobRequest {
  const urlObj = new URL(url, 'http://localhost'); // Base is required for parsing
  const pathParts = urlObj.pathname.split('/').filter(part => part);

  if (pathParts.length < 8) {
    throw new Error('Invalid CDS URL structure. Not enough path segments.');
  }
  
  const cdsIndex = pathParts.findIndex(part => part.startsWith('cds-'));
  if (cdsIndex === -1 || cdsIndex === 0) {
    throw new Error("Invalid CDS URL structure: 'cds-' part missing or misplaced.");
  }
  
  const actionPart = pathParts[cdsIndex + 6];
  if (!actionPart || !actionPart.startsWith('_')) {
    throw new Error('Invalid action format. Must start with an underscore (_).');
  }

  const requestData: JobRequest = {
    id: uuidv4(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    requestUrl: url,
    httpMethod: httpMethod.toUpperCase(),
    content: normalizeDidcommPayloadType(input, pathParts[cdsIndex + 4], contentType),
    contentType: contentType,
    tenantId: pathParts[cdsIndex - 1],
    jurisdiction: pathParts[cdsIndex].substring(4), // Remove 'cds-'
    apiVersion: pathParts[cdsIndex + 1],
    sector: pathParts[cdsIndex + 2],
    section: pathParts[cdsIndex + 3],
    format: pathParts[cdsIndex + 4],
    resourceType: pathParts[cdsIndex + 5],
    action: actionPart.substring(1), // Remove '_'
  };

  return requestData;
}
