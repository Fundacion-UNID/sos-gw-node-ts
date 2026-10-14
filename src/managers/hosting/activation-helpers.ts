import { validate as uuidValidate } from 'uuid';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { getBaseUrlFromDidWeb } from '../../utils/did-backend';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';
import {
  ORGANIZATION_ACTIVATION_VC_TYPES,
  REPRESENTATIVE_ACTIVATION_VC_TYPES,
  SERVICE_CONTROLLER_ACTIVATION_VC_TYPES,
} from 'gdc-common-utils-ts/constants/verifiable-credentials';

export type ActivationParticipantMaterial = {
  did?: string;
  sameAs?: string;
  publicKeyJwk?: PublicJwk;
  jwks?: JwkSet;
};

export type ActivationMaterial = {
  vpToken: any;
  presentationSubmission: any;
  organizationCredential: any;
  representativeCredential: any;
  controllerCredential: any;
  legacyOrganizationCredential: any;
  legacyRepresentativeCredential: any;
  legacyControllerCredential: any;
  primaryDid: any;
  publicTenantUrl: any;
  organizationBinding?: ActivationParticipantMaterial;
  controllerBinding?: ActivationParticipantMaterial;
};

export type VpCredentialObject = Record<string, unknown>;

/**
 * Normalizes legal-organization identity claims before pending registration or
 * activation logic derives tenant ids and URNs.
 */
export function applyLegalOrganizationIdentityCompatibility(
  claims: ClaimsRecord,
  organizationCredential?: unknown,
): ClaimsRecord {
  const processedClaims = { ...claims };
  const alternateName = String(processedClaims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
  const isIndividualOrg = !!(
    processedClaims['org.schema.Organization.owner.telephone']
    || processedClaims['org.schema.Organization.owner.email']
  );
  const identifierValue = String(processedClaims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
  const identifierType = String(processedClaims[ClaimsOrganizationSchemaorg.identifierType] || '').trim();
  const subject = Array.isArray((organizationCredential as any)?.credentialSubject)
    ? (organizationCredential as any).credentialSubject[0]
    : (organizationCredential as any)?.credentialSubject;
  const taxId = String(subject?.taxID || '').trim();
  const credentialLegalName = String(subject?.legalName || '').trim();
  const credentialAddress = Array.isArray(subject?.address) ? subject.address[0] : subject?.address;
  const credentialAddressCountry = String(credentialAddress?.addressCountry || '').trim();

  // The ICA credential has already crossed the activation trust boundary.
  // Legacy activation callers must not duplicate its verified legal identity.
  if (!String(processedClaims[ClaimsOrganizationSchemaorg.legalName] || '').trim() && credentialLegalName) {
    processedClaims[ClaimsOrganizationSchemaorg.legalName] = credentialLegalName;
  }

  if (!identifierValue && taxId) {
    processedClaims[ClaimsOrganizationSchemaorg.identifierValue] = taxId;
  }
  const finalIdentifierValue = String(processedClaims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim();
  const normalizedUuidValue = finalIdentifierValue.startsWith('urn:uuid:')
    ? finalIdentifierValue.slice('urn:uuid:'.length)
    : finalIdentifierValue;
  if (!identifierType && finalIdentifierValue) {
    processedClaims[ClaimsOrganizationSchemaorg.identifierType] = uuidValidate(normalizedUuidValue) ? 'UUID' : 'TAX';
  }
  if (!String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
    const addressCountry = credentialAddressCountry
      || inferJurisdictionFromLegalIdentifier(taxId || finalIdentifierValue);
    if (addressCountry) {
      processedClaims[ClaimsOrganizationSchemaorg.addressCountry] = addressCountry;
    }
  }
  if (!alternateName && !isIndividualOrg && finalIdentifierValue) {
    processedClaims[ClaimsOrganizationSchemaorg.alternateName] = finalIdentifierValue;
  }
  return processedClaims;
}

export function inferJurisdictionFromLegalIdentifier(identifierValue?: string): string | undefined {
  const normalized = String(identifierValue || '').trim().toUpperCase();
  if (!normalized) return undefined;
  if (normalized.startsWith('VATES-')) return 'ES';
  const vatCountryMatch = /^VAT([A-Z]{2})[-:]?/.exec(normalized);
  if (vatCountryMatch?.[1]) {
    return vatCountryMatch[1];
  }
  return undefined;
}

export function extractDidFromCredential(credential: any): string | undefined {
  if (!credential || typeof credential !== 'object') {
    return undefined;
  }
  const subject = Array.isArray(credential.credentialSubject)
    ? credential.credentialSubject[0]
    : credential.credentialSubject;
  const didCandidate = subject?.id || credential?.id;
  return typeof didCandidate === 'string' && didCandidate.startsWith('did:web:')
    ? didCandidate
    : undefined;
}

export function decodeVpTokenPayload(vpToken?: string): Record<string, any> | undefined {
  const raw = String(vpToken || '').trim();
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  const parts = raw.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return undefined;
  }
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadJson);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function decodeEmbeddedCredential(candidate: unknown): VpCredentialObject | undefined {
  if (candidate && typeof candidate === 'object') {
    return candidate as VpCredentialObject;
  }
  if (typeof candidate !== 'string') {
    return undefined;
  }
  const raw = candidate.trim();
  if (!raw) {
    return undefined;
  }
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  const parts = raw.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return undefined;
  }
  try {
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadJson);
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function credentialHasAnyType(
  credential: VpCredentialObject | undefined,
  acceptedTypes: string[],
): boolean {
  if (!credential) {
    return false;
  }
  const typeRaw =
    credential.type
    || (credential as any)?.vc?.type
    || (credential as any)?.credential?.type;
  const types = Array.isArray(typeRaw) ? typeRaw.map(String) : [String(typeRaw || '')];
  return acceptedTypes.some((type) => types.includes(type));
}

export function extractCredentialFromVpToken(
  vpToken: string | undefined,
  acceptedTypes: string[],
): VpCredentialObject | undefined {
  const payload = decodeVpTokenPayload(vpToken);
  const candidates = Array.isArray(payload?.vp?.verifiableCredential) ? payload.vp.verifiableCredential : [];
  for (const candidate of candidates) {
    const credential = decodeEmbeddedCredential(candidate);
    if (credentialHasAnyType(credential, acceptedTypes)) {
      return credential;
    }
  }
  return undefined;
}

export function normalizeTenantPublicUrl(urlOrDomain?: string): string | undefined {
  if (!urlOrDomain || typeof urlOrDomain !== 'string') {
    return undefined;
  }
  if (urlOrDomain.startsWith('https://')) {
    return urlOrDomain;
  }
  if (urlOrDomain.startsWith('http://')) {
    return urlOrDomain.replace(/^http:\/\//, 'https://');
  }
  return `https://${urlOrDomain}`;
}

export function normalizeTenantOperationalUrl(urlOrDomain?: string): string | undefined {
  return normalizeTenantPublicUrl(urlOrDomain);
}

export function getOperationalServiceBaseUrl(
  claims: ClaimsRecord,
  options?: { operationalTenantUrl?: string; publicTenantUrl?: string },
): string | undefined {
  const serviceOperationalClaim = claims['org.schema.Service.url'] as string | undefined;
  const explicitOperationalUrl = normalizeTenantOperationalUrl(
    options?.operationalTenantUrl || serviceOperationalClaim,
  );
  if (explicitOperationalUrl) {
    return explicitOperationalUrl;
  }

  const normalizedPublicUrl = normalizeTenantPublicUrl(
    options?.publicTenantUrl || claims[ClaimsOrganizationSchemaorg.url] as string | undefined,
  );
  return normalizedPublicUrl;
}

export function buildTenantAlsoKnownAs(params: {
  tenantUrn: string;
  primaryDid: string;
  externalDid?: string;
  hostedDid: string;
  publicTenantUrl?: string;
  hostedPublicUrl?: string;
}): string[] {
  const aliases = [
    params.tenantUrn,
    params.publicTenantUrl,
    params.externalDid && params.primaryDid !== params.externalDid ? params.externalDid : undefined,
    params.hostedDid && params.primaryDid !== params.hostedDid ? params.hostedDid : undefined,
    params.hostedPublicUrl && params.hostedPublicUrl !== params.publicTenantUrl ? params.hostedPublicUrl : undefined,
  ].filter((value): value is string => Boolean(value));

  return Array.from(new Set(aliases));
}

export function extractActivationParticipantMaterial(
  ...candidates: Array<any>
): ActivationParticipantMaterial | undefined {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const did = typeof candidate.did === 'string'
      ? candidate.did
      : typeof candidate.identifier === 'string'
        ? candidate.identifier
        : undefined;
    const sameAs = typeof candidate.sameAs === 'string' ? candidate.sameAs : undefined;
    const publicKeyJwk = candidate.publicKeyJwk && typeof candidate.publicKeyJwk === 'object'
      ? candidate.publicKeyJwk as PublicJwk
      : undefined;
    const jwks = Array.isArray(candidate.jwks?.keys)
      ? { keys: candidate.jwks.keys as any[] }
      : undefined;

    if (did || sameAs || publicKeyJwk || jwks) {
      return {
        ...(did ? { did } : {}),
        ...(sameAs ? { sameAs } : {}),
        ...(publicKeyJwk ? { publicKeyJwk } : {}),
        ...(jwks ? { jwks } : {}),
      };
    }
  }
  return undefined;
}

export function extractActivationMaterial(input: {
  entry: any;
  body: any;
}): ActivationMaterial {
  const entryMeta = (input.entry?.meta || {}) as Record<string, any>;
  const entryResource = (input.entry?.resource || {}) as Record<string, any>;
  const vpToken = input.body?.vp_token || entryMeta?.vp_token || entryResource?.vp_token;
  const legacyOrganizationCredential =
    input.body?.organizationCredential
    || input.body?.organization_credential
    || entryMeta?.organizationCredential
    || entryMeta?.organization_credential
    || entryResource?.organizationCredential
    || entryResource?.organization_credential;
  const legacyRepresentativeCredential =
    input.body?.representativeCredential
    || input.body?.representative_credential
    || input.body?.legalRepresentativeCredential
    || entryMeta?.representativeCredential
    || entryMeta?.representative_credential
    || entryMeta?.legalRepresentativeCredential
    || entryResource?.representativeCredential
    || entryResource?.representative_credential
    || entryResource?.legalRepresentativeCredential;
  const legacyControllerCredential =
    input.body?.controllerCredential
    || input.body?.controller_credential
    || input.body?.serviceControllerCredential
    || entryMeta?.controllerCredential
    || entryMeta?.controller_credential
    || entryMeta?.serviceControllerCredential
    || entryResource?.controllerCredential
    || entryResource?.controller_credential
    || entryResource?.serviceControllerCredential;
  const organizationCredential =
    legacyOrganizationCredential
    || extractCredentialFromVpToken(vpToken, [...ORGANIZATION_ACTIVATION_VC_TYPES]);
  const representativeCredential =
    legacyRepresentativeCredential
    || extractCredentialFromVpToken(vpToken, [...REPRESENTATIVE_ACTIVATION_VC_TYPES]);
  const controllerCredential =
    legacyControllerCredential
    || extractCredentialFromVpToken(vpToken, [...SERVICE_CONTROLLER_ACTIVATION_VC_TYPES]);
  const primaryDid =
    entryResource?.didDocument?.id
    || entryResource?.organizationDid
    || entryResource?.organization_did
    || entryMeta?.organizationDid
    || entryMeta?.organization_did
    || extractDidFromCredential(organizationCredential);

  return {
    vpToken,
    presentationSubmission:
      input.body?.presentation_submission
      || entryMeta?.presentation_submission
      || entryResource?.presentation_submission,
    organizationCredential,
    representativeCredential,
    controllerCredential,
    legacyOrganizationCredential,
    legacyRepresentativeCredential,
    legacyControllerCredential,
    primaryDid,
    publicTenantUrl:
      entryResource?.organizationUrl
      || entryResource?.organization_url
      || entryMeta?.organizationUrl
      || entryMeta?.organization_url
      || (typeof primaryDid === 'string' && primaryDid.startsWith('did:web:')
        ? getBaseUrlFromDidWeb(primaryDid)
        : undefined),
    organizationBinding: extractActivationParticipantMaterial(
      input.body?.organization,
      entryMeta?.organization,
      entryResource?.organization,
      {
        did: entryResource?.organizationDid || entryResource?.organization_did || entryMeta?.organizationDid || entryMeta?.organization_did,
        publicKeyJwk:
          entryResource?.organizationPublicKeyJwk
          || entryMeta?.organizationPublicKeyJwk
          || input.body?.organizationPublicKeyJwk,
        jwks:
          entryResource?.organizationJwks
          || entryMeta?.organizationJwks
          || input.body?.organizationJwks,
      },
    ),
    controllerBinding: extractActivationParticipantMaterial(
      input.body?.controller,
      entryMeta?.controller,
      entryResource?.controller,
      {
        did:
          entryResource?.controllerDid
          || entryResource?.controller_did
          || entryMeta?.controllerDid
          || entryMeta?.controller_did
          || input.body?.controllerDid,
        sameAs:
          entryResource?.controllerSameAs
          || entryMeta?.controllerSameAs
          || input.body?.controllerSameAs,
        publicKeyJwk:
          entryResource?.controllerPublicKeyJwk
          || entryMeta?.controllerPublicKeyJwk
          || input.body?.controllerPublicKeyJwk,
        jwks:
          entryResource?.controllerJwks
          || entryMeta?.controllerJwks
          || input.body?.controllerJwks,
      },
    ),
  };
}

export function backfillOrganizationActivationRouteDefaults(
  claims: ClaimsRecord,
  routeJurisdiction?: string,
): ClaimsRecord {
  const processedClaims = { ...claims };
  const currentCountry = String(processedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim();
  const fallbackCountry = String(routeJurisdiction || '').trim().toUpperCase();
  if (!currentCountry && fallbackCountry) {
    processedClaims[ClaimsOrganizationSchemaorg.addressCountry] = fallbackCountry;
  }
  return processedClaims;
}

export function logActivationIdentityDiagnostics(input: {
  logger?: Pick<Console, 'log'>;
  enabled: boolean;
  stage: string;
  claims: ClaimsRecord;
  routeJurisdiction?: string;
}): void {
  if (!input.enabled) return;
  (input.logger || console).log('[HostingManager] activation identity diagnostics', {
    stage: input.stage,
    routeJurisdiction: String(input.routeJurisdiction || '').trim() || undefined,
    addressCountry: input.claims[ClaimsOrganizationSchemaorg.addressCountry],
    identifierType: input.claims[ClaimsOrganizationSchemaorg.identifierType],
    identifierValue: input.claims[ClaimsOrganizationSchemaorg.identifierValue],
    alternateName: input.claims[ClaimsOrganizationSchemaorg.alternateName],
    category: input.claims[ClaimsServiceSchemaorg.category],
    serviceType: input.claims[ClaimsServiceSchemaorg.serviceType],
  });
}
