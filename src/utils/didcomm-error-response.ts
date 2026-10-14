// src/utils/didcomm-error-response.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import type { Request, Response } from 'express';
import { IssueLevel, IssueTypeCode } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from './outcome';

export type LegacyFhirErrorBody = {
  resourceType: typeof ResourceTypesFhirR4.Bundle;
  entry: [];
  total: 0;
  issues: {
    issue: ReturnType<typeof createOperationOutcome>['issue'];
  };
};

export type DidcommErrorEnvelope = {
  type: 'application/bundle-api+json' | 'application/fhir+json';
  body: {
    resourceType: typeof ResourceTypesFhirR4.Bundle;
    total: 0;
    issues: {
      issue: ReturnType<typeof createOperationOutcome>['issue'];
    };
    data?: [];
    entry?: [];
  };
};

function isLegacyFhirDirectRequest(req: Pick<Request, 'headers'>): boolean {
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  const accept = String(req.headers?.accept || '').toLowerCase();
  return contentType.includes('application/fhir+json') || accept.includes('application/fhir+json');
}

function isDidcommFhirCompatibleRequest(req: Pick<Request, 'params' | 'headers'>): boolean {
  const format = String(req.params?.format || '').toLowerCase();
  const contentType = String(req.headers?.['content-type'] || '').toLowerCase();
  const accept = String(req.headers?.accept || '').toLowerCase();

  return (
    format.startsWith('org.hl7.fhir') ||
    contentType.includes('application/fhir+json') ||
    accept.includes('application/fhir+json')
  );
}

export function createDidcommEarlyErrorEnvelope(params: {
  issueType: IssueTypeCode;
  diagnostics?: string;
  issueLevel?: IssueLevel;
  fhir?: boolean;
}): DidcommErrorEnvelope {
  const issueLevel = params.issueLevel || IssueLevel.Error;
  const outcome = createOperationOutcome(issueLevel, params.issueType, params.diagnostics);
  const useFhir = Boolean(params.fhir);

  return useFhir
    ? {
        type: 'application/fhir+json',
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          entry: [],
          total: 0,
          issues: { issue: outcome.issue },
        },
      }
    : {
        type: 'application/bundle-api+json',
        body: {
          resourceType: ResourceTypesFhirR4.Bundle,
          data: [],
          total: 0,
          issues: { issue: outcome.issue },
        },
      };
}

export function sendDidcommEarlyError(
  req: Pick<Request, 'params' | 'headers'>,
  res: Response,
  status: number,
  issueType: IssueTypeCode,
  diagnostics?: string,
  issueLevel: IssueLevel = IssueLevel.Error,
): Response {
  const outcome = createOperationOutcome(issueLevel, issueType, diagnostics);

  // LEGACY_FHIR mode: no DIDComm envelope, return raw FHIR JSON body.
  if (isLegacyFhirDirectRequest(req)) {
    const body: LegacyFhirErrorBody = {
      resourceType: ResourceTypesFhirR4.Bundle,
      entry: [],
      total: 0,
      issues: { issue: outcome.issue },
    };
    return res.status(status).set('Content-Type', 'application/fhir+json').send(JSON.stringify(body));
  }

  const payload = createDidcommEarlyErrorEnvelope({
    issueType,
    diagnostics,
    issueLevel,
    fhir: isDidcommFhirCompatibleRequest(req),
  });

  return res.status(status).json(payload);
}
