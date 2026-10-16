// src/managers/EmployeeManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { getHealthcareRoleByClaim } from 'gdc-common-utils-ts/constants/healthcare';

import { v4 as uuidv4 } from 'uuid';
import {
  buildOrganizationAuthorizationUrnCds,
  buildOrganizationEmployeeAuthorizationUrnCds,
  FhirIpsCreatorKinds,
  OrganizationEmployeeSearchResponseEntryTypes,
  normalizeUuid,
} from 'gdc-common-utils-ts';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { determineResourceId } from '../utils/resource';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { initializeEmployeeServices } from '../utils/services';
import { createOperationOutcome } from '../utils/outcome';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { BundleEntry, ErrorEntry, BundleEntryRequest, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { ClaimsRecord, RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { ParameterData } from 'gdc-common-utils-ts/models/params';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { DidDocument, VerificationMethod } from '../gdc-backend-utils-node/models/did';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { EntityLifecycleStatus, EntityType } from '../gdc-backend-utils-node/models/enums';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { generateLicenseOffer } from '../utils/offer';
import { getEnvSectionId } from '../utils/section-env';
import { getPersonOccupationClaim } from '../utils/occupation';
import { createEmployeeUrn, parseTenantUrn } from '../utils/urn';
import { normalizeIndexedEmail } from '../utils/indexed-contact';
import { extractSearchFiltersFromEntry } from '../utils/search-request';
import type { ITenantsManager } from './ITenantsManager';
import type { ITenantDidRegistryMutator } from './ITenantDidRegistryMutator';
import type { IHostRuntime } from './IHostRuntime';
import { buildOfferOrderIndexedAttributes } from '../utils/offer-order-read-model';
import { buildSearchResponseEntries } from '../utils/didcomm-response';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { normalizePublicAliasList } from 'gdc-common-utils-ts/utils/same-as';
import type { ClinicalCreatorBinding } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { getClinicalCreatorBindingsSectionId } from '../utils/clinical-creator-binding';
import { canonicalizeBundleEntryMetadata } from '../utils/canonical-entry-metadata';
import { requireExplicitLifecycleResourceId } from '../utils/lifecycle-resource-id';
import {
  ACTION_PURGE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_USER_CLASS_EMPLOYEE,
} from '../constants/domain';

const EMPLOYEE_SECTION = getEnvSectionId('employees');
const DEVICE_LICENSE_SECTION = getEnvSectionId('device-licenses');

function canonicalUuidUrn(value: string): string | undefined {
  const hex = normalizeUuid(value);
  if (!hex) return undefined;
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return `urn:uuid:${uuid}`;
}

export class EmployeeManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsManager: Pick<ITenantsManager, 'getTenantIdentifierUrn' | 'getCollectionName'>;
  private tenantDidRegistryMutator: ITenantDidRegistryMutator;
  private hostRuntime: IHostRuntime;

  /**
   * Creates an employee manager with only the minimum tenant/host capabilities
   * required by the current onboarding and offer flows.
   *
   * Design note:
   * - this manager must not receive `TenantsCacheManager` directly
   * - it only needs:
   *   - tenant URN resolution for response `iss`
   *   - a narrow DID-registry mutator to publish child verification methods
   *   - host runtime scalars for host-owned offers
   *
   * Security boundary:
   * - no decrypted tenant config
   * - no general tenant lookup API
   * - no direct access to tenant secrets or registry records
   */
  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsManager: Pick<ITenantsManager, 'getTenantIdentifierUrn' | 'getCollectionName'>,
    tenantDidRegistryMutator: ITenantDidRegistryMutator,
    hostRuntime: IHostRuntime,
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsManager = tenantsManager;
    this.tenantDidRegistryMutator = tenantDidRegistryMutator;
    this.hostRuntime = hostRuntime;
  }

  public async process(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    if (!job.content) {
      throw new ManagerError('Job content is missing', IssueType.Required);
    }
    const body = job.content.body as any;
    const entries = body?.data ?? [];

    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Job is missing required tenantId or sector.', IssueType.Required);
    }
    const vaultId = getTenantVaultId(job.sector, job.tenantId);

    // Fetch the tenant's URN once for the entire job.
    const issuerUrn = await this.tenantsManager.getTenantIdentifierUrn(vaultId);
    if (!issuerUrn) {
      throw new ManagerError(`Tenant with ID '${job.tenantId}' not found.`, IssueType.NotFound);
    }
    const employeeCollectionName = await this.tenantsManager.getCollectionName(vaultId) || vaultId;

    if (!job.content.meta) {
      // This should ideally never happen if the request passed through the security layer.
      throw new ManagerError('Job is missing cryptographic metadata.', IssueType.Invalid);
    }

    if (job.action === '_search') {
      return this.processSearch(job, employeeCollectionName, vaultId, issuerUrn);
    }

    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    for (const entry of entries) {
      try {
        // Pass the fetched URN and the job metadata down to the entry processor.
        const resultEntry = await this.processEntry(
          entry,
          job.action,
          vaultId,
          employeeCollectionName,
          String(job.tenantId || ''),
          issuerUrn,
          job.content.meta,
          job.contentType,
          environment,
          job.sector,
          job.jurisdiction,
        );
        responseEntries.push(resultEntry);
      } catch (error: any) {
        const errorEntry = this.handleError(error, entry.type, (entry as BundleEntryRequest).meta);
        responseEntries.push(errorEntry);
      }
    }

    const responseBundle: BundleJsonApi = {
      data: responseEntries,
      resourceType: ResourceTypesFhirR4.Bundle,
      total: responseEntries.length,
      type: getBundleResponseTypeForAction(job.action),
    };

    const result: IDecodedDidcommPayload = {
      jti: uuidv4(),
      thid: job.content.thid as string,
      iss: issuerUrn, // Use the tenant's URN as the issuer
      aud: job.content.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'batch-response',
      body: responseBundle,
    };
    return result;
  }

  private async processSearch(
    job: JobRequest,
    employeeCollectionName: string,
    tenantVaultId: string,
    issuerUrn: string,
  ): Promise<IDecodedDidcommPayload> {
    const body = job.content?.body as any;
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];

    if (entries.length === 0) {
      throw new ManagerError('Employee search requires at least one Bundle.entry request.', IssueType.Required);
    }

    for (const entry of entries) {
      try {
        responseEntries.push(...await this.processSearchEntry(employeeCollectionName, tenantVaultId, entry));
      } catch (error: any) {
        responseEntries.push(this.handleError(error, 'Employee-search-response-v1.0', entry?.meta));
      }
    }

    return {
      jti: uuidv4(),
      thid: job.content?.thid as string,
      iss: issuerUrn,
      aud: job.content?.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'search-response',
      body: {
        data: responseEntries,
        resourceType: ResourceTypesFhirR4.Bundle,
        total: responseEntries.length,
        type: getBundleResponseTypeForAction(job.action),
      },
    };
  }

  private async processSearchEntry(
    employeeCollectionName: string,
    tenantVaultId: string,
    entry: any,
  ): Promise<BundleEntry[]> {
    const filters = extractSearchFiltersFromEntry(entry, 'Employee');
    const matches = await this.searchEmployees(employeeCollectionName, tenantVaultId, filters);

    return buildSearchResponseEntries(OrganizationEmployeeSearchResponseEntryTypes.Employee, matches);
  }

  private async searchEmployees(
    employeeCollectionName: string,
    tenantVaultId: string,
    filters: Record<string, string[]>,
  ): Promise<Array<Record<string, unknown>>> {
    const docs =
      (await this.vaultRepository.getContainersInSection<any>(employeeCollectionName, EMPLOYEE_SECTION)) || [];
    const matches: Array<Record<string, unknown>> = [];
    const occupationsByEmployeeId = new Map<string, Array<Record<string, unknown>>>();
    for (const doc of docs) {
      if (String(doc?.type || '').trim() !== 'Occupation') continue;
      const employeeId = String(doc?.employeeId || '').trim();
      if (!employeeId) continue;
      occupationsByEmployeeId.set(employeeId, [
        ...(occupationsByEmployeeId.get(employeeId) || []),
        doc,
      ]);
    }

    for (const doc of docs) {
      if (!doc?.content && !doc?.jwe) continue;
      try {
        const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(doc, tenantVaultId);
        if (!employee?.claims || employee.type !== EntityType.Person) continue;
        // Purge keeps a minimal protected tombstone for lifecycle audit and
        // descendant accounting, but terminal records are not current members
        // and must not reappear in the default employee directory.
        if (this.isPurgedEmployee(employee)) continue;
        if (!this.matchesEmployeeFilters(employee, filters)) continue;

        matches.push({
          id: employee.id,
          status: employee.status,
          claims: employee.claims,
          meta: employee.meta,
          ...(occupationsByEmployeeId.get(String(employee.id || '').trim())?.length
            ? { contained: occupationsByEmployeeId.get(String(employee.id || '').trim()) }
            : {}),
        });
      } catch {
        continue;
      }
    }

    return matches;
  }

  private matchesEmployeeFilters(
    employee: EntityConfig,
    filters: Record<string, string[]>,
  ): boolean {
    const claims = (employee.claims || {}) as ClaimsRecord;
    const entries = Object.entries(filters);
    if (entries.length === 0) return true;

    return entries.every(([key, expectedValues]) => {
      const actualValue = this.resolveEmployeeSearchValue(claims, key);
      if (!actualValue) return false;
      return expectedValues.includes(actualValue);
    });
  }

  private resolveEmployeeSearchValue(claims: ClaimsRecord, key: string): string | undefined {
    if (key === ClaimsPersonSchemaorg.hasOccupation || key === ClaimsPersonSchemaorg.hasOccupationalRoleValue) {
      return getPersonOccupationClaim(claims) || undefined;
    }

    const rawValue = claims[key];
    if (rawValue === undefined || rawValue === null) return undefined;
    return String(rawValue).trim() || undefined;
  }

  private async processEntry(
    entry: BundleEntry,
    action: string | undefined,
    tenantVaultId: string,
    employeeCollectionName: string,
    tenantId: string,
    tenantUrn: string,
    meta: IDecodedDidcommPayload['meta'],
    contentType?: string,
    environment?: string,
    sector?: string,
    jurisdiction?: string,
  ): Promise<BundleEntry> {
    const requestEntry = entry as BundleEntryRequest;
    const { request, type } = requestEntry;
    const claims = requestEntry.resource?.meta?.claims;

    if (!request) {
      throw new ManagerError('Entry requires a request object.', IssueType.Required);
    }

    const resolvedEmployeeId = this.resolveEmployeeId(requestEntry, environment);
    if (!resolvedEmployeeId) {
      throw new ManagerError('Employee entry requires resource.id or identifier claim.', IssueType.Required);
    }
    const employeeId = requireExplicitLifecycleResourceId(resolvedEmployeeId, 'Employee lifecycle');

    switch (request.method) {
      case 'POST':
        if (action === ACTION_PURGE) {
          return this.purgeEmployee(employeeCollectionName, tenantVaultId, employeeId, claims || {}, type);
        }
        if (!claims) {
          throw new ManagerError('Entry requires resource.meta.claims.', IssueType.Required);
        }
        return this.createEmployee(
          tenantVaultId,
          employeeCollectionName,
          tenantId,
          tenantUrn,
          employeeId,
          claims,
          type,
          meta,
          contentType,
        );
      case 'DELETE':
        return this.disableEmployee(employeeCollectionName, tenantVaultId, employeeId, type);
      default:
        throw new ManagerError(`Unsupported request method: '${request.method}'`, IssueType.NotSupported);
    }
  }

  private resolveEmployeeId(entry: BundleEntryRequest, environment?: string): string | undefined {
    const explicitResourceId = String((entry as any)?.resource?.id || '').trim();
    if (explicitResourceId) return explicitResourceId;

    const identifierClaim = entry.resource?.meta?.claims?.[ClaimsPersonSchemaorg.identifier];
    if (typeof identifierClaim !== 'string' || !identifierClaim.trim()) {
      return undefined;
    }

    return determineResourceId(identifierClaim, environment);
  }

  private async createEmployee(
    tenantVaultId: string,
    employeeCollectionName: string,
    tenantId: string,
    tenantUrn: string,
    employeeId: string,
    claims: ClaimsRecord,
    entryType: string,
    jobMeta: IDecodedDidcommPayload['meta'],
    contentType?: string,
  ): Promise<BundleEntry> {
    let signerJwk: PublicJwk | undefined;
    let encrypterJwk: PublicJwk | undefined;

    const email = normalizeIndexedEmail(claims[ClaimsPersonSchemaorg.email]);
    if (!email) {
      throw new ManagerError('Missing or invalid email claim.', IssueType.Required);
    }

    const roleCode = getPersonOccupationClaim(claims); // canonical: hasOccupation.identifier.value (+ optional system)
    if (!roleCode) {
      throw new ManagerError('Missing or invalid hasOccupation claim.', IssueType.Required);
    }

    const existingEmployee = await this.findEmployeeByEmailAndRole(employeeCollectionName, tenantVaultId, email, roleCode);
    if (existingEmployee) {
      return this.upsertExistingEmployee(existingEmployee, employeeCollectionName, tenantVaultId, claims, entryType);
    }

    const parsedTenantUrn = parseTenantUrn(tenantUrn);
    if (!parsedTenantUrn) {
      throw new ManagerError(`Invalid tenant URN format: '${tenantUrn}'`, IssueType.Value);
    }

    // Employee/_batch POST is the licensed interactive operation. A future
    // bulk importer must have its own explicit operation contract; it must not
    // hide import semantics in Person claims or bypass seat ordering here.
    const licenseOffer = await this.requireAvailableEmployeeSeatOrOffer({
      vaultId: tenantVaultId,
      tenantId,
      sector: parsedTenantUrn.sector,
      jurisdiction: parsedTenantUrn.jurisdiction,
    });
    if (licenseOffer) return licenseOffer;

    const employeeUrnForKeys = createEmployeeUrn({
      namespace: parsedTenantUrn.namespace,
      network: parsedTenantUrn.network,
      jurisdiction: parsedTenantUrn.jurisdiction,
      version: parsedTenantUrn.version,
      sector: parsedTenantUrn.sector,
      idType: parsedTenantUrn.idType,
      idValue: parsedTenantUrn.idValue,
      email,
      role: roleCode,
      instanceId: employeeId,
    });

    // The flow for obtaining the employee's public keys depends on the request type.
    if (contentType?.includes('json')) {
      // LEGACY FLOW: The request is unencrypted. The system must provision keys for the new employee.
      // We use the employee's URN as the identifier for the new key set.
      const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
      signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
      encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        throw new ManagerError('Failed to provision keys for new employee in legacy flow.', IssueType.Exception);
      }
    } else {
      // SECURE FLOW: The request is encrypted.
      // If the client provides embedded JWKs, use them; otherwise provision keys server-side.
      signerJwk = jobMeta?.jws?.protected?.jwk as PublicJwk;
      encrypterJwk = jobMeta?.jwe?.header?.jwk as PublicJwk;

      if (!signerJwk || !encrypterJwk) {
        const provisionedKeys = await this.kmsService.provisionKeys(employeeUrnForKeys);
        signerJwk = provisionedKeys.keys.find(k => k.kty === 'AKP') as PublicJwk;
        encrypterJwk = provisionedKeys.keys.find(k => k.kty === 'OKP') as PublicJwk;
      }
    }

    // Additional validation to ensure the keys have kids
    if (!signerJwk.kid || !encrypterJwk.kid) {
      throw new ManagerError('Embedded JWKs must have a "kid" property.', IssueType.Required);
    }

    // Construct the hierarchical URN using the parent tenant's URN.
    const employeeUrn = employeeUrnForKeys;
    const organizationAuthorizationUrn = buildOrganizationAuthorizationUrnCds({
      jurisdiction: parsedTenantUrn.jurisdiction,
      version: parsedTenantUrn.version,
      identifierType: parsedTenantUrn.idType,
      identifierValue: parsedTenantUrn.idValue,
    });
    const employeeAuthorizationUrn = buildOrganizationEmployeeAuthorizationUrnCds({
      organizationUrn: organizationAuthorizationUrn,
      employeeUuid: employeeId,
      roleCode: normalizeCodeSystemAndValue(roleCode).split(/[:|]/).pop() || '',
    });
    const employeeAliases = normalizePublicAliasList(claims[ClaimsPersonSchemaorg.sameAs]);

    // Create verification methods from the provided JWKs
    const verificationMethods: VerificationMethod[] = [
      {
        id: `${employeeUrn}#${signerJwk.kid}`,
        type: 'JsonWebKey',
        controller: employeeUrn,
        publicKeyJwk: signerJwk as PublicJwk,
      },
      {
        id: `${employeeUrn}#${encrypterJwk.kid}`,
        type: 'JsonWebKey',
        controller: employeeUrn,
        publicKeyJwk: encrypterJwk as PublicJwk,
      },
    ];

    const employeeDidDocument: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: employeeUrn,
      alsoKnownAs: Array.from(new Set([employeeAuthorizationUrn, ...employeeAliases])),
      verificationMethod: verificationMethods,
      authentication: [verificationMethods[0].id],
      keyAgreement: [verificationMethods[1].id],
      service: [],
    };
    
    // Also add these keys to the parent tenant's DID Document for resolution.
    // This allows others to find the employee's keys by querying the tenant's DID.
    this.tenantDidRegistryMutator.addVerificationMethodToTenant(tenantVaultId, verificationMethods[0]);
    this.tenantDidRegistryMutator.addVerificationMethodToTenant(tenantVaultId, verificationMethods[1]);

    const employeeConfig: EntityConfig = {
      id: employeeId,
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims,
      didDocument: employeeDidDocument,
      didConfig: { // didConfig property is required by EntityConfig
        service: []
      },
      meta: {
        lastUpdated: new Date().toISOString(),
      },
    };

    employeeConfig.didDocument!.service = initializeEmployeeServices(employeeConfig);
    
    // Also, update the didConfig with the same services.
    employeeConfig.didConfig!.service = employeeConfig.didDocument!.service;

    const occupationDoc: IncludedResource & { employeeId: string } = {
      id: uuidv4(),
      type: 'Occupation',
      employeeId: employeeId,
      meta: {
        claims: {
          [ClaimsPersonSchemaorg.hasOccupation]: roleCode,
        },
      },
    };

    const attributesToIndex: ParameterData[] = [
      { name: 'email', value: email, unique: true, type: 'string'},
      // The role code is normalized before HMAC to ensure consistent searching.
      { name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token'},
      { name: 'kid', value: signerJwk.kid, unique: false, type: 'string'},
      { name: 'kid', value: encrypterJwk.kid, unique: false, type: 'string'},
      ...employeeAliases.map((alias) => ({
        name: ClaimsPersonSchemaorg.sameAs,
        value: alias,
        unique: false,
        type: 'string',
      } as ParameterData)),
    ];
    
    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(attributesToIndex, tenantVaultId);

    const docToProtect: ConfidentialStorageDoc = {
      id: employeeConfig.id,
      status: employeeConfig.status,
      sequence: 0,
      content: employeeConfig,
      indexed: { attributes: protectedAttributes },
      audit: {
        updated: employeeConfig.meta?.lastUpdated,
      } as any,
    };
    
    // The tenant's vaultId is used for the security context.
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, tenantVaultId);
    await this.vaultRepository.put(employeeCollectionName, [secureDoc, occupationDoc], EMPLOYEE_SECTION);
    await this.persistProfessionalClinicalCreatorBinding({
      tenantVaultId,
      employeeId,
      occupationId: occupationDoc.id,
      ownerIdentifier: organizationAuthorizationUrn,
      role: roleCode,
      email,
    });

    return {
      type: entryType,
      resource: {
        id: employeeId,
        type: ResourceTypesFhirR4.Person,
        meta: { claims: claims },
        contained: [occupationDoc],
      },
      response: { status: String(HttpStatusCodes.Created) },
    };
  }

  /**
   * Preauthorizes the stable FHIR-export identity behind an employee profile.
   *
   * Employee and Occupation remain the native GW records. Their UUIDs project
   * to Practitioner and PractitionerRole only when an IPS is exported. Email,
   * operational DID, DCR client and key identifiers are lookup aliases and do
   * not become the clinical author identity.
   */
  private async persistProfessionalClinicalCreatorBinding(params: {
    tenantVaultId: string;
    employeeId: string;
    occupationId: string;
    ownerIdentifier?: string;
    role: string;
    email: string;
  }): Promise<void> {
    if (!getHealthcareRoleByClaim(params.role)) return;
    const actorIdentifier = canonicalUuidUrn(params.employeeId);
    const authorIdentifier = canonicalUuidUrn(params.occupationId);
    const ownerIdentifier = String(params.ownerIdentifier || '').trim();
    if (!actorIdentifier || !authorIdentifier || !ownerIdentifier) return;

    const binding: ClinicalCreatorBinding & { id: string } = {
      id: authorIdentifier,
      kind: FhirIpsCreatorKinds.Professional,
      actorIdentifier,
      authorIdentifier,
      ownerIdentifier,
      role: params.role,
      verifiedContactIdentifiers: [buildStableActorIdentifier({
        contactKind: 'email',
        contact: params.email,
      })],
    };
    await this.vaultRepository.put(
      params.tenantVaultId,
      [binding],
      getClinicalCreatorBindingsSectionId(),
    );
  }

  /**
   * Finds an existing employee by its functional business identity.
   *
   * In v1, employee onboarding is treated as an idempotent/upsert-like flow keyed by
   * `email + role`. The physical record id can still vary across payloads, but the
   * business identity must not create duplicates for the same role assignment.
   */
  private async findEmployeeByEmailAndRole(
    employeeCollectionName: string,
    tenantVaultId: string,
    email: string,
    roleCode: string,
  ): Promise<ConfidentialStorageDoc | undefined> {
    const queryAttributes: ParameterData[] = [
      { name: 'email', value: email, unique: true, type: 'string' },
      { name: 'role', value: normalizeCodeSystemAndValue(roleCode), unique: false, type: 'token' },
    ];

    const protectedAttributes = await this.kmsService.protectAttributesNameAndValue(queryAttributes, tenantVaultId);
    const results = await this.vaultRepository.query(employeeCollectionName, {
      sectionId: EMPLOYEE_SECTION,
      where: protectedAttributes.map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
      })),
    });
    const candidates = ((results || []) as ConfidentialStorageDoc[])
      .sort((left, right) => Number(right?.sequence || 0) - Number(left?.sequence || 0));

    let inactiveMatch: ConfidentialStorageDoc | undefined;
    for (const doc of candidates) {
      try {
        const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(doc, tenantVaultId);
        if (this.isPurgedEmployee(employee)) continue;
        if (employee.status === EntityLifecycleStatus.Active) return doc;
        if (!inactiveMatch) inactiveMatch = doc;
      } catch {
        continue;
      }
    }

    return inactiveMatch;
  }

  /**
   * Applies v1 upsert semantics for an existing employee record.
   *
   * - active existing employee: return the current record without consuming another seat
   * - inactive existing employee: reactivate it and update claims/metadata in place
   *
   * This keeps `disable` aligned with suspension semantics rather than duplicate recreation.
   */
  private async upsertExistingEmployee(
    employeeDoc: ConfidentialStorageDoc,
    employeeCollectionName: string,
    tenantVaultId: string,
    claims: ClaimsRecord,
    entryType: string,
  ): Promise<BundleEntry> {
    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, tenantVaultId);
    const isActive = employee.status === EntityLifecycleStatus.Active;

    if (!isActive) {
      employee.status = EntityLifecycleStatus.Active;
      employee.claims = claims;
      employee.meta = {
        ...(employee.meta || {}),
        lastUpdated: new Date().toISOString(),
      };

      const docToProtect: ConfidentialStorageDoc = {
        ...employeeDoc,
        status: employee.status,
        sequence: (employeeDoc.sequence || 0) + 1,
        content: employee,
        audit: {
          ...(employeeDoc.audit || {}),
          updated: employee.meta?.lastUpdated,
          deactivated: false,
        } as any,
      };
      const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, tenantVaultId);
      await this.vaultRepository.put(employeeCollectionName, [secureDoc], EMPLOYEE_SECTION);
    }

    return {
      type: entryType,
      resource: {
        id: employee.id,
        type: ResourceTypesFhirR4.Person,
        meta: { claims: isActive ? employee.claims : claims },
      },
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  /** Current create gate; `License/_issue` remains the sole seat mutation. */
  private async requireAvailableEmployeeSeatOrOffer(params: {
    vaultId: string;
    tenantId: string;
    sector: string;
    jurisdiction: string;
  }): Promise<BundleEntry | undefined> {
    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
        params.vaultId,
        DEVICE_LICENSE_SECTION,
      )) || [];

    const employeeLicenseDocs = licenseDocs.filter((doc) => (doc.content as DeviceLicense | undefined)?.userClass === LICENSE_USER_CLASS_EMPLOYEE);
    const availableDoc = employeeLicenseDocs.find((doc) => (doc.content as DeviceLicense).status === LICENSE_STATUS_AVAILABLE);
    if (!availableDoc) {
      const allowedPaymentMethods = (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(',').map(s => s.trim()).filter(Boolean);
      const offerClaims = generateLicenseOffer(
        1,
        this.hostRuntime.hostDid,
        params.jurisdiction,
        params.sector,
        allowedPaymentMethods,
        LICENSE_USER_CLASS_EMPLOYEE,
      );
      offerClaims[ClaimsOrganizationSchemaorg.alternateName] = params.tenantId;
      await this.persistHostCommercialOffer(offerClaims);

      return {
        type: GatewayResponseEntryTypes.EmployeeLicenseOffer,
        resource: { meta: { claims: offerClaims } },
        response: { status: String(HttpStatusCodes.Ok) },
      };
    }

    return undefined;
  }

  private async persistHostCommercialOffer(claims: Record<string, unknown>): Promise<void> {
    const offerId = String(claims[ClaimsOfferSchemaorg.identifier] || '').trim();
    if (!offerId) return;

    const communicationDoc: ConfidentialStorageDoc & { meta?: { claims: Record<string, unknown> } } = {
      id: offerId,
      status: EntityLifecycleStatus.Active,
      sequence: 0,
      meta: { claims },
      indexed: {
        attributes: buildOfferOrderIndexedAttributes(claims),
        hmac: { id: 'urn:unsupported', type: 'Sha256HmacKey2019' },
      },
      content: { claims },
    };
    const secureCommunicationDoc = await this.kmsService.protectConfidentialData(communicationDoc, 'host');
    await this.vaultRepository.put(this.hostRuntime.hostCollectionName, [secureCommunicationDoc], getEnvSectionId('communications'));
  }

  private async disableEmployee(employeeCollectionName: string, tenantVaultId: string, employeeId: string, entryType: string): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(employeeCollectionName, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, tenantVaultId);
    employee.status = EntityLifecycleStatus.Inactive;

    const docToProtect: ConfidentialStorageDoc = {
      ...employeeDoc,
      status: employee.status,
      sequence: (employeeDoc.sequence || 0) + 1,
      content: employee,
      audit: {
        ...(employeeDoc.audit || {}),
        updated: new Date().toISOString(),
        deactivated: true,
      } as any,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, tenantVaultId);
    await this.vaultRepository.put(employeeCollectionName, [secureDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: { id: employeeId },
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  private async purgeEmployee(
    employeeCollectionName: string,
    tenantVaultId: string,
    employeeId: string,
    claims: ClaimsRecord,
    entryType: string,
  ): Promise<BundleEntry> {
    const employeeDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(employeeCollectionName, employeeId, EMPLOYEE_SECTION);
    if (!employeeDoc) {
      throw new ManagerError(`Employee with ID '${employeeId}' not found.`, IssueType.NotFound);
    }

    const employee = await this.kmsService.unprotectConfidentialData<EntityConfig>(employeeDoc, tenantVaultId);
    if (employee.status !== EntityLifecycleStatus.Inactive) {
      throw new ManagerError('Employee must be disabled before purge.', IssueType.Conflict);
    }

    await this.releaseEmployeeLicenses(tenantVaultId, employeeId, employee, claims);

    employee.meta = {
      ...(employee.meta || {}),
      lastUpdated: new Date().toISOString(),
      lifecycleDisposition: 'purged',
      purgedAt: new Date().toISOString(),
      licensingPurgedAt: new Date().toISOString(),
    };

    const docToProtect: ConfidentialStorageDoc = {
      ...employeeDoc,
      status: employee.status,
      sequence: (employeeDoc.sequence || 0) + 1,
      content: employee,
      audit: {
        ...(employeeDoc.audit || {}),
        updated: new Date().toISOString(),
        deactivated: true,
        disposition: 'purged',
      } as any,
    };
    const secureDoc = await this.kmsService.protectConfidentialData(docToProtect, tenantVaultId);
    await this.vaultRepository.put(employeeCollectionName, [secureDoc], EMPLOYEE_SECTION);

    return {
      type: entryType,
      resource: { id: employeeId },
      response: { status: String(HttpStatusCodes.Ok) },
    };
  }

  private async releaseEmployeeLicenses(
    vaultId: string,
    employeeId: string,
    employee: EntityConfig,
    claims: ClaimsRecord,
  ): Promise<void> {
    const email = normalizeIndexedEmail(
      employee.claims?.[ClaimsPersonSchemaorg.email]
      || claims?.[ClaimsPersonSchemaorg.email]
      || '',
    );
    const roleCode = normalizeCodeSystemAndValue(
      getPersonOccupationClaim(employee.claims as ClaimsRecord)
      || getPersonOccupationClaim(claims)
      || '',
    );

    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(vaultId, DEVICE_LICENSE_SECTION)) || [];
    const updatedDocs: ConfidentialStorageDoc[] = [];

    for (const doc of licenseDocs) {
      const license = doc.content as DeviceLicense & Record<string, any>;
      if (!license || license.userClass !== LICENSE_USER_CLASS_EMPLOYEE) {
        continue;
      }

      const matchesSubject = license.subjectId === employeeId;
      const matchesInvite = email
        && normalizeIndexedEmail(String(license.issuedToEmail || '')) === email
        && roleCode
        && normalizeCodeSystemAndValue(String(license.issuedToRole || '')) === roleCode;

      if (!matchesSubject && !matchesInvite) {
        continue;
      }

      const resetLicense: DeviceLicense & Record<string, any> = {
        ...license,
        status: LICENSE_STATUS_AVAILABLE,
      };
      delete resetLicense.subjectId;
      delete resetLicense.activationCode;
      delete resetLicense.issuedAt;
      delete resetLicense.issuedToEmail;
      delete resetLicense.issuedToRole;
      delete resetLicense.activatedAt;
      delete resetLicense.deviceId;
      delete resetLicense.deviceInfo;

      updatedDocs.push({
        ...doc,
        status: LICENSE_STATUS_AVAILABLE,
        sequence: (doc.sequence || 0) + 1,
        content: resetLicense,
      });
    }

    if (updatedDocs.length > 0) {
      await this.vaultRepository.put(vaultId, updatedDocs, DEVICE_LICENSE_SECTION);
    }
  }

  private isPurgedEmployee(employee: EntityConfig | undefined): boolean {
    if (!employee?.meta) return false;
    return employee.meta.lifecycleDisposition === 'purged' || Boolean(employee.meta.licensingPurgedAt);
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        ...canonicalizeBundleEntryMetadata(meta),
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    } else {
      console.error('Unexpected error during employee processing:', error);
      return {
        type: entryType,
        ...canonicalizeBundleEntryMetadata(meta),
        response: {
          status: String(HttpStatusCodes.InternalServerError),
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Exception,
            'An unexpected internal server error occurred.',
          ),
        },
      };
    }
  }
}
