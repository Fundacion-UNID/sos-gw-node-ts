import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import type { OrganizationConfig } from '../../gdc-backend-utils-node/models/entity';
import type { IServerConfig } from '../../config';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IHostRuntime } from '../IHostRuntime';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import { composeHostDidWebId, createHostedDidWeb, populateDidDocumentFromJwks } from '../../utils/did-backend';
import { populateDidDocumentServices } from '../../utils/did-document';
import { createOrganizationUrn } from '../../utils/urn';
import { determineResourceId } from '../../utils/resource';

type EnsureAuthorityTenantDeps = Readonly<{
  alternateName: string;
  role: 'ica' | 'ca';
  externalDomain?: string;
  config: IServerConfig;
  hostRuntime: IHostRuntime;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  getCurrentUrnNetwork: () => 'test' | 'test-network' | 'network';
}>;

/**
 * Creates the technical authority tenant projection when it does not already
 * exist in the host registry.
 */
export async function ensureAuthorityTenant(
  deps: EnsureAuthorityTenantDeps,
): Promise<void> {
  const sector = Sector.SYSTEM;
  const vaultId = getTenantVaultId(sector, deps.alternateName);
  const hostCollectionName = deps.hostRuntime.hostCollectionName;
  if (!hostCollectionName) {
    throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
  }
  const hostJurisdiction = String(deps.config.host.jurisdiction || '').trim();
  if (!hostJurisdiction) {
    throw new ManagerError('Host jurisdiction is missing from server configuration.', IssueType.Required);
  }

  const existing = await deps.vaultRepository.get<ConfidentialStorageDoc>(hostCollectionName, vaultId, getEnvSectionId('tenants'));
  if (existing) {
    return;
  }

  await deps.kmsService.provisionKeys(vaultId);
  const publicKeys = await deps.kmsService.getPublicJwks(vaultId);

  const hostDid = composeHostDidWebId(deps.config.apiBaseUrl, deps.config.hostExternalDomain);
  const didId = createHostedDidWeb(hostDid, deps.alternateName, {
    jurisdiction: hostJurisdiction,
    version: 'v1',
    sector,
  });

  const didConfigServices = deps.role === 'ica'
    ? [{
        id: '#test-network:ica',
        type: 'ApiService',
        serviceEndpoint: 'csr',
        actions: ['_enroll'],
        selector: { section: 'test-network', format: 'ica', sector },
      }]
    : [];

  const didDocument = populateDidDocumentFromJwks({ '@context': 'https://www.w3.org/ns/did/v1', id: didId, alsoKnownAs: [] }, publicKeys);
  didDocument.service = populateDidDocumentServices(
    didId,
    deps.config.apiBaseUrl,
    didConfigServices,
    true,
    { alternateName: deps.alternateName, jurisdiction: hostJurisdiction, version: 'v1', sector },
  );
  if (deps.externalDomain) {
    didDocument.alsoKnownAs = didDocument.alsoKnownAs || [];
    didDocument.alsoKnownAs.push(`did:web:${deps.externalDomain}`);
  }

  const idType = deps.config.host.idType || 'TAX';
  const idValueRaw = `${deps.config.host.idValue || 'GWCORE'}-${deps.role.toUpperCase()}`;
  const idValue = idValueRaw.replace(/[^a-zA-Z0-9]/g, '');

  const claims: ClaimsRecord = {
    [ClaimsOrganizationSchemaorg.legalName]: deps.config.host.legalName || 'GW CORE Host',
    [ClaimsOrganizationSchemaorg.alternateName]: deps.alternateName,
    [ClaimsOrganizationSchemaorg.addressCountry]: hostJurisdiction,
    [ClaimsOrganizationSchemaorg.identifierType]: idType,
    [ClaimsOrganizationSchemaorg.identifierValue]: idValue,
    [ClaimsServiceSchemaorg.category]: sector,
    ...(deps.externalDomain ? { [ClaimsOrganizationSchemaorg.url]: `https://${deps.externalDomain}` } : {}),
  };

  const orgUrn = createOrganizationUrn({
    namespace: deps.config.namespace,
    network: deps.getCurrentUrnNetwork(),
    jurisdiction: claims[ClaimsOrganizationSchemaorg.addressCountry] as string,
    sector,
    idType,
    idValue,
  });
  (claims as any)[ClaimsOrganizationSchemaorg.identifier] = orgUrn;

  const authorityConfig: OrganizationConfig = {
    id: determineResourceId(orgUrn, deps.config.nodeEnv),
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    claims,
    didConfig: { service: didConfigServices },
    didDocument,
    networkStatus: [],
    legacySignAlg: deps.config.legacySignAlg,
    legacyX509DerBase64: deps.config.legacyX509DerBase64,
    legacyX509ChainBase64: deps.config.legacyX509ChainBase64,
    meta: { lastUpdated: new Date().toISOString(), role: deps.role },
  };

  const docToProtect: ConfidentialStorageDoc = {
    id: vaultId,
    status: authorityConfig.status,
    sequence: 0,
    content: authorityConfig,
  };
  const secureDoc = await deps.kmsService.protectConfidentialData(docToProtect, 'host');
  await deps.vaultRepository.put(hostCollectionName, [secureDoc], getEnvSectionId('tenants'));
}
