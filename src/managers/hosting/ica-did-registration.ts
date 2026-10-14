import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { DidDocument } from 'gdc-common-utils-ts/models/did';
import {
  DIDCOMM_DEFAULT_ACCEPT_HEADER,
  DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
} from 'gdc-common-utils-ts/utils/didcomm-submit';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';

type ActivationParticipantMaterial = {
  did?: string;
  sameAs?: string;
  publicKeyJwk?: any;
  jwks?: { keys: any[] };
};

function jwkIdentity(jwk: any): string {
  try {
    return toJwkThumbprintSha256Urn(jwk);
  } catch {
    return String(jwk?.kid || '').trim();
  }
}

/** Keeps ICA `_create` additional JWKS distinct from the primary public JWK. */
export function withoutDuplicatePrimaryJwk(
  jwks: { keys: any[] } | undefined,
  primaryJwk: any,
): { keys: any[] } | undefined {
  if (!Array.isArray(jwks?.keys)) return undefined;
  const primaryIdentity = jwkIdentity(primaryJwk);
  const primaryKid = String(primaryJwk?.kid || '').trim();
  const keys = jwks.keys.filter((key) => {
    const kid = String(key?.kid || '').trim();
    if (primaryKid && kid === primaryKid) return false;
    return !primaryIdentity || jwkIdentity(key) !== primaryIdentity;
  });
  return keys.length ? { keys } : undefined;
}

export function getIcaVerifyBaseUrl(config: any): string {
  const configuredBaseUrl = config.ica?.mode === 'internal'
    ? config.ica?.internalUrl
    : config.ica?.externalUrl || config.ica?.internalUrl;
  if (!configuredBaseUrl) {
    throw new ManagerError('ICA verification URL is not configured.', IssueType.NotSupported);
  }
  return configuredBaseUrl.replace(/\/+$/, '');
}

export function extractJurisdictionFromIcaDidWeb(value?: string): string | undefined {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return undefined;
  const match = normalizedValue.match(/:cds-([A-Za-z]{2,10})(?::|$)/i);
  const jurisdiction = match?.[1]?.trim();
  return jurisdiction ? jurisdiction.toUpperCase() : undefined;
}

export function extractJurisdictionFromIcaUrl(value?: string): string | undefined {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) return undefined;
  const match = normalizedValue.match(/\/ica\/cds-([A-Za-z]{2,10})\/v1(?:\/|$)/i);
  const jurisdiction = match?.[1]?.trim();
  return jurisdiction ? jurisdiction.toUpperCase() : undefined;
}

export function resolveIcaJurisdiction(params: {
  routeJurisdiction?: string;
  configuredBaseUrl?: string;
  config: any;
  isDemoSecurityMode: () => boolean;
  isDevelopmentOrDemoDiagnosticsEnabled: () => boolean;
}): string {
  const configuredJurisdiction = String(params.config.ica?.jurisdiction || '').trim().toUpperCase();
  if (configuredJurisdiction) {
    return configuredJurisdiction;
  }

  const didWebJurisdiction = extractJurisdictionFromIcaDidWeb(params.config.ica?.didWeb);
  if (didWebJurisdiction) {
    return didWebJurisdiction;
  }

  const baseUrlJurisdiction = extractJurisdictionFromIcaUrl(
    params.configuredBaseUrl || getIcaVerifyBaseUrl(params.config),
  );
  if (baseUrlJurisdiction) {
    return baseUrlJurisdiction;
  }

  const normalizedRouteJurisdiction = String(params.routeJurisdiction || '').trim().toUpperCase();
  if (normalizedRouteJurisdiction && !params.isDemoSecurityMode()) {
    return normalizedRouteJurisdiction;
  }

  if (params.isDevelopmentOrDemoDiagnosticsEnabled()) {
    console.log('[HostingManager] ICA jurisdiction fallback', {
      routeJurisdiction: normalizedRouteJurisdiction || undefined,
      hostJurisdiction: String(params.config.host.jurisdiction || '').trim().toUpperCase() || undefined,
      configuredIcaDidWeb: params.config.ica?.didWeb,
      configuredIcaBaseUrl: params.configuredBaseUrl || getIcaVerifyBaseUrl(params.config),
      resolvedIcaJurisdiction: undefined,
    });
  }

  throw new ManagerError(
    'ICA jurisdiction could not be resolved. Configure ICA_JURISDICTION, ICA_DID_WEB, or a path-scoped ICA URL such as /ica/cds-{jurisdiction}/v1/....',
    IssueType.Required,
  );
}

export function buildIcaSectorBaseUrl(params: {
  jurisdiction: string;
  sector: string;
  config: any;
  isDemoSecurityMode: () => boolean;
  isDevelopmentOrDemoDiagnosticsEnabled: () => boolean;
}): string {
  const configuredBaseUrl = getIcaVerifyBaseUrl(params.config);
  const normalizedJurisdiction = resolveIcaJurisdiction({
    routeJurisdiction: params.jurisdiction,
    configuredBaseUrl,
    config: params.config,
    isDemoSecurityMode: params.isDemoSecurityMode,
    isDevelopmentOrDemoDiagnosticsEnabled: params.isDevelopmentOrDemoDiagnosticsEnabled,
  });
  const normalizedSector = String(params.sector || '').trim();
  if (!normalizedSector) {
    throw new ManagerError('ICA sector base URL requires a non-empty sector.', IssueType.Value);
  }
  if (configuredBaseUrl.includes('/ica/cds-')) {
    return configuredBaseUrl;
  }
  return `${configuredBaseUrl}/ica/cds-${normalizedJurisdiction}/v1/${normalizedSector}`;
}

export function buildIcaVerifyUrl(params: {
  jurisdiction: string;
  sector: string;
  resourceType: string;
  config: any;
  isDemoSecurityMode: () => boolean;
  isDevelopmentOrDemoDiagnosticsEnabled: () => boolean;
}): string {
  const normalizedResourceType = String(params.resourceType || 'contract').trim();
  const configuredNetworkKind = String(params.config.networkMode || '').trim().toLowerCase();
  const networkKind = ['local-network', 'test-network', 'network'].includes(configuredNetworkKind)
    ? configuredNetworkKind
    : 'terms';
  return `${buildIcaSectorBaseUrl(params)}/${networkKind}/pdf/${normalizedResourceType}/_verify`;
}

export function buildIcaDidCreateUrl(params: {
  jurisdiction: string;
  sector: string;
  config: any;
  isDemoSecurityMode: () => boolean;
  isDevelopmentOrDemoDiagnosticsEnabled: () => boolean;
}): string | undefined {
  const configuredBaseUrl = params.config.ica?.mode === 'internal'
    ? params.config.ica?.internalUrl
    : params.config.ica?.externalUrl || params.config.ica?.internalUrl;
  if (!configuredBaseUrl) {
    return undefined;
  }
  if (configuredBaseUrl.includes('/entity/did/document/_create')) {
    return configuredBaseUrl;
  }
  if (configuredBaseUrl.includes('/ica/cds-')) {
    return `${configuredBaseUrl.replace(/\/+$/, '')}/entity/did/document/_create`;
  }
  return `${buildIcaSectorBaseUrl(params)}/entity/did/document/_create`;
}

export function resolveAbsoluteUrl(location: string, baseUrl?: string): string {
  const normalizedLocation = String(location || '').trim();
  if (!normalizedLocation) {
    throw new ManagerError('ICA polling location is empty.', IssueType.Value);
  }
  try {
    return new URL(normalizedLocation).toString();
  } catch {
    if (!baseUrl) {
      throw new ManagerError(`ICA polling location must be absolute or have a base URL: ${normalizedLocation}`, IssueType.Value);
    }
    return new URL(normalizedLocation, baseUrl).toString();
  }
}

export async function pollIcaJsonResult(params: {
  location: string;
  baseUrl?: string;
  attempts?: number;
  fetchImpl?: typeof fetch;
}): Promise<any | undefined> {
  const pollingUrl = resolveAbsoluteUrl(params.location, params.baseUrl);
  const attempts = params.attempts ?? 5;
  const fetchImpl = params.fetchImpl || fetch;
  let waitMs = 2000;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    const res = await fetchImpl(pollingUrl, {
      method: HttpRequestMethods.Post,
      headers: {
        'content-type': 'application/json',
      },
    });
    const retryAfterRaw = res.headers.get('retry-after') || res.headers.get('Retry-After');
    const retryAfterSeconds = Number(retryAfterRaw);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      waitMs = retryAfterSeconds * 1000;
    }
    if (res.status === 202) {
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ManagerError(`ICA DID document poll failed: ${res.status} ${text}`.trim(), IssueType.Exception);
    }
    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (
      !contentType.includes('application/json')
      && !contentType.includes('application/didcomm-plain+json')
      && !contentType.includes('application/didcomm-plaintext+json')
    ) {
      return undefined;
    }
    return await res.json().catch(() => undefined);
  }
  throw new ManagerError('ICA DID document creation polling timed out.', IssueType.NotSupported);
}

export async function registerDidDocumentWithIca(params: {
  vpToken: string;
  presentationSubmission?: any;
  jurisdiction: string;
  sector: string;
  organizationCredential: any;
  representativeCredential: any;
  organizationDidDocument: DidDocument;
  controllerDidDocument: DidDocument;
  organizationBinding?: ActivationParticipantMaterial;
  controllerBinding?: ActivationParticipantMaterial;
  config: any;
  isDemoSecurityMode: () => boolean;
  isDevelopmentOrDemoDiagnosticsEnabled: () => boolean;
  fetchImpl?: typeof fetch;
}): Promise<any | undefined> {
  const url = buildIcaDidCreateUrl({
    jurisdiction: params.jurisdiction,
    sector: params.sector,
    config: params.config,
    isDemoSecurityMode: params.isDemoSecurityMode,
    isDevelopmentOrDemoDiagnosticsEnabled: params.isDevelopmentOrDemoDiagnosticsEnabled,
  });
  if (!url) {
    return undefined;
  }

  const organizationSigningKey = params.organizationDidDocument.verificationMethod?.find(
    (method) => (method.publicKeyJwk as any)?.use === 'sig' || (method.publicKeyJwk as any)?.alg,
  )?.publicKeyJwk;
  const controllerSigningKey = params.controllerDidDocument.verificationMethod?.find(
    (method) => (method.publicKeyJwk as any)?.use === 'sig' || (method.publicKeyJwk as any)?.alg,
  )?.publicKeyJwk;

  if (!organizationSigningKey || !controllerSigningKey) {
    throw new ManagerError('Could not resolve organization/controller signing keys for ICA DID registration.', IssueType.Exception);
  }
  if ((organizationSigningKey as any).kid && (organizationSigningKey as any).kid === (controllerSigningKey as any).kid) {
    throw new ManagerError('Organization and controller signing keys must be different for ICA DID registration.', IssueType.Conflict);
  }
  const organizationAdditionalJwks = withoutDuplicatePrimaryJwk(
    params.organizationBinding?.jwks,
    organizationSigningKey,
  );
  const controllerAdditionalJwks = withoutDuplicatePrimaryJwk(
    params.controllerBinding?.jwks,
    controllerSigningKey,
  );

  const fetchImpl = params.fetchImpl || fetch;
  const res = await fetchImpl(url, {
    method: HttpRequestMethods.Post,
    headers: {
      'content-type': DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
      accept: DIDCOMM_DEFAULT_ACCEPT_HEADER,
    },
    body: JSON.stringify({
      thid: `ica-did-document-create-${Date.now()}`,
      type: DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE,
      body: {
        vp_token: params.vpToken,
        presentation_submission: params.presentationSubmission,
        data: [{
          resource: {
            organization: {
              credential: params.organizationCredential,
              identifier: params.organizationDidDocument.id,
              did: params.organizationDidDocument.id,
              didDocument: params.organizationDidDocument,
              publicKeyJwk: organizationSigningKey,
              ...(organizationAdditionalJwks ? { jwks: organizationAdditionalJwks } : {}),
            },
            controller: {
              credential: params.representativeCredential,
              did: params.controllerDidDocument.id,
              didDocument: params.controllerDidDocument,
              publicKeyJwk: controllerSigningKey,
              ...(params.controllerBinding?.sameAs ? { sameAs: params.controllerBinding.sameAs } : {}),
              ...(controllerAdditionalJwks ? { jwks: controllerAdditionalJwks } : {}),
            },
          },
        }],
      },
    }),
  });

  if (res.status === 202) {
    const location = res.headers.get('location') || res.headers.get('Location') || '';
    if (!location) {
      throw new ManagerError('ICA DID document creation returned 202 Accepted without Location header.', IssueType.NotSupported);
    }
    return await pollIcaJsonResult({ location, baseUrl: url, fetchImpl });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ManagerError(`ICA DID document creation failed: ${res.status} ${text}`.trim(), IssueType.Exception);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return undefined;
  }
  return await res.json().catch(() => undefined);
}
