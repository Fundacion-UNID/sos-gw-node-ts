// src/routes/handlers/discovery/ping.handler.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { Request, Response } from 'express';
import { createOperationOutcome } from '../../../utils/outcome';
import { compactJWT } from 'gdc-common-utils-ts/utils/jwt';
import { convertPrimaryDocToFhirBundle } from '../../../utils/jsonapi';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';

/**
 * Encodes a hostname from a request's Host header for use in a did:web.
 * Example: 'localhost:3000' -> 'localhost%3A3000'
 */
function getEncodedHostFromRequest(req: Request): string {
  const host = req.get('host') || 'localhost';
  return host.replace(':', '%3A');
}

/**
 * Handles requests to the ping endpoint (e.g., `/.well-known/ping`).
 * This endpoint serves two purposes:
 * 1. A basic health check to confirm the service is running.
 * 2. A demonstration of the API's content negotiation capabilities.
 *
 * The structure of the response varies based on the client's `Accept` header,
 * showcasing the different data formats the API supports.
 */
export const pingHandler = () => async (req: Request, res: Response) => {
    const tenantId = res.locals.tenantId as string;

    // 1. Create the canonical response body (the Bundle). This is the base data structure.
    const responseBundle = {
        type: 'batch-response',
        meta: {
            timestamp: new Date().toISOString(),
            tenantId: tenantId,
        },
        data: [ createOperationOutcome(IssueLevel.Information, IssueType.Throttled, 'Ping successful') ],
    };

    const acceptedType = req.accepts(['application/json', 'application/fhir+json', 'application/x-www-form-urlencoded']);

    switch (acceptedType) {
        case 'application/fhir+json':
            // For FHIR clients, we demonstrate the ability to transform our canonical
            // JSON:API-style bundle into a standard FHIR Bundle by changing `data` to `entry`.
            const responseBundleFhir = convertPrimaryDocToFhirBundle(responseBundle, 'batch-response');
            res.json(responseBundleFhir);
            break;

        case 'application/x-www-form-urlencoded':
            // For FAPI/JARM-compliant clients, we demonstrate the full secure response format.
            // The issuer MUST be derived from the Host header to match the client's expectation.
            const issuerDid = `did:web:${getEncodedHostFromRequest(req)}`;
            const responsePayload: IDecodedDidcommPayload = {
                jti: uuidv4(),
                type: 'ping-response',
                thid: `ping-${Date.now()}`,
                iss: issuerDid,
                aud: 'anonymous',
                exp: Math.floor(Date.now() / 1000) + 300, // Expires in 5 minutes
                body: responseBundle,
            };
            const jws = await compactJWT({ alg: 'none' }, responsePayload);
            res.type('application/x-www-form-urlencoded').send(`response=${jws}`);
            break;

        case 'application/json':
        default:
            // For standard JSON API clients, we return the canonical bundle directly,
            // without the JARM envelope.
            res.json(responseBundle);
            break;
    }
};
