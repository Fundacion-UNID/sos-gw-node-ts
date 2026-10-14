import { DeviceBindingStatuses, DeviceUserClasses } from 'gdc-common-utils-ts/constants/device';
import {
  getHealthcareRoleByClaim,
  HealthcareActorRoleCodes,
  HealthcareActorRoles,
} from 'gdc-common-utils-ts/constants/healthcare';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { parseActorFromSub } from 'gdc-common-utils-ts/utils/actor';
import {
  FhirIpsCreatorKinds,
  normalizeClinicalCreatorBinding,
  type ClinicalCreatorBinding,
} from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { normalizeUuid } from 'gdc-common-utils-ts/utils/normalize-uuid';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { getEnvSectionId } from '../../utils/section-env';
import { normalizeIndexedEmail, normalizeIndexedPhone } from '../../utils/indexed-contact';
import { getTenantVaultId } from '../../utils/tenant';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { IJobProcessor } from '../../managers/registry';
import type { ITenantsManager } from '../../managers/ITenantsManager';
import type { IClearingHouseService } from '../../services/ClearingHouseService';
import { OpenIdAuthManager } from '../../managers/OpenIdAuthManager';
import type { SoschainBreakGlassAuthorizer } from '../soschain/break-glass';

type DeviceProfile = Readonly<Record<string, unknown> & {
  actorDid?: string;
  profileDid?: string;
  status?: string;
  authenticatedEmail?: string;
  authenticatedTelephone?: string;
  authenticatedSubject?: string;
  authorizedSubjectDid?: string;
  licenseId?: string;
}>;

type RepresentedControllerAuthorization = Readonly<{
  profile: DeviceProfile;
  license: DeviceLicense & Record<string, unknown>;
}>;

const UHC_RELATED_PERSON_ACTOR_SEGMENT = 'family';

/**
 * Narrows one registered controller device to the selected subject without
 * changing the immutable actor used by DIDComm and the SMART bearer.
 */
export function projectUhcRepresentedControllerDeviceProfile(
  profile: DeviceProfile,
  subjectDid: string,
): DeviceProfile {
  return { ...profile, authorizedSubjectDid: subjectDid };
}

/**
 * Resolves a request-scoped DCR projection for a represented UHC subject.
 *
 * One controller wallet/device can manage several individual organizations,
 * but every subject remains protected by its own active GW-issued RESPRSN
 * seat. The projection is never persisted and is derived exclusively from the
 * registered device plus target-specific server records.
 */
export async function resolveUhcControllerSubjectDeviceProfile(input: Readonly<{
  repository: IVaultRepository;
  kmsService: IKmsService;
  tenantVaultId: string;
  clientId: string;
  actorDid: string;
  subjectDid: string;
}>): Promise<DeviceProfile | undefined> {
  return (await resolveUhcControllerSubjectAuthorization(input))?.profile;
}

async function resolveUhcControllerSubjectAuthorization(input: Readonly<{
  repository: IVaultRepository;
  kmsService: IKmsService;
  tenantVaultId: string;
  clientId: string;
  actorDid: string;
  subjectDid: string;
}>): Promise<RepresentedControllerAuthorization | undefined> {
  const document = await input.repository.get<any>(
    input.tenantVaultId,
    input.clientId,
    getEnvSectionId('device-profiles'),
  );
  if (!document) return undefined;
  const profile = await unprotect<DeviceProfile>(document, input.kmsService, input.tenantVaultId);
  if (String(profile.status || DeviceBindingStatuses.Active) !== DeviceBindingStatuses.Active
    || String(profile.actorDid || '') !== input.actorDid
    || String(profile.profileDid || '') !== input.actorDid
    || !String(profile.authenticatedSubject || '').trim()) {
    console.warn('[UHC OpenID] represented-subject projection rejected registered-device invariants.', {
      active: String(profile.status || DeviceBindingStatuses.Active) === DeviceBindingStatuses.Active,
      actorMatches: String(profile.actorDid || '') === input.actorDid,
      profileMatches: String(profile.profileDid || '') === input.actorDid,
      hasAuthenticatedSubject: Boolean(String(profile.authenticatedSubject || '').trim()),
    });
    return undefined;
  }
  if (profile.authorizedSubjectDid === input.subjectDid) return undefined;

  const email = normalizeIndexedEmail(profile.authenticatedEmail);
  const phone = normalizeIndexedPhone(profile.authenticatedTelephone);
  if (!email && !phone) {
    console.warn('[UHC OpenID] represented-subject projection has no verified device contact.');
    return undefined;
  }
  const documents = await input.repository.getContainersInSection<any>(
    input.tenantVaultId,
    getEnvSectionId('device-licenses'),
  );
  for (const candidate of documents || []) {
    let license = candidate?.content as DeviceLicense & Record<string, unknown> | undefined;
    try {
      if (!license || typeof license !== 'object' || !String(license.id || '').trim()) {
        license = await unprotect<DeviceLicense & Record<string, unknown>>(
          candidate,
          input.kmsService,
          input.tenantVaultId,
        );
      }
    } catch {
      continue;
    }
    if (!license) continue;
    const role = String(license.issuedToRole || '').trim().split('|').at(-1);
    const sameContact = (email && normalizeIndexedEmail(license.issuedToEmail) === email)
      || (phone && normalizeIndexedPhone(license.issuedToPhone) === phone);
    if ((license.status !== 'active' && license.status !== 'issued')
      || license.userClass !== DeviceUserClasses.Individual
      || role !== HealthcareActorRoleCodes.Controller
      || license.authorizedSubjectDid !== input.subjectDid
      || !sameContact) continue;
    return {
      profile: {
        ...profile,
        authorizedSubjectDid: input.subjectDid,
        licenseId: String(license.id || candidate.id || '').trim(),
      },
      license,
    };
  }
  console.warn('[UHC OpenID] no target-specific controller seat matched the registered device.', {
    licenseCount: documents?.length || 0,
    hasVerifiedEmail: Boolean(email),
    hasVerifiedPhone: Boolean(phone),
  });
  return undefined;
}

/**
 * Builds one subject-specific operational DID for a represented controller.
 * The public subject, stable person UUID and RelatedPerson UUID remain separate;
 * no email, telephone or browser-supplied identifier enters the DID.
 */
export function buildUhcRepresentedControllerActorDid(input: Readonly<{
  registeredActorDid: string;
  assignmentIdentifier: string;
}>): string {
  const root = parseActorFromSub(input.registeredActorDid).organization;
  const assignmentUuid = normalizeUuid(input.assignmentIdentifier);
  const role = getHealthcareRoleByClaim(HealthcareActorRoles.Controller)?.claim;
  if (!root || !assignmentUuid || !role) {
    throw new TypeError('Represented UHC controller requires a did:web actor and canonical RelatedPerson assignment.');
  }
  return `${root}:${UHC_RELATED_PERSON_ACTOR_SEGMENT}:${assignmentUuid}:${role}`;
}

/**
 * Derives a target-specific creator binding exclusively from the registered
 * controller binding plus GW-issued subject licence. The shared DCR client and
 * key aliases stay on the base binding so two subjects can never match one
 * clinical request; only the subject-specific operational DID is added here.
 */
export async function prepareUhcRepresentedSubjectClinicalBinding(input: Readonly<{
  repository: IVaultRepository;
  tenantVaultId: string;
  registeredActorDid: string;
  license: DeviceLicense & Record<string, unknown>;
}>): Promise<Readonly<{ actorDid: string; binding: ClinicalCreatorBinding & { id: string } }>> {
  const sectionId = getEnvSectionId('clinical_author_identity_bindings');
  const records = await input.repository.listContainersInSection<any>(input.tenantVaultId, sectionId);
  const sourceMatches = records.filter(isClinicalCreatorBinding)
    .filter((binding) => binding.kind === FhirIpsCreatorKinds.IndividualMember)
    .filter((binding) => binding.actorDids?.includes(input.registeredActorDid));
  if (sourceMatches.length !== 1) {
    throw new Error('Represented UHC subject requires one registered controller creator binding.');
  }
  const assignmentIdentifier = String(input.license.relatedPersonId || '').trim();
  const ownerIdentifier = String(input.license.subjectId || input.license.ownerOrganizationId || '').trim();
  const actorDid = buildUhcRepresentedControllerActorDid({
    registeredActorDid: input.registeredActorDid,
    assignmentIdentifier,
  });
  const normalized = normalizeClinicalCreatorBinding({
    kind: FhirIpsCreatorKinds.IndividualMember,
    actorIdentifier: sourceMatches[0].actorIdentifier,
    assignmentIdentifier,
    ownerIdentifier,
    role: HealthcareActorRoles.Controller,
    actorDids: [actorDid],
  });
  const existing = records.filter(isClinicalCreatorBinding)
    .find((binding) => binding.authorIdentifier === normalized.authorIdentifier);
  if (existing && (
    existing.kind !== normalized.kind
    || existing.actorIdentifier !== normalized.actorIdentifier
    || existing.ownerIdentifier !== normalized.ownerIdentifier
    || existing.role !== normalized.role
  )) {
    throw new Error('Represented UHC creator assignment conflicts with its registered binding.');
  }
  return {
    actorDid,
    binding: {
      ...(existing || normalized),
      id: normalized.authorIdentifier,
      actorDids: uniqueText([...(existing?.actorDids || []), actorDid]),
    },
  };
}

/** Reads the immutable actor and the single subject pinned by root SMART scopes. */
export function readUhcOpenIdActorAndSubject(body: Readonly<Record<string, unknown>>): Readonly<{
  actorDid: string;
  subjectDid: string;
}> | undefined {
  const actorDid = String(body.sub || '').trim();
  const subjects = String(body.scope || '').split(/\s+/).flatMap((scope) => {
    const [head, query = ''] = scope.split('?', 2);
    if (!/^organization\/(?:Composition|ResearchSubject)\./i.test(head)) return [];
    const subject = new URLSearchParams(query).get('subject')?.trim();
    return subject ? [subject] : [];
  });
  const uniqueSubjects = [...new Set(subjects)];
  return actorDid && uniqueSubjects.length === 1
    ? { actorDid, subjectDid: uniqueSubjects[0] }
    : undefined;
}

async function unprotect<T>(document: any, kmsService: IKmsService, tenantVaultId: string): Promise<T> {
  return kmsService.unprotectConfidentialData<T>(document, tenantVaultId);
}

/**
 * Exposes one authorized subject projection only to one OpenID request.
 *
 * The projected plaintext is neither persisted nor passed back through the
 * at-rest envelope API. The scoped KMS facade recognizes only the ephemeral
 * wrapper returned by the scoped repository; every other operation delegates
 * to the process-owned KMS unchanged.
 */
export function buildUhcRequestScopedAuthorizationDependencies(input: Readonly<{
  repository: IVaultRepository;
  kmsService: IKmsService;
  registeredDocument: any;
  projected: DeviceProfile;
  clientId: string;
}>): Readonly<{ repository: IVaultRepository; kmsService: IKmsService }> {
  const scopedDeviceDocument = { ...input.registeredDocument };
  const repository = new Proxy(input.repository, {
    get(target, property, receiver) {
      if (property === 'get') {
        return async (collectionName: string, containerId: string, sectionId?: string) => {
          const document = await target.get<any>(collectionName, containerId, sectionId);
          return containerId === input.clientId && document
            ? scopedDeviceDocument
            : document;
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as IVaultRepository;
  const kmsService = new Proxy(input.kmsService, {
    get(target, property, receiver) {
      if (property === 'unprotectConfidentialData') {
        return async <T>(document: any, entityId: string): Promise<T> => document === scopedDeviceDocument
          ? input.projected as T
          : target.unprotectConfidentialData<T>(document, entityId);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as IKmsService;
  return { repository, kmsService };
}

/** Builds the UHC authorization adapter without modifying the frozen OpenID manager. */
export function buildUhcOpenIdAuthManager(input: Readonly<{
  kmsService: IKmsService;
  tenantsManager: ITenantsManager;
  repository: IVaultRepository;
  clearingHouseService: IClearingHouseService;
  breakGlassAuthorizer?: SoschainBreakGlassAuthorizer;
}>): IJobProcessor {
  const defaultManager = new OpenIdAuthManager(
    input.kmsService,
    input.tenantsManager,
    input.repository,
    input.clearingHouseService,
    input.breakGlassAuthorizer,
  );
  return {
    async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
      const body = job.content?.body as Record<string, unknown> | undefined;
      const clientId = String(body?.client_id || '').trim();
      const identity = body ? readUhcOpenIdActorAndSubject(body) : undefined;
      if (!clientId || !identity || !job.sector || !job.tenantId) {
        return defaultManager.process(job);
      }
      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const authorization = await resolveUhcControllerSubjectAuthorization({
        repository: input.repository,
        kmsService: input.kmsService,
        tenantVaultId,
        clientId,
        actorDid: identity.actorDid,
        subjectDid: identity.subjectDid,
      });
      if (!authorization || authorization.profile.authorizedSubjectDid !== identity.subjectDid) {
        return defaultManager.process(job);
      }
      const representedBinding = await prepareUhcRepresentedSubjectClinicalBinding({
        repository: input.repository,
        tenantVaultId,
        registeredActorDid: identity.actorDid,
        license: authorization.license,
      });
      const projected = projectUhcRepresentedControllerDeviceProfile(
        authorization.profile,
        identity.subjectDid,
      );
      const deviceSection = getEnvSectionId('device-profiles');
      const registeredDocument = await input.repository.get<any>(
        tenantVaultId,
        clientId,
        deviceSection,
      );
      if (!registeredDocument) return defaultManager.process(job);
      const scoped = buildUhcRequestScopedAuthorizationDependencies({
        repository: input.repository,
        kmsService: input.kmsService,
        registeredDocument,
        projected,
        clientId,
      });
      const response = await new OpenIdAuthManager(
        scoped.kmsService,
        input.tenantsManager,
        scoped.repository,
        input.clearingHouseService,
        input.breakGlassAuthorizer,
      ).process(job);
      await input.repository.put(
        tenantVaultId,
        [representedBinding.binding],
        getEnvSectionId('clinical_author_identity_bindings'),
      );
      return response;
    },
  };
}

function isClinicalCreatorBinding(value: unknown): value is ClinicalCreatorBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string'
    && typeof record.actorIdentifier === 'string'
    && typeof record.authorIdentifier === 'string'
    && typeof record.ownerIdentifier === 'string'
    && typeof record.role === 'string';
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}
