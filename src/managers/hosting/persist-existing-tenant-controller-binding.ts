import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { populateDidDocumentFromJwks } from '../../utils/did-backend';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId } from '../../utils/tenant';
import type { registerControllerKeysOnLedger as registerControllerKeysOnLedgerFunction } from '../../utils/ledger-device-registration';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import { EntityLifecycleStatus, EntityType } from '../../gdc-backend-utils-node/models/enums';
import type { EntityConfig } from '../../gdc-backend-utils-node/models/entity';
import { mergeActivationJwks } from './registration-keys';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import type { ActivationParticipantMaterialLike } from './controller-entity-config';
import {
  extractServiceControllerOccupationCodes,
  extractServiceControllerRoleCodes,
} from 'gdc-common-utils-ts/utils/activation-policy';

type PersistExistingTenantControllerBindingDeps = Readonly<{
  claims: ClaimsRecord;
  controller?: ActivationParticipantMaterialLike;
  controllerCredential?: Record<string, unknown>;
  verifiedSignerKid?: string;
  transactionId?: string;
  hostCollectionName?: string;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
  tenantsCacheManager: IHostingTenantRegistry;
  registerControllerKeysOnLedger?: typeof registerControllerKeysOnLedgerFunction;
}>;

const PRIVATE_JWK_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;
const PERSON_SAME_AS_CLAIM = 'org.schema.Person.sameAs';

/**
 * Adds an ICA-approved controller employee to an already provisioned tenant.
 * The signed `_issue` request must prove possession of one submitted key. The
 * organization DID keeps references to every controller DID; each controller
 * DID document is persisted as an ordinary employee record, not copied into
 * tenant metadata.
 */
export async function persistExistingTenantControllerBinding(
  deps: PersistExistingTenantControllerBindingDeps,
): Promise<void> {
  if (!deps.controller?.publicKeyJwk && !deps.controller?.jwks?.keys?.length) return;
  const controllerDid = String(deps.controller?.did || '').trim();
  const controllerSameAs = String(deps.controller?.sameAs || '').trim();
  const actorIdentifier = normalizeSameAsHash(controllerSameAs);
  const controllerRoles = extractServiceControllerRoleCodes(deps.controllerCredential);
  const controllerOccupations = extractServiceControllerOccupationCodes(deps.controllerCredential);
  const controllerRole = controllerRoles.find((role) => role === 'RESPRSN');
  const submittedKeysWithCallerKids = mergeActivationJwks(
    [deps.controller?.publicKeyJwk],
    deps.controller?.jwks,
  ).keys as PublicJwk[];

  if (!controllerDid.startsWith('did:web:')) {
    throw new ManagerError('Existing-tenant controller binding requires a stable did:web identifier.', IssueType.Value);
  }
  if (!/^urn:multibase:z[^:]+$/.test(actorIdentifier)) {
    throw new ManagerError('Existing-tenant controller binding requires its stable actor identifier.', IssueType.Required);
  }
  if (!deps.controllerCredential) {
    throw new ManagerError('Existing-tenant controller binding requires an ICA-issued ServiceControllerCredential.', IssueType.Required);
  }
  if (controllerRole !== 'RESPRSN') {
    throw new ManagerError('ServiceControllerCredential requires RESPRSN in credentialSubject.owner.additionalType.', IssueType.Required);
  }
  if (submittedKeysWithCallerKids.length < 1) {
    throw new ManagerError('Existing-tenant controller binding requires at least one public JWK.', IssueType.Required);
  }
  for (const key of submittedKeysWithCallerKids) {
    if (PRIVATE_JWK_MEMBERS.some((member) => member in (key as any))) {
      throw new ManagerError('Controller JWKS must contain public keys only.', IssueType.Value);
    }
  }

  const signerKid = String(deps.verifiedSignerKid || '').trim();
  const submittedKeys = Array.from(new Map(submittedKeysWithCallerKids.map((key) => {
    const canonicalKid = toJwkThumbprintSha256Urn(key as any);
    return [canonicalKid, { ...key, kid: canonicalKid } as PublicJwk];
  })).values());
  const controllerSubject = (deps.controllerCredential.credentialSubject || {}) as Record<string, any>;
  const credentialOwner = (controllerSubject.owner || {}) as Record<string, any>;
  if (normalizeSameAsHash(String(credentialOwner.sameAs || '')) !== actorIdentifier) {
    throw new ManagerError('Controller actor identifier does not match the ICA-issued controller credential.', IssueType.Conflict);
  }
  const credentialMaterial = String(credentialOwner.hasCredential?.material || '').trim();
  if (!submittedKeys.some((key) => key.kid === credentialMaterial)) {
    throw new ManagerError('Controller JWK does not match the ICA-issued controller credential binding.', IssueType.Conflict);
  }

  const alternateName = String(deps.claims[ClaimsOrganizationSchemaorg.alternateName] || '').trim();
  const sector = String(deps.claims[ClaimsServiceSchemaorg.category] || '').trim() as Sector;
  if (!alternateName || !sector) {
    throw new ManagerError('Controller binding requires tenant alternateName and Service.category.', IssueType.Required);
  }
  if (!deps.hostCollectionName) {
    throw new ManagerError('Host collection not found in cache.', IssueType.NotFound);
  }

  const tenantVaultId = getTenantVaultId(sector, alternateName);
  const tenantConfig = await deps.tenantsCacheManager.getTenant(tenantVaultId);
  if (!tenantConfig) {
    throw new ManagerError(`Tenant not found for controller binding: '${tenantVaultId}'.`, IssueType.NotFound);
  }
  const tenantRegistrationDoc = await deps.vaultRepository.get<ConfidentialStorageDoc>(
    deps.hostCollectionName,
    tenantVaultId,
    getEnvSectionId('tenants'),
  );
  if (!tenantRegistrationDoc?.content) {
    throw new ManagerError(`Tenant registry document not found for '${tenantVaultId}'.`, IssueType.NotFound);
  }
  const tenantCollectionName = await deps.tenantsCacheManager.getCollectionName(tenantVaultId);
  if (!tenantCollectionName) {
    throw new ManagerError(`Tenant collection not found for controller binding: '${tenantVaultId}'.`, IssueType.NotFound);
  }

  const currentControllers = (Array.isArray(tenantConfig.didDocument?.controller)
    ? tenantConfig.didDocument.controller
    : tenantConfig.didDocument?.controller
      ? [tenantConfig.didDocument.controller]
      : []) as string[];
  if (!signerKid) {
    throw new ManagerError('Controller changes require a verified request signer.', IssueType.Forbidden);
  }
  if (currentControllers.length === 0) {
    if (!submittedKeysWithCallerKids.some((key) => key.kid === signerKid)) {
      throw new ManagerError('The bootstrap signer must belong to the submitted controller JWKS.', IssueType.Forbidden);
    }
  } else {
    const [protectedSignerKid] = await deps.kmsService.protectAttributesNameAndValue([
      { name: 'kid', value: signerKid, unique: false, type: 'string' },
    ], tenantVaultId);
    const signerRecords = await deps.vaultRepository.query(tenantCollectionName, {
      sectionId: getEnvSectionId('employees'),
      where: [{ name: protectedSignerKid.name, value: protectedSignerKid.value }],
    });
    let authorized = false;
    for (const record of signerRecords || []) {
      try {
        const employee = await deps.kmsService.unprotectConfidentialData<EntityConfig>(record, tenantVaultId);
        if (employee.status === EntityLifecycleStatus.Active && currentControllers.includes(String(employee.didDocument?.id || ''))) {
          authorized = true;
          break;
        }
      } catch {
        // Ignore inaccessible records; they cannot authorize a controller change.
      }
    }
    if (!authorized) {
      throw new ManagerError('Controller changes must be signed by an active existing controller.', IssueType.Forbidden);
    }
  }

  const controllerDidDocument = populateDidDocumentFromJwks({
    '@context': 'https://www.w3.org/ns/did/v1',
    id: controllerDid,
    service: [],
  }, { keys: submittedKeys as any[] });
  const now = new Date().toISOString();
  const controllers = Array.from(new Set([...currentControllers, controllerDid]));
  const { controllerDidDocument: _legacyControllerDidDocument, ...tenantMeta } = tenantConfig.meta || {};
  const updatedConfig = {
    ...tenantConfig,
    didDocument: {
      ...(tenantConfig.didDocument || {}),
      controller: controllers,
    },
    meta: {
      ...tenantMeta,
      lastUpdated: now,
    },
  };
  const updatedDoc = {
    ...tenantRegistrationDoc,
    status: updatedConfig.status,
    content: updatedConfig,
  };
  await deps.registerControllerKeysOnLedger?.({
    jurisdiction: String(deps.claims[ClaimsOrganizationSchemaorg.addressCountry] || '').trim() || undefined,
    organizationClaims: deps.claims,
    controllerDid,
    actorIdentifier,
    verificationMethods: controllerDidDocument.verificationMethod || [],
    transactionId: deps.transactionId,
  });
  const credentialMaterials = submittedKeys.map((key) => String(key.kid));
  const controllerEmployee: EntityConfig = {
    id: controllerDid,
    type: EntityType.Person,
    status: EntityLifecycleStatus.Active,
    claims: {
      [ClaimsPersonSchemaorg.identifier]: controllerDid,
      [PERSON_SAME_AS_CLAIM]: actorIdentifier,
      [ClaimsPersonSchemaorg.additionalType]: controllerRole,
      [ClaimsPersonSchemaorg.hasOccupationalCategory]: controllerOccupations,
      [ClaimsPersonSchemaorg.hasCredentialMaterial]: credentialMaterials[0],
    },
    didDocument: controllerDidDocument,
    didConfig: { service: [] },
    meta: { lastUpdated: now },
  };
  const employeeAttributes = await deps.kmsService.protectAttributesNameAndValue([
    { name: ClaimsPersonSchemaorg.identifier, value: controllerDid, unique: true, type: 'uri' },
    { name: PERSON_SAME_AS_CLAIM, value: actorIdentifier, unique: false, type: 'uri' },
    { name: ClaimsPersonSchemaorg.additionalType, value: controllerRole, unique: false, type: 'string' },
    ...controllerOccupations.map((occupation) => ({
      name: ClaimsPersonSchemaorg.hasOccupationalCategory,
      value: occupation,
      unique: false,
      type: 'string',
    })),
    ...credentialMaterials.flatMap((material) => [
      { name: ClaimsPersonSchemaorg.hasCredentialMaterial, value: material, unique: false, type: 'string' },
      // Transitional lookup compatibility for signed-request resolution.
      { name: 'kid', value: material, unique: false, type: 'string' },
    ]),
  ], tenantVaultId);
  const employeeDoc: ConfidentialStorageDoc = {
    id: controllerDid,
    status: EntityLifecycleStatus.Active,
    sequence: 0,
    content: controllerEmployee,
    indexed: { attributes: employeeAttributes },
  };
  const secureEmployeeDoc = await deps.kmsService.protectConfidentialData(employeeDoc, tenantVaultId);
  await deps.vaultRepository.put(tenantCollectionName, [secureEmployeeDoc], getEnvSectionId('employees'));
  const secureDoc = await deps.kmsService.protectConfidentialData(updatedDoc, 'host');
  await deps.vaultRepository.put(deps.hostCollectionName, [secureDoc], getEnvSectionId('tenants'));
  await deps.tenantsCacheManager.refreshTenant(tenantVaultId);
}
