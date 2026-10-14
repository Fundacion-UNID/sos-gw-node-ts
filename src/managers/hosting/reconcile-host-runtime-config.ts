import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DidDocument } from 'gdc-common-utils-ts/models/did';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import type { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { OrganizationConfig } from '../../gdc-backend-utils-node/models/entity';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import type { IServerConfig } from '../../config';
import type { IHostRuntime } from '../IHostRuntime';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import { getEnvSectionId } from '../../utils/section-env';
import { initializeHostServicesConfig } from '../../utils/services';
import { composeHostDidWebId, applyLegacyX509Metadata, populateDidDocumentFromJwks } from '../../utils/did-backend';
import { populateDidDocumentServices } from '../../utils/did-document';
import { buildGaiaXLegalParticipantOptionsFromClaims, createGaiaXLegalParticipantCredential } from '../../utils/credential-generators';

type ReconcilePersistedHostRuntimeConfigDeps = Readonly<{
  config: IServerConfig;
  hostRuntime: IHostRuntime;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantsCacheManager: IHostingTenantRegistry;
}>;

/**
 * Refreshes the persisted host runtime service projection and repairs the DID
 * identifier when a previous bootstrap persisted a non-authoritative runtime
 * hostname. Key material and legal identity claims are left untouched.
 */
export async function reconcilePersistedHostRuntimeConfig(
  deps: ReconcilePersistedHostRuntimeConfigDeps,
): Promise<boolean> {
  const hostCollectionName = deps.hostRuntime.hostCollectionName;
  if (!hostCollectionName) {
    throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
  }

  const existingSecureDoc = await deps.vaultRepository.get<ConfidentialStorageDoc>(
    hostCollectionName,
    'host',
    getEnvSectionId('tenants'),
  );
  if (!existingSecureDoc) {
    return false;
  }

  const hostConfig = await deps.kmsService.unprotectConfidentialData<OrganizationConfig>(existingSecureDoc, 'host');
  if (!hostConfig?.claims) {
    throw new ManagerError('Host tenant record is invalid or missing claims.', IssueType.Exception);
  }

  const expectedDidConfigServices = initializeHostServicesConfig(
    deps.config.sectorsAllowed,
    deps.config.nodeEnv,
    deps.config.networkMode,
  );
  const didId = composeHostDidWebId(deps.config.apiBaseUrl, deps.config.hostExternalDomain);
  const previousDidId = String(hostConfig.didDocument?.id || '');
  const publicKeys = previousDidId === didId ? undefined : await deps.kmsService.getPublicJwks('host');
  const didDocument = publicKeys
    ? populateDidDocumentFromJwks({
      '@context': hostConfig.didDocument?.['@context'] || 'https://www.w3.org/ns/did/v1',
      id: didId,
      alsoKnownAs: Array.isArray(hostConfig.didDocument?.alsoKnownAs) ? hostConfig.didDocument.alsoKnownAs : [],
    }, publicKeys)
    : {
      '@context': hostConfig.didDocument?.['@context'] || 'https://www.w3.org/ns/did/v1',
      ...hostConfig.didDocument,
      id: didId,
      alsoKnownAs: Array.isArray(hostConfig.didDocument?.alsoKnownAs) ? hostConfig.didDocument?.alsoKnownAs : [],
    } as DidDocument;
  const nextDidDocumentServices = populateDidDocumentServices(
    didId,
    deps.config.apiBaseUrl,
    expectedDidConfigServices,
    false,
    {} as any,
  );
  applyLegacyX509Metadata(
    didDocument,
    deps.config.legacySignAlg,
    deps.config.legacySignAlg && deps.config.legacyX509DerBase64
      ? `${deps.config.apiBaseUrl}/host/cds-${deps.config.host.coverageScope || 'EU'}/v1/${deps.config.networkMode}/.well-known/x509.der`
      : undefined,
    deps.config.legacyX509DerBase64
      ? [deps.config.legacyX509DerBase64, ...(deps.config.legacyX509ChainBase64 || [])]
      : deps.config.legacyX509ChainBase64,
  );

  const previousDidConfigServices = JSON.stringify(hostConfig.didConfig?.service || []);
  const expectedDidConfigServicesJson = JSON.stringify(expectedDidConfigServices);
  const previousDidDocumentServices = JSON.stringify(hostConfig.didDocument?.service || []);
  const expectedDidDocumentServicesJson = JSON.stringify(nextDidDocumentServices);

  if (
    previousDidId === didId
    &&
    previousDidConfigServices === expectedDidConfigServicesJson
    && previousDidDocumentServices === expectedDidDocumentServicesJson
  ) {
    const refreshTenant = (deps.tenantsCacheManager as any)?.refreshTenant;
    if (typeof refreshTenant === 'function') {
      await refreshTenant.call(deps.tenantsCacheManager, 'host');
    }
    return false;
  }

  didDocument.service = nextDidDocumentServices;
  let governanceVc = hostConfig.governanceVc;
  let selfDescriptionVc = hostConfig.selfDescriptionVc;
  if (publicKeys) {
    const hostSignerKid = publicKeys.keys.find((key: any) => key.use === 'sig' && key.purpose === 'vc_sign')?.kid
      || publicKeys.keys.find((key: any) => key.use === 'sig')?.kid;
    if (!hostSignerKid) {
      throw new ManagerError('Host signing key not found, cannot reconcile host VCs.', IssueType.Exception);
    }
    const governancePayload = createGaiaXLegalParticipantCredential(
      buildGaiaXLegalParticipantOptionsFromClaims({
        claims: hostConfig.claims,
        webDomain: deps.config.apiBaseUrl,
        did: didId,
        issuerDid: didId,
      }),
    ) as Omit<VerifiableCredentialV2, 'proof'>;
    const buildCredential = async (payload: Omit<VerifiableCredentialV2, 'proof'>): Promise<VerifiableCredentialV2> => ({
      ...payload,
      proof: [{
        type: 'JsonWebSignature2020',
        created: new Date().toISOString(),
        proofPurpose: 'assertionMethod',
        verificationMethod: `${didId}#${hostSignerKid}`,
        jws: await deps.kmsService.createDetachedJws(payload, hostSignerKid, 'host', 'vc_sign'),
      }],
    });
    governanceVc = await buildCredential(governancePayload);
    selfDescriptionVc = await buildCredential({ ...governancePayload, issuer: didId });
  }
  const nextHostConfig: OrganizationConfig = {
    ...hostConfig,
    didConfig: {
      ...(hostConfig.didConfig || {}),
      service: expectedDidConfigServices,
    },
    didDocument,
    governanceVc,
    selfDescriptionVc,
    meta: {
      ...(hostConfig.meta || {}),
      lastUpdated: new Date().toISOString(),
    },
  };

  const nextSecureDoc: ConfidentialStorageDoc = {
    ...existingSecureDoc,
    status: nextHostConfig.status || existingSecureDoc.status,
    content: nextHostConfig,
  };
  const protectedDoc = await deps.kmsService.protectConfidentialData(nextSecureDoc, 'host');
  await deps.vaultRepository.put(hostCollectionName, [protectedDoc], getEnvSectionId('tenants'));
  if (publicKeys && governanceVc && selfDescriptionVc) {
    const wellKnownDocs: ConfidentialStorageDoc[] = [
      { id: 'legal-participant.vc.json', status: 'active', sequence: 0, content: governanceVc },
      { id: 'vc.json', status: 'active', sequence: 0, content: governanceVc },
      { id: 'self-description.json', status: 'active', sequence: 0, content: selfDescriptionVc },
    ];
    const protectedWellKnownDocs = await Promise.all(
      wellKnownDocs.map(doc => deps.kmsService.protectConfidentialData(doc, 'host')),
    );
    await deps.vaultRepository.put(hostCollectionName, protectedWellKnownDocs, getEnvSectionId('.well-known'));
  }

  const refreshTenant = (deps.tenantsCacheManager as any)?.refreshTenant;
  if (typeof refreshTenant === 'function') {
    await refreshTenant.call(deps.tenantsCacheManager, 'host');
  }
  return true;
}
