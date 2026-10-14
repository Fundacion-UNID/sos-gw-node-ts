import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IDiscoveryTenantRegistry } from '../managers/IDiscoveryTenantRegistry';
import type { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import type { DidDocument } from 'gdc-common-utils-ts/models/did';
import { getEnvSectionId } from '../utils/section-env';

export type ControllerBindingStatus = 'required' | 'credential_issued' | 'dcr_active' | 'inconsistent';

export type TenantControllerStatus = Readonly<{
  did: string;
  status: ControllerBindingStatus;
  kids: ReadonlyArray<Readonly<{
    id: string;
    kid: string;
    alg?: string;
    use?: string;
    purpose: ReadonlyArray<string>;
  }>>;
}>;

export type OrganizationTenantStatus = Readonly<{
  resourceType: 'OrganizationTenantStatus';
  tenant: Readonly<{
    id: string;
    did: string;
    lifecycleStatus: string;
    controllerBindingStatus: ControllerBindingStatus;
  }>;
  controllers: ReadonlyArray<TenantControllerStatus>;
  updatedAt?: string;
}>;

type DeviceLicenseLike = Readonly<{
  status?: string;
  activatedBy?: string;
  deviceId?: string;
  deviceBindings?: ReadonlyArray<Readonly<{ status?: string }>>;
}>;

const SAME_AS_CLAIM = 'org.schema.Person.sameAs';

/**
 * Builds the safe, authoritative lifecycle projection for one organization
 * tenant. It deliberately returns DIDs and public key identifiers only: actor
 * contacts, activation codes, tokens and private key material never cross this
 * discovery boundary.
 */
export class TenantStatusService {
  public constructor(
    private readonly tenants: IDiscoveryTenantRegistry,
    private readonly vaultRepository: IVaultRepository,
    private readonly kmsService: IKmsService,
  ) {}

  public async build(vaultId: string): Promise<OrganizationTenantStatus | undefined> {
    const tenant = await this.tenants.getTenant(vaultId);
    const tenantDid = String(tenant?.didDocument?.id || '').trim();
    if (!tenant || !tenantDid) return undefined;

    const controllerDids = this.asStrings(tenant.didDocument?.controller);
    const collectionName = await this.tenants.getCollectionName(vaultId);
    const employeeDocs = collectionName
      ? await this.safeList(collectionName, getEnvSectionId('employees'))
      : [];
    const licenseDocuments = await this.listAcrossScopes(
      vaultId,
      collectionName,
      getEnvSectionId('device-licenses'),
    );

    const employees = await Promise.all(employeeDocs.map((document) => this.safeUnprotect<EntityConfig>(document, vaultId)));
    const licenses = await Promise.all(
      licenseDocuments.map((document) => this.safeUnprotect<DeviceLicenseLike>(document, vaultId)),
    );
    const controllers = await Promise.all(controllerDids.map(async (did) => {
      const employee = employees.find((candidate) => (
        candidate?.id === did || candidate?.didDocument?.id === did
      ));
      const didDocument = employee?.didDocument;
      const actorIdentifier = String(employee?.claims?.[SAME_AS_CLAIM] || '').trim();
      const dcrActive = actorIdentifier && licenses.some((license) => {
        if (!license || license.status !== 'active' || license.activatedBy !== actorIdentifier) return false;
        return Boolean(license.deviceId)
          || Boolean(license.deviceBindings?.some((binding) => binding.status === 'active'));
      });

      return {
        did,
        status: !didDocument ? 'inconsistent' : dcrActive ? 'dcr_active' : 'credential_issued',
        kids: this.projectKids(didDocument),
      } satisfies TenantControllerStatus;
    }));

    const controllerBindingStatus: ControllerBindingStatus = controllers.length === 0
      ? 'required'
      : controllers.some((controller) => controller.status === 'dcr_active')
        ? 'dcr_active'
        : controllers.some((controller) => controller.status === 'credential_issued')
          ? 'credential_issued'
          : 'inconsistent';

    return {
      resourceType: 'OrganizationTenantStatus',
      tenant: {
        id: vaultId,
        did: tenantDid,
        lifecycleStatus: String(tenant.status || 'unknown'),
        controllerBindingStatus,
      },
      controllers,
      ...(tenant.meta?.lastUpdated ? { updatedAt: String(tenant.meta.lastUpdated) } : {}),
    };
  }

  /**
   * Resolves one public controller DID document from the authoritative tenant
   * controller list and the separately protected employee records. Historical
   * single-controller metadata remains a read-only compatibility fallback.
   */
  public async resolveControllerDidDocument(
    vaultId: string,
    memberId: string,
    role: string,
  ): Promise<DidDocument | undefined> {
    const tenant = await this.tenants.getTenant(vaultId);
    if (!tenant) return undefined;
    const suffix = `:employee:${String(memberId).trim()}:${String(role).trim()}`;
    const controllerDid = this.asStrings(tenant.didDocument?.controller)
      .find((did) => did.endsWith(suffix));
    if (!controllerDid) return undefined;

    const collectionName = await this.tenants.getCollectionName(vaultId);
    const employeeDocs = collectionName
      ? await this.safeList(collectionName, getEnvSectionId('employees'))
      : [];
    for (const document of employeeDocs) {
      const employee = await this.safeUnprotect<EntityConfig>(document, vaultId);
      if (employee?.didDocument?.id === controllerDid) return employee.didDocument;
    }

    const compatibilityDocument = tenant.meta?.controllerDidDocument as DidDocument | undefined;
    return compatibilityDocument?.id === controllerDid ? compatibilityDocument : undefined;
  }

  private projectKids(didDocument: EntityConfig['didDocument'] | undefined): TenantControllerStatus['kids'] {
    const purposeByMethod = new Map<string, string[]>();
    for (const purpose of ['authentication', 'assertionMethod', 'keyAgreement', 'capabilityInvocation', 'capabilityDelegation'] as const) {
      for (const reference of (didDocument?.[purpose] || []) as Array<string | { id?: string }>) {
        const id = typeof reference === 'string' ? reference : String(reference?.id || '');
        if (!id) continue;
        purposeByMethod.set(id, [...(purposeByMethod.get(id) || []), purpose]);
      }
    }
    return (didDocument?.verificationMethod || []).map((method) => {
      const jwk = method.publicKeyJwk as unknown as Record<string, unknown> | undefined;
      return {
        id: method.id,
        kid: String(jwk?.kid || method.id.split('#').at(-1) || method.id),
        ...(jwk?.alg ? { alg: String(jwk.alg) } : {}),
        ...(jwk?.use ? { use: String(jwk.use) } : {}),
        purpose: purposeByMethod.get(method.id) || [],
      };
    });
  }

  private asStrings(value: unknown): string[] {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return Array.from(new Set(values.map((entry) => String(entry || '').trim()).filter(Boolean)));
  }

  private async listAcrossScopes(vaultId: string, collectionName: string | undefined, sectionId: string): Promise<ConfidentialStorageDoc[]> {
    const scopes = Array.from(new Set([vaultId, collectionName].filter((value): value is string => Boolean(value))));
    const documents = (await Promise.all(scopes.map((scope) => this.safeList(scope, sectionId)))).flat();
    return Array.from(new Map(documents.map((document) => [document.id, document])).values());
  }

  private async safeList(collectionName: string, sectionId: string): Promise<ConfidentialStorageDoc[]> {
    try {
      return await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(collectionName, sectionId);
    } catch {
      return [];
    }
  }

  private async safeUnprotect<T>(document: ConfidentialStorageDoc, vaultId: string): Promise<T | undefined> {
    try {
      return await this.kmsService.unprotectConfidentialData<T>(document, vaultId);
    } catch {
      return document.content as T | undefined;
    }
  }
}
