import { v4 as uuidv4 } from 'uuid';
import type { BundleEntry, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { normalizePublicAliasList } from 'gdc-common-utils-ts/utils/same-as';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import { getBundleResponseTypeForAction } from '../../utils/bundle';
import { normalizeContextualizedClaims } from '../../utils/claims';
import { getEnvSectionId } from '../../utils/section-env';
import { getTenantVaultId } from '../../utils/tenant';
import { splitIndexedEmails, splitIndexedPhones } from '../../utils/indexed-contact';
import { composeHostDidWebId } from '../../utils/did-backend';
import { getTenantAuthorizationStatus } from '../../utils/tenant-lifecycle';
import { SUBJECT_SECTION_INDIVIDUAL } from '../../constants/domain';
import { materializeFreeIndividualLicenses } from '../../utils/license-issuance';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { FamilyRegistrationStatus, GatewayClaim } from '../../shared/gateway-claim-contract';

type IndividualOrganizationDeps = Readonly<{
  job: JobRequest;
  environment?: string;
  apiBaseUrl: string;
  hostExternalDomain?: string;
  tenantsCacheManager: any;
  vaultRepository: any;
  kmsService: any;
  handleError: (error: any, entryType?: string, meta?: any) => ErrorEntry;
  extractResources: (claims: ClaimsRecord, environment?: string) => { organization: any };
}>;

const FAMILY_REGISTRATION_OFFER_TYPE = 'Family-registration-offer-v1.0';
const FAMILY_SEARCH_RESULT_TYPE = 'Family-search-result-v1.0';
const FAMILY_REGISTRATION_STATUS_CLAIM = 'org.schema.FamilyRegistration.status';
const OWNER_TELEPHONE_CLAIM = 'org.schema.Organization.owner.telephone';
const OWNER_EMAIL_CLAIM = 'org.schema.Organization.owner.email';
const ORGANIZATION_SAME_AS_CLAIM = 'org.schema.Organization.sameAs';

/**
 * Handles the legacy family-compatible individual registration flow hosted
 * inside an already active tenant.
 *
 * @deprecated
 * This is a compatibility shortcut only. It must not be treated as the
 * normative individual-controller onboarding flow.
 *
 * This is intentionally not the legal-organization onboarding path:
 * - requires an existing tenant via `job.tenantId`
 * - does not call ICA `_verify`
 * - persists subject-style registrations in the tenant `individual` section
 * - does not prove that a controller wallet/profile/device is operational
 * - does not complete a cryptographic controller onboarding lifecycle
 *
 * Security/programming rule:
 * - use this only for legacy compatibility or tightly scoped internal tests
 * - do not present success here as equivalent to a controller-ready actor
 * - production-grade flows should exercise the full controller onboarding path
 */
export async function processIndividualOrganizationFlow(
  deps: IndividualOrganizationDeps,
): Promise<IDecodedDidcommPayload> {
  const jobEntries = deps.job?.content?.body?.data || [];
  const responseEntries: (BundleEntry | ErrorEntry)[] = [];

  for (const entry of jobEntries) {
    try {
      if (deps.job.action === '_search') {
        responseEntries.push(await processIndividualOrganizationSearchEntry({
          job: deps.job,
          entry,
          tenantsCacheManager: deps.tenantsCacheManager,
          vaultRepository: deps.vaultRepository,
          kmsService: deps.kmsService,
        }));
      } else {
        responseEntries.push(await processIndividualOrganizationRegistrationEntry({
          job: deps.job,
          entry,
          environment: deps.environment,
          tenantsCacheManager: deps.tenantsCacheManager,
          vaultRepository: deps.vaultRepository,
          kmsService: deps.kmsService,
          extractResources: deps.extractResources,
        }));
      }
    } catch (error) {
      responseEntries.push(deps.handleError(error, entry.type, entry.meta));
    }
  }

  const responseBundle: BundleJsonApi = {
    data: responseEntries,
    resourceType: 'Bundle',
    type: getBundleResponseTypeForAction(deps.job.action),
    total: responseEntries.length,
  };

  const issuerDid = composeHostDidWebId(deps.apiBaseUrl, deps.hostExternalDomain);
  return {
    jti: uuidv4(),
    type: 'hosting-response',
    thid: deps.job.content?.thid as string,
    iss: issuerDid,
    aud: deps.job.content?.iss as string,
    exp: Math.floor(Date.now() / 1000) + 300,
    body: responseBundle,
  };
}

/**
 * Resolves the tenant collection backing individual/family-compatible records.
 *
 * Contract:
 * - when `createIfMissing` is true, the tenant vault is provisioned lazily
 * - otherwise the caller only gets the cached/raw vault id without side effects
 */
export async function resolveTenantCollectionForIndividuals(input: {
  tenantVaultId: string;
  createIfMissing: boolean;
  tenantsCacheManager: any;
  vaultRepository: any;
}): Promise<string> {
  const cached = await input.tenantsCacheManager.getCollectionName(input.tenantVaultId);
  if (cached) {
    return cached;
  }

  if (input.createIfMissing) {
    const exists = await input.vaultRepository.vaultExists(input.tenantVaultId);
    if (!exists) {
      await input.vaultRepository.createNewVault({ id: input.tenantVaultId });
    }
  }
  return input.tenantVaultId;
}

/**
 * Registers one individual/family-compatible subject record inside an existing
 * hosted tenant.
 *
 * @deprecated
 * This helper only creates or reopens the administrative subject registration.
 * It does not make the controller cryptographically operational.
 *
 * Required input:
 * - `job.tenantId`
 * - tenant sector either on the job or in `Service.category`
 * - `Organization.alternateName`
 * - at least one of `Organization.owner.telephone` or `Organization.owner.email`
 *
 * Commercial contract:
 * - this legacy individual/family-compatible flow does not mint a host
 *   commercial Offer
 * - callers must not expect `meta.claims['org.schema.Offer.identifier']`
 * - callers must not expect a follow-up `Order/_batch` step
 * - the response only communicates creation vs already-exists status through
 *   `org.schema.FamilyRegistration.status`
 *
 * Missing lifecycle on purpose:
 * - no wallet/profile bootstrap
 * - no controller key registration / proof-of-possession
 * - no device/profile activation
 *
 * License baseline:
 * - the administrative registration still materializes the product baseline
 *   of two zero-cost individual-member seats;
 * - the first seat is assigned to the owner/controller and the second remains
 *   available;
 * - this allocation does not claim that the missing wallet/device/key
 *   activation steps have completed.
 */
export async function processIndividualOrganizationRegistrationEntry(input: {
  job: JobRequest;
  entry: BundleEntry;
  environment?: string;
  tenantsCacheManager: any;
  vaultRepository: any;
  kmsService: any;
  extractResources: (claims: ClaimsRecord, environment?: string) => { organization: any };
}): Promise<BundleEntry | ErrorEntry> {
  const rawClaims = input.entry?.resource?.meta?.claims;
  const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
  if (!claims) {
    throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
  }

  const tenantContext = await resolveActiveHostedTenantContext({
    job: input.job,
    claims,
    tenantsCacheManager: input.tenantsCacheManager,
    vaultRepository: input.vaultRepository,
    createIfMissing: true,
  });
  const ownerLookup = readRequiredIndividualOwnerLookup(claims, false);

  const returnExistingRegistration = async (existing: ConfidentialStorageDoc) => {
    const content = await input.kmsService.unprotectConfidentialData(existing, tenantContext.tenantVaultId);
    const existingClaims = (content?.claims || {}) as ClaimsRecord;
    const controllerSubjectId = String(
      existingClaims[ClaimsOrganizationSchemaorg.ownerIdentifierValue]
      || ownerLookup.ownerEmails[0]
      || ownerLookup.ownerPhones[0]
      || existing.id,
    ).trim();
    const [controllerAuthorizedSubjectDid] = normalizePublicAliasList(
      typeof existingClaims[ORGANIZATION_SAME_AS_CLAIM] === 'string'
        ? existingClaims[ORGANIZATION_SAME_AS_CLAIM] as string
        : undefined,
    );
    await materializeFreeIndividualLicenses({
      vaultRepository: input.vaultRepository,
      tenantVaultId: tenantContext.tenantVaultId,
      tenantId: String(input.job.tenantId),
      ownerOrganizationId: existing.id,
      quantity: 2,
      ensureTotal: true,
      controllerSubjectId,
      controllerAuthorizedSubjectDid,
      controllerRelationshipRole: String(existingClaims[ClaimsOrganizationSchemaorg.memberRole] || 'ONESELF'),
      controllerEmail: ownerLookup.ownerEmails[0],
      controllerPhone: ownerLookup.ownerPhones[0],
    });
    return buildExistingFamilyRegistrationResponse(existing.id, existingClaims);
  };

  for (const phone of ownerLookup.ownerPhones) {
    const results = await input.vaultRepository.query(tenantContext.tenantCollectionName, {
      sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      where: [
        { name: OWNER_TELEPHONE_CLAIM, value: phone },
        { name: ClaimsOrganizationSchemaorg.alternateName, value: ownerLookup.alternateName },
      ],
    });
    if (results.length > 0) {
      const existing = results[0] as ConfidentialStorageDoc;
      return returnExistingRegistration(existing);
    }
  }
  for (const email of ownerLookup.ownerEmails) {
    const results = await input.vaultRepository.query(tenantContext.tenantCollectionName, {
      sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      where: [
        { name: OWNER_EMAIL_CLAIM, value: email },
        { name: ClaimsOrganizationSchemaorg.alternateName, value: ownerLookup.alternateName },
      ],
    });
    if (results.length > 0) {
      const existing = results[0] as ConfidentialStorageDoc;
      return returnExistingRegistration(existing);
    }
  }

  const { organization } = input.extractResources(claims, input.environment);
  const docId = String(claims[ClaimsOrganizationSchemaorg.identifierValue] || organization.id || uuidv4());
  const finalClaims = { ...claims, [ClaimsOrganizationSchemaorg.identifierValue]: docId };
  /**
   * UHC publishes the subject card identity as schema.org `sameAs`.
   * Keep it in the protected index so controller/card resolution can locate the
   * individual organization without decrypting every registration document.
   */
  const sameAsAliases = normalizePublicAliasList(
    typeof claims[ORGANIZATION_SAME_AS_CLAIM] === 'string'
      ? claims[ORGANIZATION_SAME_AS_CLAIM] as string
      : undefined,
  );
  const indexedAttributes = [
    { name: 'status', value: EntityLifecycleStatus.Active },
    { name: ClaimsOrganizationSchemaorg.alternateName, value: ownerLookup.alternateName },
    ...ownerLookup.ownerPhones.map((phone) => ({ name: OWNER_TELEPHONE_CLAIM, value: phone })),
    ...ownerLookup.ownerEmails.map((email) => ({ name: OWNER_EMAIL_CLAIM, value: email })),
    ...sameAsAliases.map((alias) => ({ name: ORGANIZATION_SAME_AS_CLAIM, value: alias })),
  ];

  const registrationDoc: ConfidentialStorageDoc = {
    id: docId,
    status: EntityLifecycleStatus.Active,
    sequence: 0,
    indexed: {
      attributes: indexedAttributes,
      hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
    },
    content: {
      status: EntityLifecycleStatus.Active,
      claims: finalClaims,
    },
  };
  const secureDoc = await input.kmsService.protectConfidentialData(registrationDoc, tenantContext.tenantVaultId);
  await input.vaultRepository.put(
    tenantContext.tenantCollectionName,
    [secureDoc],
    getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
  );

  // The hosted UNID tenant can contain many individual organizations. Scope
  // every seat by this registration id so invitations can never borrow from a
  // different household's pool.
  const controllerSubjectId = String(
    claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue]
    || ownerLookup.ownerEmails[0]
    || ownerLookup.ownerPhones[0]
    || docId,
  ).trim();
  await materializeFreeIndividualLicenses({
    vaultRepository: input.vaultRepository,
    tenantVaultId: tenantContext.tenantVaultId,
    tenantId: String(input.job.tenantId),
    ownerOrganizationId: docId,
    quantity: 2,
    ensureTotal: true,
    controllerSubjectId,
    controllerAuthorizedSubjectDid: sameAsAliases[0],
    controllerRelationshipRole: String(claims[ClaimsOrganizationSchemaorg.memberRole] || 'ONESELF'),
    controllerEmail: ownerLookup.ownerEmails[0],
    controllerPhone: ownerLookup.ownerPhones[0],
  });

  return {
    type: FAMILY_REGISTRATION_OFFER_TYPE,
    resource: { resourceType: ResourceTypesFhirR4.Organization, id: docId, meta: {
      claims: { ...finalClaims, [FAMILY_REGISTRATION_STATUS_CLAIM]: FamilyRegistrationStatus.Created },
    } },
    response: { status: '201' },
  };
}

/**
 * Searches one individual/family-compatible record inside an existing tenant.
 */
export async function processIndividualOrganizationSearchEntry(input: {
  job: JobRequest;
  entry: BundleEntry;
  tenantsCacheManager: any;
  vaultRepository: any;
  kmsService: any;
}): Promise<BundleEntry | ErrorEntry> {
  const rawClaims = input.entry?.resource?.meta?.claims;
  const claims = rawClaims ? normalizeContextualizedClaims(rawClaims) : rawClaims;
  if (!claims) {
    throw new ManagerError('Malformed entry: missing meta.claims', IssueType.Required);
  }

  const tenantContext = await resolveActiveHostedTenantContext({
    job: input.job,
    claims,
    tenantsCacheManager: input.tenantsCacheManager,
    vaultRepository: input.vaultRepository,
    createIfMissing: false,
    requireActiveTenant: false,
  });
  let found: ConfidentialStorageDoc | undefined;
  const sameAs = String(claims[ORGANIZATION_SAME_AS_CLAIM] || '').trim();
  const whereCandidates = sameAs
    ? [[{ name: ORGANIZATION_SAME_AS_CLAIM, value: sameAs }]]
    : (() => {
        const ownerLookup = readRequiredIndividualOwnerLookup(claims, true);
        return [
          ...ownerLookup.ownerPhones.map((phone) => [
            { name: OWNER_TELEPHONE_CLAIM, value: phone },
            { name: ClaimsOrganizationSchemaorg.alternateName, value: ownerLookup.alternateName },
          ]),
          ...ownerLookup.ownerEmails.map((email) => [
            { name: OWNER_EMAIL_CLAIM, value: email },
            { name: ClaimsOrganizationSchemaorg.alternateName, value: ownerLookup.alternateName },
          ]),
        ];
      })();
  for (const where of whereCandidates) {
    const results = await input.vaultRepository.query(tenantContext.tenantCollectionName, {
      sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      where,
    });
    if (results.length > 0) {
      found = results[0] as ConfidentialStorageDoc;
      break;
    }
  }

  if (!found) {
    return {
      type: FAMILY_SEARCH_RESULT_TYPE,
      resource: { meta: { claims: { [FAMILY_REGISTRATION_STATUS_CLAIM]: FamilyRegistrationStatus.NotFound } } },
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  const content = await input.kmsService.unprotectConfidentialData(found, tenantContext.tenantVaultId);
  return {
    type: FAMILY_SEARCH_RESULT_TYPE,
    resource: { resourceType: ResourceTypesFhirR4.Organization, id: found.id, meta: { claims: { ...(content?.claims || {}), [FAMILY_REGISTRATION_STATUS_CLAIM]: FamilyRegistrationStatus.Existing } } },
    response: { status: String(HttpStatusCodes.Ok) },
  };
}

async function resolveActiveHostedTenantContext(input: {
  job: JobRequest;
  claims: ClaimsRecord;
  tenantsCacheManager: any;
  vaultRepository: any;
  createIfMissing: boolean;
  requireActiveTenant?: boolean;
}): Promise<{
  tenantVaultId: string;
  tenantCollectionName: string;
}> {
  const sector = (input.job.sector || input.claims[ClaimsServiceSchemaorg.category]) as Sector | undefined;
  if (!sector) {
    throw new ManagerError(`Missing required claim: '${ClaimsServiceSchemaorg.category}'`, IssueType.Required);
  }
  if (!input.job.tenantId) {
    throw new ManagerError('Job is missing tenantId.', IssueType.Required);
  }

  const tenantVaultId = getTenantVaultId(sector, input.job.tenantId);
  const tenantConfig = await input.tenantsCacheManager.getTenant(tenantVaultId);
  if (!tenantConfig) {
    throw new ManagerError(`Hosted tenant '${tenantVaultId}' was not found.`, IssueType.NotFound);
  }
  if (input.requireActiveTenant !== false) {
    const tenantAuthorizationStatus = getTenantAuthorizationStatus(tenantConfig);
    if (tenantAuthorizationStatus !== 'active') {
      throw new ManagerError('Hosted individual registration is not allowed while the tenant is disabled.', IssueType.Forbidden);
    }
  }
  const tenantCollectionName = await resolveTenantCollectionForIndividuals({
    tenantVaultId,
    createIfMissing: input.createIfMissing,
    tenantsCacheManager: input.tenantsCacheManager,
    vaultRepository: input.vaultRepository,
  });

  return { tenantVaultId, tenantCollectionName };
}

function readRequiredIndividualOwnerLookup(
  claims: ClaimsRecord,
  forSearch: boolean,
): {
  alternateName: string;
  ownerPhones: string[];
  ownerEmails: string[];
} {
  const alternateName = claims[ClaimsOrganizationSchemaorg.alternateName] as string | undefined;
  const ownerPhones = splitIndexedPhones(claims[OWNER_TELEPHONE_CLAIM] as string | undefined);
  const ownerEmails = splitIndexedEmails(claims[OWNER_EMAIL_CLAIM] as string | undefined);
  if (!alternateName || (ownerPhones.length === 0 && ownerEmails.length === 0)) {
    throw new ManagerError(
      `Missing required claims${forSearch ? ' for search' : ''}: '${ClaimsOrganizationSchemaorg.alternateName}' and one of owner.telephone/owner.email`,
      IssueType.Required,
    );
  }
  return { alternateName, ownerPhones, ownerEmails };
}

function buildExistingFamilyRegistrationResponse(
  resourceId: string,
  claims: Record<string, any>,
): BundleEntry {
  return {
    type: FAMILY_REGISTRATION_OFFER_TYPE,
    resource: { resourceType: ResourceTypesFhirR4.Organization, id: resourceId, meta: {
      claims: { ...claims, [FAMILY_REGISTRATION_STATUS_CLAIM]: FamilyRegistrationStatus.Existing },
    } },
    response: { status: '200' },
  };
}
