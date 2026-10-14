import { getConfig } from '../src/config/server-config.js';
import { buildInfrastructure } from '../src/bootstrap/build-infrastructure.js';
import { generateTenantCollectionNameFromClaims } from '../src/utils/tenant.js';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { VaultWrappedKeyRepository, type WrappedKeyPurpose } from '../src/services/wrapped-key-repository.js';

const PURPOSES: WrappedKeyPurpose[] = ['comm_sig', 'vc_sign', 'encryption', 'storage', 'hmac'];

type EntityAudit = {
  entityVaultId: string;
  did?: string;
  encryptionKid?: string;
  missingPurposes: WrappedKeyPurpose[];
  hasDidDocumentEncryptionKey: boolean;
  dataAtRisk: boolean;
  searchAtRisk: boolean;
};

async function main(): Promise<void> {
  const config = getConfig();
  const hostBootstrapClaims = {
    [ClaimsOrganizationSchemaorg.addressCountry]: config.host.jurisdiction,
    [ClaimsOrganizationSchemaorg.identifierType]: config.host.idType,
    [ClaimsOrganizationSchemaorg.identifierValue]: config.host.idValue,
    [ClaimsServiceSchemaorg.category]: Sector.SYSTEM,
  };
  const hostCollectionName = generateTenantCollectionNameFromClaims(hostBootstrapClaims);

  const { vaultRepository, tenantManager } = await buildInfrastructure({ config, hostCollectionName });
  const wrappedKeyRepository = new VaultWrappedKeyRepository(vaultRepository, hostCollectionName);
  const tenants = await tenantManager.listRegisteredTenants();

  const auditRows: EntityAudit[] = [];
  auditRows.push(await auditEntity('host', wrappedKeyRepository, await tenantManager.getTenant('host')));

  for (const tenant of tenants) {
    const vaultId = String(tenant?.id || '').trim();
    if (!vaultId) continue;
    auditRows.push(await auditEntity(vaultId, wrappedKeyRepository, tenant));
  }

  const summary = {
    totalEntities: auditRows.length,
    entitiesMissingWrappedKeys: auditRows.filter((row) => row.missingPurposes.length > 0).length,
    entitiesWithDataAtRisk: auditRows.filter((row) => row.dataAtRisk).length,
    entitiesWithSearchAtRisk: auditRows.filter((row) => row.searchAtRisk).length,
    entitiesRecoverableForAsyncEncryptionOnly: auditRows.filter(
      (row) =>
        row.missingPurposes.includes('encryption')
        && row.hasDidDocumentEncryptionKey
        && !row.missingPurposes.includes('storage')
        && !row.missingPurposes.includes('hmac'),
    ).length,
  };

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ summary, entities: auditRows }, null, 2));
    return;
  }

  console.log('[kms-audit] Summary');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[kms-audit] Entities with missing wrapped keys');
  for (const row of auditRows.filter((item) => item.missingPurposes.length > 0)) {
    console.log(JSON.stringify(row));
  }

  if (process.argv.includes('--fail-on-missing') && summary.entitiesMissingWrappedKeys > 0) {
    process.exitCode = 2;
  }
}

async function auditEntity(
  entityVaultId: string,
  wrappedKeyRepository: VaultWrappedKeyRepository,
  tenantConfig: any,
): Promise<EntityAudit> {
  const missingPurposes: WrappedKeyPurpose[] = [];
  for (const purpose of PURPOSES) {
    const found = await wrappedKeyRepository.get(entityVaultId, purpose);
    if (!found) {
      missingPurposes.push(purpose);
    }
  }

  const didDocument = tenantConfig?.didDocument;
  const encryptionKid = resolveEncryptionKid(didDocument);
  return {
    entityVaultId,
    did: typeof didDocument?.id === 'string' ? didDocument.id : undefined,
    encryptionKid: encryptionKid || undefined,
    missingPurposes,
    hasDidDocumentEncryptionKey: Boolean(encryptionKid),
    dataAtRisk: missingPurposes.includes('storage'),
    searchAtRisk: missingPurposes.includes('hmac'),
  };
}

function resolveEncryptionKid(didDocument: any): string | undefined {
  if (!didDocument || typeof didDocument !== 'object') return undefined;
  const keyAgreementIds = new Set<string>();
  for (const entry of Array.isArray(didDocument.keyAgreement) ? didDocument.keyAgreement : []) {
    if (typeof entry === 'string') keyAgreementIds.add(entry);
    else if (entry && typeof entry === 'object' && typeof entry.id === 'string') keyAgreementIds.add(entry.id);
  }

  const verificationMethods = Array.isArray(didDocument.verificationMethod) ? didDocument.verificationMethod : [];
  for (const method of verificationMethods) {
    const jwk = method?.publicKeyJwk;
    if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'ML-KEM-768') continue;
    if (keyAgreementIds.size > 0 && !keyAgreementIds.has(String(method.id || ''))) continue;
    return String(jwk.kid || method.id || '');
  }

  return undefined;
}

main().catch((error) => {
  console.error('[kms-audit] Failed:', error);
  process.exitCode = 1;
});
