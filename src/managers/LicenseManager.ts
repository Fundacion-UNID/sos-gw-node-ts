// src/managers/LicenseManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { OrganizationEmployeeSearchResponseEntryTypes } from 'gdc-common-utils-ts';
import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';

import { getTenantVaultId } from '../utils/tenant';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import type { BundleEntryResponse, BundleJsonApi, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel } from 'gdc-common-utils-ts/models/issue';
import {
  issueActivationCodeFromPool,
} from '../utils/license-issuance';
import {
  classifyLicenseRole,
  LicenseRoleKinds,
} from 'gdc-common-utils-ts/utils/license';
import { getEnvSectionId } from '../utils/section-env';
import { getPersonOccupationClaim } from '../utils/occupation';
import {
  buildLicenseSearchClaims,
  extractLicenseSearchFilters,
  extractLicenseSearchMetaClaims,
  mapLicenseCategory,
  matchesLicenseFilters,
  resolveLicenseFilterValues,
  searchLicenseDocuments,
  toFilterValues,
} from '../utils/license-search';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import {
  LICENSE_CATEGORY_INDIVIDUAL,
  LICENSE_CATEGORY_PROFESSIONAL,
  LICENSE_STATUS_ACTIVE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_TYPE_MOBILE,
  LICENSE_TYPE_WEB,
  LICENSE_USER_CLASS_EMPLOYEE,
  LICENSE_USER_CLASS_INDIVIDUAL,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../constants/domain';
import type { ITenantsManager } from './ITenantsManager';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { normalizePublicAliasList } from 'gdc-common-utils-ts/utils/same-as';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import type { OrganizationRoleLicenseSectorPolicy } from 'gdc-common-utils-ts/models/organization-role-license';
import {
  buildIssuedRoleLicenseLedgerIdentity,
  ensureIssuedRoleLicenseOnLedger,
} from '../utils/ledger-role-license';
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { normalizeIndexedEmail, normalizeIndexedPhone } from '../utils/indexed-contact';
import { REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META } from '../utils/secure-route-bearer-binding';

/**
 * Manages the business logic for creating device activation licenses.
 * This manager is expected to be triggered by internal system events, such as a
 * webhook from a payment processor like Stripe.
 */
export class LicenseManager implements IJobProcessor {
  private vaultRepository: IVaultRepository;
  private kmsService?: IKmsService;
  private tenantsCacheManager?: ITenantsManager;

  constructor(vaultRepository: IVaultRepository, kmsService?: IKmsService, tenantsCacheManager?: ITenantsManager) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
  }

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  /**
   * Processes an internal job to generate device licenses for a tenant.
   * @param job The job request containing details for license creation.
   * @returns A promise resolving to a response payload indicating the result.
   * @throws {ManagerError} If the input is invalid or incomplete.
   */
  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const action = String(job.action || '').trim();
    if (!action) {
      throw new ManagerError('Missing action.', IssueType.Required);
    }
    if (action === '_issue') return this.issueActivationCodes(job);
    if (action === '_search') return this.searchLicenses(job);
    if (action === '_add') {
      throw new ManagerError(
        "Unsupported License action '_add'. Licence inventory is created through Offer -> Order.",
        IssueType.NotSupported,
      );
    }
    if (action === '_claim') return this.claimIndividualMemberLicense(job);
    if (action === '_accept' || action === '_deactivate' || action === '_release') {
      return this.transitionIndividualMemberLicense(job, action);
    }
    // Keep legacy/internal semantics where the action might be `create`.
    const {
      targetTenantId,
      quantity,
      plan,
      userClass,
      type,
      renewalCycle,
      reactivationEnabled,
      orderId,
      userCategory,
      deviceRestrictions,
    } = job.content?.body;

    // 1. Validate input
    if (!targetTenantId) {
        throw new ManagerError('targetTenantId is a required field.', IssueType.Required);
    }
    if (!job.sector) {
      throw new ManagerError('sector is required to resolve the tenant vault.', IssueType.Required);
    }
    if (!orderId) {
      throw new ManagerError('orderId is a required field.', IssueType.Required);
    }
    if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
      throw new ManagerError('License quantity must be a positive number.', IssueType.Value);
    }
    if (!userClass || (userClass !== LICENSE_USER_CLASS_EMPLOYEE && userClass !== LICENSE_USER_CLASS_INDIVIDUAL)) {
      throw new ManagerError(
        `userClass must be either '${LICENSE_USER_CLASS_EMPLOYEE}' or '${LICENSE_USER_CLASS_INDIVIDUAL}'.`,
        IssueType.Value,
      );
    }
    if (!type || (type !== LICENSE_TYPE_MOBILE && type !== LICENSE_TYPE_WEB)) {
      throw new ManagerError(
        `type must be either '${LICENSE_TYPE_MOBILE}' or '${LICENSE_TYPE_WEB}'.`,
        IssueType.Value,
      );
    }
    if (userClass === LICENSE_USER_CLASS_EMPLOYEE && (typeof userCategory !== 'string' || !userCategory)) {
      throw new ManagerError("A non-empty 'userCategory' is required for employee licenses.", IssueType.Value);
    }

    // 2. Determine Expiration
    const nowTimestamp = Date.now();
    const expiryDate = new Date(nowTimestamp);
    // This logic can be expanded based on the `renewalCycle` or `plan`
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const exp = Math.floor(expiryDate.getTime() / 1000);

    // 3. Generate License Documents
    const licenseDocs: ConfidentialStorageDoc[] = [];
    for (let i = 0; i < quantity; i++) {
      const licenseId = uuidv4();
      
      const license: DeviceLicense = {
        id: licenseId,
        tenantId: targetTenantId,
        orderId: orderId,
        userClass: userClass,
        userCategory: userClass === LICENSE_USER_CLASS_EMPLOYEE ? userCategory : undefined,
        type: type,
        status: LICENSE_STATUS_AVAILABLE,
        plan: plan || 'default',
        renewalCycle: renewalCycle || null,
        reactivationEnabled: reactivationEnabled === true, // Default to false
        exp: exp,
        deviceRestrictions: deviceRestrictions,
      };

      const doc: ConfidentialStorageDoc = {
        id: licenseId,
        status: license.status,
        sequence: 0,
        content: license,
      };
      licenseDocs.push(doc);
    }

    // 4. Persist to the repository
    const vaultId = getTenantVaultId(job.sector, targetTenantId);
    await this.vaultRepository.put(vaultId, licenseDocs, getEnvSectionId('device-licenses'));

    // 5. Return success response
    const responseThid = job.content?.thid as string;
    return {
      jti: uuidv4(),
      thid: responseThid,
      type: 'https://didcomm.org/securit-device-licensing/1.0/generation-response',
      iss: 'did:web:host', // Internal process issuer
      aud: 'internal', // Internal process audience
      exp: Math.floor(Date.now() / 1000) + 60,
      body: {
        type: 'transaction-response',
        total: quantity,
        data: [{
          type: 'LicenseGenerationResult',
          response: { status: '201' }, // 201 Created
          resource: {
            resourceType: 'OperationOutcome',
            issue: [{
              severity: 'information',
              code: 'informational',
              diagnostics: `${quantity} licenses of class '${userClass}'${userClass === LICENSE_USER_CLASS_EMPLOYEE ? ` and category '${userCategory}'` : ''} of type '${type}' created successfully for tenant '${targetTenantId}'.`,
            }]
          }
        }]
      }
    };
  }

  /**
   * Activates one issued individual-member invitation after a scanned-card
   * login without disclosing the invitation code to the browser.
   *
   * The trusted BFF supplies Firebase-verified email/telephone identifiers,
   * the authenticated Firebase uid and the exact currently issued
   * `authorizedSubjectDid`. GW requires one unique issued seat matching both
   * recipient and subject.
   *
   * Compatibility boundary: current UHC portal licenses may hold the physical
   * card locator in `authorizedSubjectDid`. V2 introduces a separate physical
   * alias and keeps the internal subject/index DID in this field; this method
   * must then match both explicit values without reinterpreting old records.
   */
  private async claimIndividualMemberLicense(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const tenantVaultId = String(job.tenantId || '').trim();
    if (!(await this.tenantExists(tenantVaultId))) {
      throw new ManagerError(`Tenant '${tenantVaultId}' not found.`, IssueType.NotFound);
    }
    const entries = Array.isArray((job.content?.body as any)?.data)
      ? (job.content?.body as any).data
      : Array.isArray((job.content?.body as any)?.entry)
        ? (job.content?.body as any).entry
        : [];
    const responseEntries: any[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.resource?.meta?.claims ?? {};
      try {
        const subjectId = String(entry?.meta?.subjectId || '').trim();
        const authorizedSubjectDid = String(entry?.meta?.authorizedSubjectDid || '').trim();
        const verifiedActorIdentifiers = Array.isArray(entry?.meta?.verifiedActorIdentifiers)
          ? entry.meta.verifiedActorIdentifiers.map((value: unknown) => String(value || '').trim()).filter(Boolean)
          : [];
        if (!subjectId || !authorizedSubjectDid || verifiedActorIdentifiers.length === 0) {
          throw new ManagerError(
            '_claim requires subjectId, authorizedSubjectDid and verifiedActorIdentifiers.',
            IssueType.Required,
          );
        }

        const verifiedEmails = new Set(
          verifiedActorIdentifiers
            .filter((value: string) => value.includes('@'))
            .map((value: string) => value.toLowerCase()),
        );
        const verifiedPhones = new Set(
          verifiedActorIdentifiers
            .filter((value: string) => !value.includes('@'))
            .map((value: string) => value.replace(/[\s().-]/g, '')),
        );
        const documents = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
          tenantVaultId,
          getEnvSectionId('device-licenses'),
        );
        const matches = documents.filter((candidate) => {
          const license = candidate.content as DeviceLicense | undefined;
          if (!license
            || license.userClass !== LICENSE_USER_CLASS_INDIVIDUAL
            || license.status !== LICENSE_STATUS_ISSUED
            || license.authorizedSubjectDid !== authorizedSubjectDid) {
            return false;
          }
          const email = String(license.issuedToEmail || '').trim().toLowerCase();
          const phone = String(license.issuedToPhone || '').replace(/[\s().-]/g, '');
          return Boolean((email && verifiedEmails.has(email)) || (phone && verifiedPhones.has(phone)));
        });
        if (matches.length === 0) {
          throw new ManagerError('No issued invitation matches this scanned card and authenticated actor.', IssueType.NotFound);
        }
        if (matches.length > 1) {
          throw new ManagerError('Several issued invitations match this scanned card and actor.', IssueType.Conflict);
        }

        const document = matches[0];
        const license = document.content as DeviceLicense & Record<string, any>;
        license.status = LICENSE_STATUS_ACTIVE;
        license.subjectId = subjectId;
        license.activatedAt = Math.floor(Date.now() / 1000);
        delete license.activationCode;
        document.status = LICENSE_STATUS_ACTIVE;
        document.sequence = Number(document.sequence || 0) + 1;
        await this.vaultRepository.put(
          tenantVaultId,
          [document],
          getEnvSectionId('device-licenses'),
        );
        responseEntries.push({
          type: 'License:claim',
          response: { status: String(HttpStatusCodes.Ok) },
          meta: {
            licenseId: document.id,
            ownerOrganizationId: license.ownerOrganizationId,
            authorizedSubjectDid: license.authorizedSubjectDid,
          },
          resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims } },
        });
      } catch (error: any) {
        responseEntries.push(this.buildLicenseErrorEntry(error, rawClaims));
      }
    }
    return this.buildLicenseResponse(job, responseEntries);
  }

  /**
   * Searches one tenant `device-licenses` pool using either:
   * - FHIR-like `Bundle.entry.request.url + Parameters`
   * - current shared claims-first search entries emitted by common-utils
   */
  private async searchLicenses(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = String(job.content?.thid || uuidv4());
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const body = job.content?.body as any;
    const entries: any[] =
      (Array.isArray(body?.entry) && body.entry)
      || (Array.isArray(body?.data) && body.data)
      || [];

    if (entries.length === 0) {
      throw new ManagerError('License search requires at least one entry.', IssueType.Required);
    }

    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    for (const entry of entries) {
      try {
        const filters = extractLicenseSearchFilters(entry);
        this.assertRegisteredProfileDirectoryContact(job, filters);
        const matches = await this.searchLicenseDocuments(tenantVaultId, filters);
        if (filters[ClaimsPersonSchemaorg.email]?.length || filters[ClaimsPersonSchemaorg.telephone]?.length) {
          await this.repairLegacySelfSubjectBindings(tenantVaultId, matches);
        }
        responseEntries.push(...buildSearchResponseEntries(
          OrganizationEmployeeSearchResponseEntryTypes.License,
          matches,
        ));
      } catch (e: any) {
        responseEntries.push({
          type: GatewayResponseEntryTypes.LicenseSearch,
          resource: {
            resourceType: ResourceTypesFhirR4.OperationOutcome,
            meta: { claims: extractLicenseSearchMetaClaims(entry) },
          },
          response: {
            status: e instanceof ManagerError ? e.status : String(HttpStatusCodes.BadRequest),
            outcome: createOperationOutcome(
              IssueLevel.Error,
              e instanceof ManagerError ? e.code : IssueType.Invalid,
              e?.message || String(e),
            ),
          },
        } as any);
      }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      total: responseEntries.length,
      data: responseEntries,
    };

    return {
      jti: uuidv4(),
      thid,
      type: 'search-response',
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }

  /**
   * Prevents a pre-SMART personal wallet from turning the account directory
   * route into a tenant-wide licence scan. The API has already verified and
   * authored this protected-profile marker; the business query must repeat at
   * least one of that profile's issued contacts exactly.
   */
  private assertRegisteredProfileDirectoryContact(
    job: JobRequest,
    filters: ReturnType<typeof extractLicenseSearchFilters>,
  ): void {
    const binding = (job.content as any)?.meta?.[REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META];
    if (!binding) return;

    const expectedEmail = normalizeIndexedEmail(binding.authenticatedEmail);
    const expectedPhone = normalizeIndexedPhone(binding.authenticatedTelephone);
    const requestedEmails = (filters[ClaimsPersonSchemaorg.email] || [])
      .map(normalizeIndexedEmail)
      .filter((value): value is string => Boolean(value));
    const requestedPhones = (filters[ClaimsPersonSchemaorg.telephone] || [])
      .map(normalizeIndexedPhone)
      .filter((value): value is string => Boolean(value));
    if ((expectedEmail && requestedEmails.includes(expectedEmail))
      || (expectedPhone && requestedPhones.includes(expectedPhone))) return;

    throw new ManagerError(
      'Pre-SMART licence directory search must match the protected profile contact.',
      IssueType.Forbidden,
    );
  }

  /**
   * Backfills the one historical defect where an active ONESELF seat was
   * created without its owned Organization.sameAs. The exact email/telephone
   * search has already selected the controller seat; no subject scan occurs.
   * This migration is idempotent and keeps portal and telephone discovery on
   * the same GW authorization record.
   */
  private async repairLegacySelfSubjectBindings(
    tenantVaultId: string,
    matches: Record<string, any>[],
  ): Promise<void> {
    if (!this.kmsService) return;
    for (const row of matches) {
      const meta = row?.meta || {};
      const role = String(meta?.claims?.['org.schema.Person.hasOccupation.identifier.value'] || '')
        .trim()
        .split('|')
        .at(-1)
        ?.toUpperCase();
      const ownerOrganizationId = String(meta.ownerOrganizationId || '').trim();
      if (meta.authorizedSubjectDid || role !== 'ONESELF' || !ownerOrganizationId) continue;

      const tenantCollectionName = await this.tenantsCacheManager?.getCollectionName(tenantVaultId)
        || tenantVaultId;
      const organizationDocument = await this.vaultRepository.get<ConfidentialStorageDoc>(
        tenantCollectionName,
        ownerOrganizationId,
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
      if (!organizationDocument) continue;
      const organization = await this.kmsService.unprotectConfidentialData<any>(
        organizationDocument,
        tenantVaultId,
      );
      const [authorizedSubjectDid] = normalizePublicAliasList(
        String(organization?.claims?.[ClaimsOrganizationSchemaorg.sameAs] || ''),
      );
      if (!authorizedSubjectDid) continue;

      const licenseDocument = await this.vaultRepository.get<ConfidentialStorageDoc>(
        tenantVaultId,
        String(row.id || ''),
        getEnvSectionId('device-licenses'),
      );
      const license = licenseDocument?.content as DeviceLicense & Record<string, unknown> | undefined;
      if (!licenseDocument || !license || license.authorizedSubjectDid
        || license.status !== LICENSE_STATUS_ACTIVE
        || license.ownerOrganizationId !== ownerOrganizationId) continue;

      const repaired = {
        ...licenseDocument,
        sequence: Number(licenseDocument.sequence || 0) + 1,
        content: { ...license, authorizedSubjectDid },
      } as ConfidentialStorageDoc;
      await this.vaultRepository.put(tenantVaultId, [repaired], getEnvSectionId('device-licenses'));
      meta.authorizedSubjectDid = authorizedSubjectDid;
    }
  }

  /**
   * Issues (reserves) an activation code from the tenant's pool of `device-licenses`.
   *
   * This is a tenant-admin/IT operation used to invite a professional after licenses were purchased.
   * It converts a `DeviceLicense` from `available` -> `issued` and attaches the
   * seat credential used for its bounded set of device installations.
   *
   * Input: accept both JSON:API (`body.data[]`) and FHIR-like (`body.entry[]`)
   * envelopes, reading claims only from `entry.resource.meta.claims`.
   */
  private async issueActivationCodes(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid || uuidv4();
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }

    const tenantVaultId = getTenantVaultId(job.sector as any, job.tenantId);
    if (!(await this.tenantExists(tenantVaultId))) {
      throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
    }

    const body = job.content?.body as any;
    const entries: any[] = (Array.isArray(body?.data) && body.data) || (Array.isArray(body?.entry) && body.entry) || [];
    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.resource?.meta?.claims as Record<string, any> | undefined;

      try {
        if (!rawClaims || typeof rawClaims !== 'object') throw new Error('Missing meta.claims for License/_issue entry.');
        const claims = normalizeContextualizedClaims(rawClaims);

        const category =
          getClaimValue<string>(claims, 'org.schema.IndividualProduct.category') ||
          getClaimValue<string>(claims, 'License.userClass') ||
          LICENSE_CATEGORY_PROFESSIONAL;
        const licenseUserClass =
          category === LICENSE_CATEGORY_INDIVIDUAL
            ? LICENSE_USER_CLASS_INDIVIDUAL
            : category === LICENSE_CATEGORY_PROFESSIONAL
              ? LICENSE_USER_CLASS_EMPLOYEE
              : LICENSE_USER_CLASS_EMPLOYEE;

        const licenseType =
          getClaimValue<string>(claims, 'org.schema.IndividualProduct.additionalType') ||
          getClaimValue<string>(claims, 'License.type') ||
          LICENSE_TYPE_MOBILE;
        const inviteEmail =
          getClaimValue<string>(claims, 'org.schema.Person.email') ||
          getClaimValue<string>(claims, 'License.email');
        const invitePhone =
          getClaimValue<string>(claims, 'org.schema.Person.telephone') ||
          getClaimValue<string>(claims, 'License.telephone');
        const inviteRole =
          getPersonOccupationClaim(claims as Record<string, any>) ||
          getClaimValue<string>(claims, 'License.role');

        if (!inviteEmail && !invitePhone) {
          throw new Error('Missing required claim: org.schema.Person.email or org.schema.Person.telephone');
        }
        if (!inviteRole) throw new Error('Missing required claim: org.schema.Person.hasOccupation');
        const ownerOrganizationId = String(entry?.meta?.ownerOrganizationId || '').trim();
        const relatedPersonId = String(entry?.meta?.relatedPersonId || '').trim();
        const invitationId = String(entry?.meta?.invitationId || '').trim();
        const subjectId = String(entry?.meta?.subjectId || '').trim();
        const subjectDid = String(entry?.meta?.subjectDid || '').trim();
        if (licenseUserClass === LICENSE_USER_CLASS_INDIVIDUAL) {
          const roleKind = classifyLicenseRole(inviteRole);
          if (roleKind === LicenseRoleKinds.Professional) {
            throw new Error('ISCO professional roles do not consume individual-member licenses.');
          }
          if (roleKind !== LicenseRoleKinds.IndividualMember) {
            throw new Error('Individual-member licenses require a FHIR v3-RoleCode role.');
          }
          if (!ownerOrganizationId) {
            throw new Error('Individual-member License/_issue requires meta.ownerOrganizationId.');
          }
        }

        const organizationOfficialId = licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE
          ? ownerOrganizationId
            || await this.tenantsCacheManager?.getOrganizationIdentifierUrn(tenantVaultId)
            || ''
          : ownerOrganizationId;
        if (licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE && !organizationOfficialId) {
          throw new Error('Professional licence issuance requires the official organization identifier.');
        }
        if (licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE && !String(job.jurisdiction || '').trim()) {
          throw new Error('Professional licence issuance requires the authoritative route jurisdiction.');
        }
        if (licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE && !subjectId) {
          throw new Error('Professional licence issuance requires meta.subjectId for the created employee resource.');
        }
        const contactKind = inviteEmail ? 'email' : 'phone';
        const contact = inviteEmail || invitePhone || '';
        const stableActorIdentifier = buildStableActorIdentifier({ contactKind, contact });
        const ledgerIdentity = licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE
          ? buildIssuedRoleLicenseLedgerIdentity({
            // Tenant storage exposes the canonical authorization URN here;
            // the ledger builder extracts its bare official identifier.
            organizationId: organizationOfficialId,
            jurisdiction: String(job.jurisdiction).trim(),
            contactKind,
            contact,
            licensedRole: inviteRole,
          })
          : undefined;
        const requestedSector = String(job.sector || '').trim() as OrganizationRoleLicenseSectorPolicy['sector'];
        const roleLicensePolicies = Array.isArray(entry?.meta?.roleLicensePolicies)
          ? (entry.meta.roleLicensePolicies as OrganizationRoleLicenseSectorPolicy[]).map((policy) => ({
            ...policy,
            sector: String(policy.sector || requestedSector).trim() as OrganizationRoleLicenseSectorPolicy['sector'],
          }))
          : [{ sector: requestedSector, active: true }];

        const { activationCode, licenseId, maxDevices } = await issueActivationCodeFromPool({
          vaultRepository: this.vaultRepository,
          kmsService: this.kmsService,
          tenantVaultId,
          userClass: licenseUserClass as any,
          type: licenseType as any,
          email: inviteEmail,
          phone: invitePhone,
          role: inviteRole,
          ownerOrganizationId: organizationOfficialId || undefined,
          relatedPersonId: relatedPersonId || undefined,
          invitationId: invitationId || undefined,
          subjectId: subjectId || undefined,
          subjectDid: subjectDid || undefined,
          stableActorIdentifier,
          beforePersist: ledgerIdentity
            ? async () => {
              await ensureIssuedRoleLicenseOnLedger({
                identity: ledgerIdentity,
                policies: roleLicensePolicies,
              });
            }
            : undefined,
        });

        const issuedCategory =
          licenseUserClass === LICENSE_USER_CLASS_INDIVIDUAL
            ? LICENSE_CATEGORY_INDIVIDUAL
            : licenseUserClass === LICENSE_USER_CLASS_EMPLOYEE
              ? LICENSE_CATEGORY_PROFESSIONAL
              : 'device';
        const responseClaims = {
          ...(rawClaims as any),
          'org.schema.IndividualProduct.serialNumber': activationCode,
          'org.schema.IndividualProduct.category': issuedCategory,
        };

        responseEntries.push({
          type: GatewayResponseEntryTypes.LicenseIssued,
          response: { status: String(HttpStatusCodes.Created) },
          meta: {
            licenseId,
            maxDevices,
            ...(organizationOfficialId ? { ownerOrganizationId: organizationOfficialId } : {}),
            ...(relatedPersonId ? { relatedPersonId } : {}),
            ...(invitationId ? { invitationId } : {}),
            ...(subjectId ? { subjectId } : {}),
            ...(subjectDid ? { subjectDid } : {}),
          },
          resource: {
            resourceType: ResourceTypesFhirR4.OperationOutcome,
            meta: { claims: responseClaims },
            issue: [
              {
                severity: 'information',
                code: 'informational',
                diagnostics: 'License activation code issued.',
              },
            ],
          },
          // Expose activationCode explicitly so the admin can copy/paste (email/QR is out of scope for now).
          ...(activationCode ? { id: activationCode } : {}),
        } as any);
      } catch (e: any) {
        responseEntries.push({
          type: GatewayResponseEntryTypes.LicenseIssued,
          resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
          response: {
            status: String(HttpStatusCodes.BadRequest),
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, e?.message || String(e)),
          },
        } as any);
      }
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: 'batch-response',
      data: responseEntries,
    };

    return {
      jti: uuidv4(),
      thid: String(thid),
      type: 'transaction-response',
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
  }

  /**
   * Applies the member-seat lifecycle after issuance.
   *
   * Security and product rules:
   * - `_accept` requires the Firebase/BFF verified email or phone to match the
   *   recipient stored when the code was issued;
   * - `_deactivate` keeps the seat assigned so accidental removal can be
   *   recovered without consuming another seat;
   * - `_release` refuses active seats and clears assignment only after the
   *   relationship has been disabled or while an invitation is still pending.
   */
  private async transitionIndividualMemberLicense(
    job: JobRequest,
    action: '_accept' | '_deactivate' | '_release',
  ): Promise<IDecodedDidcommPayload> {
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const body = job.content?.body as any;
    const entries: any[] = (Array.isArray(body?.data) && body.data) || (Array.isArray(body?.entry) && body.entry) || [];
    const responseEntries: any[] = [];

    for (const entry of entries) {
      const rawClaims = entry?.resource?.meta?.claims as Record<string, unknown> | undefined;
      try {
        const claims = normalizeContextualizedClaims(rawClaims || {});
        const licenseSelector = String(
          getClaimValue<string>(claims, 'org.schema.IndividualProduct.serialNumber') || entry?.id || '',
        ).trim();
        const ownerOrganizationId = String(entry?.meta?.ownerOrganizationId || '').trim();
        if (!licenseSelector || (action !== '_accept' && !ownerOrganizationId)) {
          throw new ManagerError(
            action === '_accept'
              ? '_accept requires an invitation code.'
              : `${action} requires a license selector and ownerOrganizationId.`,
            IssueType.Required,
          );
        }
        const documents = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
          tenantVaultId,
          getEnvSectionId('device-licenses'),
        );
        const document = documents.find((candidate) => {
          const license = candidate.content as DeviceLicense | undefined;
          if (!license) return false;
          const selectorMatches = action === '_accept'
            ? license.activationCode === licenseSelector
            : license.activationCode === licenseSelector || license.id === licenseSelector;
          return selectorMatches
            && (!ownerOrganizationId || license.ownerOrganizationId === ownerOrganizationId)
            && license.userClass === LICENSE_USER_CLASS_INDIVIDUAL;
        });
        if (!document) throw new ManagerError('Individual member license invitation was not found.', IssueType.NotFound);
        const license = document.content as DeviceLicense & Record<string, any>;

        if (action === '_accept') {
          if (license.status !== LICENSE_STATUS_ISSUED) {
            throw new ManagerError('Only an issued invitation can be accepted.', IssueType.Conflict);
          }
          const subjectId = String(entry?.meta?.subjectId || '').trim();
          const verifiedActorIdentifier = String(entry?.meta?.verifiedActorIdentifier || '').trim();
          if (!subjectId || !verifiedActorIdentifier) {
            throw new ManagerError('_accept requires subjectId and verifiedActorIdentifier.', IssueType.Required);
          }
          const expectedEmail = String(license.issuedToEmail || '').trim().toLowerCase();
          const expectedPhone = String(license.issuedToPhone || '').replace(/[\s()-]/g, '');
          const verifiedEmail = verifiedActorIdentifier.toLowerCase();
          const verifiedPhone = verifiedActorIdentifier.replace(/[\s()-]/g, '');
          if (verifiedEmail !== expectedEmail && verifiedPhone !== expectedPhone) {
            throw new ManagerError('Authenticated actor does not match the invitation recipient.', IssueType.Forbidden);
          }
          const acceptedContactKind = expectedEmail && verifiedEmail === expectedEmail ? 'email' : 'phone';
          const acceptedContact = acceptedContactKind === 'email' ? expectedEmail : expectedPhone;
          license.status = LICENSE_STATUS_ACTIVE;
          license.subjectId = subjectId;
          license.activatedBy = buildStableActorIdentifier({
            contactKind: acceptedContactKind,
            contact: acceptedContact,
          });
          license.activatedAt = Math.floor(Date.now() / 1000);
          document.status = LICENSE_STATUS_ACTIVE;
        } else if (action === '_deactivate') {
          if (license.status !== LICENSE_STATUS_ACTIVE) {
            throw new ManagerError('Only an active member license can be deactivated.', IssueType.Conflict);
          }
          license.status = 'inactive';
          document.status = 'inactive';
        } else {
          if (license.status === LICENSE_STATUS_ACTIVE) {
            throw new ManagerError('Active member license must be deactivated before release.', IssueType.Conflict);
          }
          if (license.status !== LICENSE_STATUS_ISSUED && license.status !== 'inactive') {
            throw new ManagerError('Only an issued or inactive member license can be released.', IssueType.Conflict);
          }
          license.status = LICENSE_STATUS_AVAILABLE;
          document.status = LICENSE_STATUS_AVAILABLE;
          delete license.activationCode;
          delete license.issuedToEmail;
          delete license.issuedToPhone;
          delete license.issuedToRole;
          delete license.issuedAt;
          delete license.activatedAt;
          delete license.subjectId;
          delete license.invitationId;
          delete license.relatedPersonId;
          delete license.deviceId;
          delete license.deviceInfo;
        }
        document.sequence = Number(document.sequence || 0) + 1;
        await this.vaultRepository.put(tenantVaultId, [document], getEnvSectionId('device-licenses'));
        responseEntries.push({
          type: `License:${action.slice(1)}`,
          id: licenseSelector,
          response: { status: String(HttpStatusCodes.Ok) },
          meta: {
            licenseId: document.id,
            ownerOrganizationId: license.ownerOrganizationId,
            ...(license.authorizedSubjectDid ? { authorizedSubjectDid: license.authorizedSubjectDid } : {}),
          },
          resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
        });
      } catch (error: any) {
        responseEntries.push(this.buildLicenseErrorEntry(error, rawClaims));
      }
    }
    return this.buildLicenseResponse(job, responseEntries);
  }

  /** Builds one stable batch response for individual license operations. */
  private buildLicenseResponse(job: JobRequest, data: any[]): IDecodedDidcommPayload {
    return {
      jti: uuidv4(),
      thid: String(job.content?.thid || uuidv4()),
      type: 'transaction-response',
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: { resourceType: 'Bundle', type: 'batch-response', data },
    };
  }

  /** Converts one per-entry validation/lifecycle error into OperationOutcome. */
  private buildLicenseErrorEntry(error: any, claims?: Record<string, unknown>): any {
    const issueType = error instanceof ManagerError ? error.code : IssueType.Invalid;
    const status = error instanceof ManagerError ? error.status : '400';
    return {
      type: 'License:Error',
      resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: claims || {} } },
      response: {
        status,
        outcome: createOperationOutcome(IssueLevel.Error, issueType, error?.message || String(error)),
      },
    };
  }

  /**
   * Accepts both FHIR-style request wrappers and shared claims-first search
   * entries so the GW route can serve current SDK/common-utils helpers.
   */
  private extractLicenseSearchFilters(entry: any): ReturnType<typeof extractLicenseSearchFilters> {
    return extractLicenseSearchFilters(entry);
  }

  /**
   * Extracts canonical resource search claims for error reporting.
   */
  private extractLicenseSearchMetaClaims(entry: any): Record<string, unknown> {
    return extractLicenseSearchMetaClaims(entry);
  }

  /**
   * Returns one frontend-friendly search row shape compatible with the shared
   * `readLicenseListRecords(...)` reader.
   */
  private async searchLicenseDocuments(
    tenantVaultId: string,
    filters: ReturnType<typeof extractLicenseSearchFilters>,
  ): Promise<Array<Record<string, unknown>>> {
    return searchLicenseDocuments(
      this.vaultRepository,
      tenantVaultId,
      filters,
      this.kmsService
        ? (document, vaultId) => this.kmsService!.unprotectConfidentialData<DeviceLicense & Record<string, unknown>>(
            document,
            vaultId,
          )
        : undefined,
    );
  }

  /**
   * Projects one stored `DeviceLicense` document into the shared
   * schema.org-flavored claim shape expected by list/search readers.
   */
  private buildLicenseSearchClaims(license: DeviceLicense & Record<string, any>): Record<string, unknown> {
    return buildLicenseSearchClaims(license);
  }

  /**
   * Applies all requested search filters to one stored seat.
   */
  private matchesLicenseFilters(
    license: (DeviceLicense & Record<string, any>) | undefined,
    filters: ReturnType<typeof extractLicenseSearchFilters>,
  ): boolean {
    return matchesLicenseFilters(license, filters);
  }

  /**
   * Resolves one concrete filter key into the comparable string values exposed
   * by the current storage model.
   */
  private resolveLicenseFilterValues(
    license: DeviceLicense & Record<string, any>,
    key: string,
  ): string[] {
    return resolveLicenseFilterValues(license, key);
  }

  /**
   * Maps runtime user-class storage to the schema.org-style license family
   * value already used by shared readers/builders.
   */
  private mapLicenseCategory(userClass: string | undefined): string {
    return mapLicenseCategory(userClass);
  }

  /**
   * Normalizes one optional scalar into the common string-array form used by
   * the search matcher.
   */
  private toFilterValues(value: unknown): string[] {
    return toFilterValues(value);
  }
}
