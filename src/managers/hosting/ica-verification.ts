import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { v4 as uuidv4 } from 'uuid';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  DIDCOMM_DEFAULT_ACCEPT_HEADER,
} from 'gdc-common-utils-ts/utils/didcomm-submit';

type LegalOrganizationVerificationTransactionResource = Readonly<{
  meta?: { claims?: ClaimsRecord };
  controller?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  legalRepresentativePayload?: Record<string, unknown>;
  legalRepresentative?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}>;

type LegalOrganizationVerificationTransactionEntry = Readonly<{
  type?: string;
  /** @deprecated Read-only compatibility with older GW callers. */
  meta?: {
    claims?: ClaimsRecord;
  };
  resource?: LegalOrganizationVerificationTransactionResource;
}>;

type ForwardOrganizationVerificationTransactionToIcaDeps = Readonly<{
  job: JobRequest;
  entry: LegalOrganizationVerificationTransactionEntry;
  claims: ClaimsRecord;
  resource: LegalOrganizationVerificationTransactionResource;
  requestedSector: string;
  resourceType: string;
  organizationVerificationTransactionRequestType: string;
  icaDidcommPlainJsonMediaType: string;
  hostJurisdiction?: string;
  hostDid: string;
  signHostAuthorizationPayload: (payload: Record<string, unknown>) => Promise<string>;
  buildIcaVerifyUrl: (jurisdiction: string, sector: string, resourceType: string) => string;
  pollIcaJsonResult: (url: string, fallbackUrl?: string) => Promise<any>;
  fetchImpl?: typeof fetch;
}>;

/**
 * Builds and submits the transitional DIDComm verification request sent from
 * GW host onboarding to ICA `_verify`.
 *
 * Contract:
 * - request body always reprojects host claims/resources into a single-entry bundle
 * - flattened transport claims live at `body.data[].resource.meta.claims`
 * - `202 Accepted` must be followed via polling until the final JSON payload arrives
 * - non-JSON success responses are tolerated and normalized to `{}` so callers can
 *   still continue with deterministic claim-side processing
 */
export async function forwardOrganizationVerificationTransactionToIca(
  deps: ForwardOrganizationVerificationTransactionToIcaDeps,
): Promise<any> {
  const didcommContent = (deps.job.content || {}) as IDecodedDidcommPayload & { attachments?: unknown[] };
  const attachments = Array.isArray(didcommContent.attachments) && didcommContent.attachments.length > 0
    ? didcommContent.attachments
    : Array.isArray((deps.job.content?.body as any)?.attachments)
      ? (deps.job.content?.body as any).attachments
      : [];
  const hostAuthorizationProof = (deps.job.content?.body as any)?.hostAuthorizationProof;
  const signedHostResource = hostAuthorizationProof
    ? (deps.job.content?.body as any)?.data?.[0]?.resource
    : undefined;
  const translatedResource = signedHostResource || {
    meta: {
      claims: deps.claims,
    },
    ...(deps.resource.controller ? { controller: deps.resource.controller } : {}),
    ...(deps.resource.organization ? { organization: deps.resource.organization } : {}),
    ...(deps.resource.legalRepresentativePayload
      ? { legalRepresentative: deps.resource.legalRepresentativePayload }
      : deps.resource.legalRepresentative
        ? { legalRepresentative: deps.resource.legalRepresentative }
        : {}),
    verification: {
      resourceType: deps.resourceType,
    },
  };
  const translatedBody = {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'collection',
    total: 1,
    ...(hostAuthorizationProof && typeof hostAuthorizationProof === 'object'
      ? { hostAuthorizationProof }
      : {}),
    data: [{
      type: deps.entry.type || deps.organizationVerificationTransactionRequestType,
      resource: translatedResource,
    }],
  };
  const jurisdiction = String(deps.job.jurisdiction || deps.hostJurisdiction || '').trim().toUpperCase();
  if (!jurisdiction) {
    throw new ManagerError(
      'ICA verification jurisdiction is required from the request or configured host jurisdiction.',
      IssueType.Required,
    );
  }
  const hostAuthorizationPayload = {
    jurisdiction,
    sector: deps.requestedSector,
    networkKind: String(deps.job.sector || '').toLowerCase(),
    resourceType: deps.resourceType,
    resource: translatedResource,
  };
  const resolvedHostAuthorizationProof = hostAuthorizationProof
    || (attachments.length ? undefined : { jws: await deps.signHostAuthorizationPayload(hostAuthorizationPayload) });
  const requestPayload = {
    jti: String(deps.job.content?.jti || uuidv4()),
    thid: String(deps.job.content?.thid || uuidv4()),
    iss: attachments.length || hostAuthorizationProof ? deps.job.content?.iss : deps.hostDid,
    aud: 'ica',
    type: deps.job.content?.type || 'application/api+json',
    body: {
      ...translatedBody,
      ...(resolvedHostAuthorizationProof ? { hostAuthorizationProof: resolvedHostAuthorizationProof } : {}),
    },
    ...(attachments.length ? { attachments } : {}),
    ...(deps.job.content?.meta ? { meta: deps.job.content.meta } : {}),
  };

  const fetchImpl = deps.fetchImpl || fetch;
  const verifyUrl = deps.buildIcaVerifyUrl(
    jurisdiction,
    deps.requestedSector,
    deps.resourceType,
  );
  const response = await fetchImpl(verifyUrl, {
    method: HttpRequestMethods.Post,
    headers: {
      accept: DIDCOMM_DEFAULT_ACCEPT_HEADER,
      'content-type': deps.icaDidcommPlainJsonMediaType,
    },
    body: JSON.stringify(requestPayload),
  });

  if (response.status === 202) {
    const location = response.headers.get('location') || response.headers.get('Location') || '';
    if (!location) {
      throw new ManagerError('ICA verify returned 202 Accepted without Location header.', IssueType.NotSupported);
    }
    const polled = await deps.pollIcaJsonResult(location, verifyUrl);
    return assertIcaVerificationSucceeded(polled || {});
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ManagerError(`ICA verify failed: ${response.status} ${text}`.trim(), IssueType.Exception);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  return assertIcaVerificationSucceeded(await response.json().catch(() => ({})));
}

function assertIcaVerificationSucceeded(payload: unknown): unknown {
  let failureDiagnostic = '';
  const visited = new WeakSet<object>();
  const walk = (node: unknown): void => {
    if (failureDiagnostic || !node || typeof node !== 'object') return;
    if (visited.has(node as object)) return;
    visited.add(node as object);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const value = node as Record<string, unknown>;
    const severity = String(value.severity || '').toLowerCase();
    if (severity === 'error' || severity === 'fatal') {
      failureDiagnostic = String(value.diagnostics || value.details || 'terminal ICA OperationOutcome');
      return;
    }
    if (value.status === 'failed') {
      failureDiagnostic = String(value.error || 'terminal ICA verification status is failed');
      return;
    }
    if (value.response && typeof value.response === 'object') {
      const status = Number((value.response as Record<string, unknown>).status);
      if (Number.isFinite(status) && status >= 400) {
        failureDiagnostic = `terminal ICA response status ${status}`;
        return;
      }
    }
    Object.values(value).forEach(walk);
  };
  walk(payload);
  if (failureDiagnostic) {
    throw new ManagerError(`ICA verification failed: ${failureDiagnostic}`, IssueType.Exception);
  }
  return payload;
}

/**
 * Extracts credential-like resources from arbitrary ICA envelopes.
 *
 * Transitional response contract:
 * - the response entry keeps `vc[]` as the client-facing credential projection
 * - `resource.icaResponse` keeps the raw upstream ICA envelope only for
 *   audit/debug compatibility; clients should not parse it when `vc[]` exists
 */
export function extractCredentialResourcesFromIcaPayload(
  icaResponse: unknown,
): Array<Record<string, unknown>> {
  const credentials: Array<Record<string, unknown>> = [];
  const visited = new WeakSet<object>();
  const fingerprints = new Set<string>();

  const addCredential = (candidate: Record<string, unknown>) => {
    const subject = Array.isArray(candidate.credentialSubject)
      ? candidate.credentialSubject[0]
      : candidate.credentialSubject;
    const typeTokens = Array.isArray(candidate.type)
      ? candidate.type.map((token) => String(token || '').trim()).filter(Boolean)
      : typeof candidate.type === 'string'
        ? [candidate.type.trim()]
        : [];
    const fingerprint = JSON.stringify({
      id: candidate.id || '',
      issuer: candidate.issuer || '',
      type: typeTokens,
      subjectId: typeof subject === 'object' && subject ? (subject as any).id || '' : '',
    });
    if (fingerprints.has(fingerprint)) {
      return;
    }
    fingerprints.add(fingerprint);
    credentials.push(candidate);
  };

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (visited.has(node as object)) {
      return;
    }
    visited.add(node as object);
    if (isCredentialLikeObject(node)) {
      addCredential(node as Record<string, unknown>);
    }
    if (Array.isArray(node)) {
      node.forEach((entry) => walk(entry));
      return;
    }
    const candidate = node as Record<string, unknown>;
    if (Array.isArray(candidate.data)) {
      candidate.data.forEach((entry) => walk(entry));
    }
    if (candidate.body) {
      walk(candidate.body);
    }
    if (candidate.resource) {
      walk(candidate.resource);
    }
  };

  walk(icaResponse);
  return credentials;
}

function isCredentialLikeObject(candidate: unknown): candidate is Record<string, unknown> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return false;
  }
  const credential = candidate as Record<string, unknown>;
  const subject = credential.credentialSubject;
  if (!subject || (typeof subject !== 'object' && !Array.isArray(subject))) {
    return false;
  }
  const typeTokens = Array.isArray(credential.type)
    ? credential.type.map((token) => String(token || '').trim()).filter(Boolean)
    : typeof credential.type === 'string'
      ? [credential.type.trim()]
      : [];
  return !!credential.issuer
    || typeTokens.includes('VerifiableCredential')
    || typeTokens.some((token) => /Credential$/i.test(token));
}
