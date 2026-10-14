import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { DidDocument } from 'gdc-common-utils-ts/models/did';
import type { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { EntityLifecycleStatus, EntityType, NetworkAccessStatus, NetworkName } from '../../gdc-backend-utils-node/models/enums';
import type { OrganizationConfig } from '../../gdc-backend-utils-node/models/entity';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { applyLegacyX509Metadata, composeHostDidWebId, createHostedDidWeb, populateDidDocumentFromJwks } from '../../utils/did-backend';
import { populateDidDocumentServices } from '../../utils/did-document';
import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../../utils/services';
import { buildGaiaXLegalParticipantOptionsFromClaims, createGaiaXLegalParticipantCredential } from '../../utils/credential-generators';
import { createOrganizationUrn } from '../../utils/urn';
import { applyTenantAuthorizationStatus } from '../../utils/tenant-lifecycle';
import { resolveOrganizationRouteJurisdiction } from '../../utils/tenant';

type FinalizeTenantConfigDeps = Readonly<{
  org: IncludedResource;
  altName: string;
  allClaims: ClaimsRecord;
  sector: Sector;
  vaultId: string;
  options?: {
    primaryDid?: string;
    publicTenantUrl?: string;
    operationalTenantUrl?: string;
    governanceVc?: VerifiableCredentialV2;
    networkName?: NetworkName;
    controllerDid?: string;
    controllerDidDocument?: DidDocument;
  };
  config: any;
  kmsService: any;
  buildTenantAlsoKnownAs: (params: {
    tenantUrn: string;
    primaryDid: string;
    externalDid?: string;
    hostedDid: string;
    publicTenantUrl?: string;
    hostedPublicUrl?: string;
  }) => string[];
  getCurrentUrnNetwork: () => string;
  getOperationalServiceBaseUrl: (claims: ClaimsRecord, options?: { operationalTenantUrl?: string; publicTenantUrl?: string }) => string | undefined;
  isDemoSecurityMode: () => boolean;
  logger: any;
  serviceAdditionalTypeClaim: string;
}>;

export async function finalizeTenantConfig(
  deps: FinalizeTenantConfigDeps,
): Promise<OrganizationConfig> {
  const routeJurisdiction = resolveOrganizationRouteJurisdiction(deps.allClaims);
  const publicKeys = await deps.kmsService.getPublicJwks(deps.vaultId);

  const orgClaims: ClaimsRecord = {};
  const serviceClaims: ClaimsRecord = {};
  for (const key in deps.allClaims) {
    if (key.startsWith('org.schema.Service')) {
      serviceClaims[key] = deps.allClaims[key];
    } else if (key.startsWith('org.schema.Organization') || key.startsWith('org.schema.Person')) {
      orgClaims[key] = deps.allClaims[key];
    }
  }
  orgClaims[ClaimsServiceSchemaorg.category] = deps.allClaims[ClaimsServiceSchemaorg.category];

  const tenantUrn = createOrganizationUrn({
    namespace: deps.config.namespace,
    network: deps.getCurrentUrnNetwork(),
    jurisdiction: routeJurisdiction,
    sector: deps.sector,
    idType: deps.allClaims[ClaimsOrganizationSchemaorg.identifierType] as string,
    idValue: deps.allClaims[ClaimsOrganizationSchemaorg.identifierValue] as string,
  });
  const hostDid = composeHostDidWebId(deps.config.apiBaseUrl, deps.config.hostExternalDomain);
  const context = { jurisdiction: routeJurisdiction, version: 'v1', sector: deps.sector };
  const hostedDid = createHostedDidWeb(hostDid, deps.altName, context);
  const publicTenantUrl = deps.options?.publicTenantUrl || deps.allClaims[ClaimsOrganizationSchemaorg.url] as string | undefined;
  const operationalTenantUrl = deps.getOperationalServiceBaseUrl(deps.allClaims, deps.options);
  const externalDid = deps.options?.primaryDid
    || (publicTenantUrl && publicTenantUrl.startsWith('https://') ? `did:web:${new URL(publicTenantUrl).hostname}` : undefined);
  const primaryDid = externalDid || hostedDid;
  const hostedPublicUrl = `${deps.config.apiBaseUrl}/${deps.altName}/cds-${routeJurisdiction.toLowerCase()}/v1/${deps.sector}`;
  const isHosted = !publicTenantUrl?.startsWith('https://')
    || (!!operationalTenantUrl && !!publicTenantUrl && new URL(operationalTenantUrl).host !== new URL(publicTenantUrl).host);
  const alsoKnownAs = deps.buildTenantAlsoKnownAs({
    tenantUrn,
    primaryDid,
    externalDid,
    hostedDid,
    publicTenantUrl,
    hostedPublicUrl: isHosted ? hostedPublicUrl : undefined,
  });
  const skeletonDidDoc: DidDocument = {
    '@context': 'https://www.w3.org/ns/did/v1',
    id: primaryDid,
    alsoKnownAs,
    ...(deps.options?.controllerDid ? { controller: deps.options.controllerDid } : {}),
  };
  const didConfigServices = initializeTenantServicesConfig(
    deps.sector,
    [],
    deps.allClaims[ClaimsServiceSchemaorg.serviceType] as string | undefined,
    deps.allClaims[deps.serviceAdditionalTypeClaim] as string | undefined,
  );
  const publicBaseUrl = isHosted ? deps.config.apiBaseUrl : (publicTenantUrl || deps.config.apiBaseUrl);
  const serviceBaseUrl = operationalTenantUrl || publicBaseUrl;
  const didDocument = populateDidDocumentFromJwks(skeletonDidDoc, publicKeys);
  const tenantContext = {
    alternateName: deps.altName,
    jurisdiction: routeJurisdiction,
    version: 'v1',
    sector: deps.sector,
  };
  didDocument.service = populateDidDocumentServices(primaryDid, publicBaseUrl, didConfigServices, isHosted, tenantContext, serviceBaseUrl);
  const legacySignAlg = deps.config.legacySignAlg;
  const legacyX5u = legacySignAlg && deps.config.legacyX509DerBase64 ? `${publicBaseUrl}/.well-known/x509.der` : undefined;
  const legacyChain = deps.config.legacyX509DerBase64
    ? [deps.config.legacyX509DerBase64, ...(deps.config.legacyX509ChainBase64 || [])]
    : deps.config.legacyX509ChainBase64;
  applyLegacyX509Metadata(didDocument, legacySignAlg, legacyX5u, legacyChain);

  const hostJwks = await deps.kmsService.getPublicJwks('host');
  const hostSignerKid = hostJwks.keys.find((k: any) => k.use === 'sig' && k.purpose === 'vc_sign')?.kid
    || hostJwks.keys.find((k: any) => k.use === 'sig')?.kid;
  if (!hostSignerKid) {
    throw new ManagerError('Host signing key not found, cannot issue provisional VC.', IssueType.Exception);
  }
  const legalParticipantOptions = buildGaiaXLegalParticipantOptionsForTenant({
    claims: deps.allClaims,
    webDomain: publicBaseUrl,
    did: primaryDid,
    issuerDid: hostDid,
    alternateName: deps.altName,
    sector: deps.sector,
    isDemoSecurityMode: deps.isDemoSecurityMode,
    logger: deps.logger,
    hostJurisdiction: deps.config.host.jurisdiction,
  });
  let governanceVc: VerifiableCredentialV2;
  if (deps.options?.governanceVc) {
    governanceVc = deps.options.governanceVc;
  } else {
    const governanceVcPayload = createGaiaXLegalParticipantCredential(legalParticipantOptions) as Omit<VerifiableCredentialV2, 'proof'>;
    const govDetachedJws = await deps.kmsService.createDetachedJws(governanceVcPayload, hostSignerKid, 'host', 'vc_sign');
    governanceVc = {
      ...governanceVcPayload,
      proof: [{
        type: 'JsonWebSignature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${hostDid}#${hostSignerKid}`,
        jws: govDetachedJws,
      }],
    };
  }

  const tenantSignerKid = publicKeys.keys.find((k: any) => k.use === 'sig')?.kid;
  if (!tenantSignerKid) {
    throw new ManagerError('Tenant signing key not found, cannot issue self-description.', IssueType.Exception);
  }
  const selfDescriptionOptions = buildGaiaXLegalParticipantOptionsForTenant({
    claims: deps.allClaims,
    webDomain: publicBaseUrl,
    did: primaryDid,
    issuerDid: primaryDid,
    alternateName: deps.altName,
    sector: deps.sector,
    isDemoSecurityMode: deps.isDemoSecurityMode,
    logger: deps.logger,
    hostJurisdiction: deps.config.host.jurisdiction,
  });
  const selfDescriptionPayload = createGaiaXLegalParticipantCredential(selfDescriptionOptions) as Omit<VerifiableCredentialV2, 'proof'>;
  const selfDescDetachedJws = await deps.kmsService.createDetachedJws(selfDescriptionPayload, tenantSignerKid, deps.vaultId, 'vc_sign');
  const selfDescriptionVc: VerifiableCredentialV2 = {
    ...selfDescriptionPayload,
    proof: [{
      type: 'JsonWebSignature2020',
      created: new Date().toISOString(),
      proofPurpose: 'assertionMethod',
      verificationMethod: `${primaryDid}#${tenantSignerKid}`,
      jws: selfDescDetachedJws,
    }],
  };

  const tenantConfig: OrganizationConfig = {
    id: deps.org.id,
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    networkStatus: [{
      networkName: deps.options?.networkName || NetworkName.Test,
      status: NetworkAccessStatus.Active,
      activationDate: new Date().toISOString(),
    }],
    claims: orgClaims,
    provider: { service: serviceClaims },
    didConfig: { service: didConfigServices },
    didDocument,
    governanceVc,
    selfDescriptionVc,
    legacySignAlg,
    legacyX509DerBase64: deps.config.legacyX509DerBase64,
    legacyX509ChainBase64: deps.config.legacyX509ChainBase64,
    meta: {
      lastUpdated: new Date().toISOString(),
      ...(deps.options?.controllerDidDocument
        ? { controllerDidDocument: deps.options.controllerDidDocument }
        : {}),
    },
  };

  return applyTenantAuthorizationStatus(tenantConfig, 'active');
}

export function buildGaiaXLegalParticipantOptionsForTenant(input: {
  claims: ClaimsRecord;
  webDomain: string;
  did: string;
  issuerDid: string;
  alternateName: string;
  sector: Sector;
  isDemoSecurityMode: () => boolean;
  logger: any;
  hostJurisdiction?: string;
}) {
  const { claims, webDomain, did, issuerDid, alternateName, sector } = input;
  const enrichedClaims: ClaimsRecord = { ...claims };

  if (input.isDemoSecurityMode()) {
    const fallbackName = String(
      enrichedClaims[ClaimsOrganizationSchemaorg.legalName]
      || enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue]
      || alternateName
      || '',
    ).trim();
    if (fallbackName && !String(enrichedClaims[ClaimsOrganizationSchemaorg.legalName] || '').trim()) {
      enrichedClaims[ClaimsOrganizationSchemaorg.legalName] = fallbackName;
    }
    const fallbackCountry = String(
      enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry]
      || input.hostJurisdiction
      || 'ES',
    ).trim();
    if (fallbackCountry && !String(enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim()) {
      enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry] = fallbackCountry;
    }
    const fallbackVat = String(
      enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue]
      || alternateName
      || '',
    ).trim();
    if (fallbackVat && !String(enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue] || '').trim()) {
      enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue] = fallbackVat;
    }
    if (!String(enrichedClaims[ClaimsServiceSchemaorg.termsOfService] || '').trim()) {
      enrichedClaims[ClaimsServiceSchemaorg.termsOfService] = 'https://example.org/terms';
    }
    input.logger?.warn?.('[HostingManager] demo Gaia-X fallback', {
      alternateName,
      sector,
      legalName: enrichedClaims[ClaimsOrganizationSchemaorg.legalName],
      identifierValue: enrichedClaims[ClaimsOrganizationSchemaorg.identifierValue],
      addressCountry: enrichedClaims[ClaimsOrganizationSchemaorg.addressCountry],
      termsOfService: enrichedClaims[ClaimsServiceSchemaorg.termsOfService],
    });
  }

  try {
    return buildGaiaXLegalParticipantOptionsFromClaims({
      claims: enrichedClaims,
      webDomain,
      did,
      issuerDid,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagerError(
      `Missing required claims to build Gaia-X Legal Participant credential for '${alternateName}': ${message}`,
      IssueType.Required,
    );
  }
}
