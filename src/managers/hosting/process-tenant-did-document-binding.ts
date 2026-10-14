import { GatewayInternalResourceTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { v4 as uuidv4 } from 'uuid';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { OrganizationDidBindingEntryTypes } from 'gdc-common-utils-ts/utils/organization-did-binding';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';

type ProcessTenantDidDocumentBindingDeps = Readonly<{
  job: JobRequest;
  issuerDid: string;
  hostCollectionName?: string;
  kmsService: IKmsService;
  vaultRepository: IVaultRepository;
  tenantsCacheManager: IHostingTenantRegistry;
  normalizeBindingAliasList: (value: unknown) => string[];
}>;

/**
 * Updates the persisted tenant registration projection with external aliases
 * for the tenant DID document.
 */
export async function processTenantDidDocumentBinding(
  deps: ProcessTenantDidDocumentBindingDeps,
): Promise<IDecodedDidcommPayload> {
  const entry = (deps.job.content?.body?.data?.[0] || {}) as Record<string, any>;
  const resource = (entry.resource || {}) as Record<string, any>;
  const organization = (resource.organization || {}) as Record<string, any>;
  const aliases = deps.normalizeBindingAliasList(organization.url);
  if (!aliases.length) {
    throw new ManagerError('Organization DID binding requires at least one organization.url value.', IssueType.Required);
  }

  const tenantSector = String(deps.job.sector || '').trim() as Sector;
  const tenantRouteId = String(deps.job.tenantId || '').trim();
  const jurisdiction = String(deps.job.jurisdiction || '').trim();
  if (!tenantSector || !tenantRouteId || !jurisdiction) {
    throw new ManagerError('Tenant DID binding requires tenantId, jurisdiction, and sector in the route.', IssueType.Required);
  }

  const tenantVaultId = getTenantVaultId(tenantSector, tenantRouteId);
  const tenantConfig = await deps.tenantsCacheManager.getTenant(tenantVaultId);
  if (!tenantConfig) {
    throw new ManagerError(`Tenant not found for DID binding: '${tenantVaultId}'.`, IssueType.NotFound);
  }

  if (deps.hostCollectionName) {
    const tenantRegistrationDoc = await deps.vaultRepository.get<ConfidentialStorageDoc>(
      deps.hostCollectionName,
      tenantVaultId,
      getEnvSectionId('tenants'),
    );
    if (tenantRegistrationDoc?.content?.didDocument) {
      tenantRegistrationDoc.content.didDocument.alsoKnownAs = aliases;
      tenantRegistrationDoc.content.meta = {
        ...(tenantRegistrationDoc.content.meta || {}),
        lastUpdated: new Date().toISOString(),
      };
      const secureTenantRegistrationDoc = await deps.kmsService.protectConfidentialData(tenantRegistrationDoc, 'host');
      await deps.vaultRepository.put(deps.hostCollectionName, [secureTenantRegistrationDoc], getEnvSectionId('tenants'));
      await deps.tenantsCacheManager.refreshTenant(tenantVaultId);
    }
  }

  return {
    jti: uuidv4(),
    type: 'hosting-response',
    thid: deps.job.content?.thid as string,
    iss: deps.issuerDid,
    aud: deps.job.content?.iss as string,
    exp: Math.floor(Date.now() / 1000) + 300,
    body: {
      data: [{
        type: OrganizationDidBindingEntryTypes.Response,
        resource: {
          resourceType: GatewayInternalResourceTypes.Document,
          didDocument: {
            ...(tenantConfig.didDocument || {}),
            alsoKnownAs: aliases,
          },
        },
        response: { status: String(HttpStatusCodes.Ok) },
      }],
      resourceType: ResourceTypesFhirR4.Bundle,
      type: 'batch-response',
      total: 1,
    },
  };
}
