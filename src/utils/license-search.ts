// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import {
  ClaimsIndividualProductSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsPersonSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { getEnvSectionId } from './section-env';
import { extractSearchFiltersFromEntry, type SearchFilters } from './search-request';
import {
  DEFAULT_LICENSE_DEVICE_ALLOWANCE,
  LICENSE_CATEGORY_INDIVIDUAL,
  LICENSE_CATEGORY_PROFESSIONAL,
  LICENSE_STATUS_ACTIVE,
  LICENSE_STATUS_AVAILABLE,
  LICENSE_STATUS_ISSUED,
  LICENSE_USER_CLASS_EMPLOYEE,
  LICENSE_USER_CLASS_INDIVIDUAL,
} from '../constants/domain';

type LicenseRow = Record<string, unknown>;

export type LicenseSearchRepository = {
  getContainersInSection(vaultId: string, sectionId: string): Promise<unknown[] | undefined>;
};

export type LicenseDocumentUnprotector = (
  document: ConfidentialStorageDoc,
  tenantVaultId: string,
) => Promise<DeviceLicense & Record<string, unknown>>;

/**
 * Extracts current GW license filters from either:
 * - a FHIR-like `Bundle.entry[].request.url + Parameters` envelope
 * - a shared claims-first entry built by `common-utils`
 */
export function extractLicenseSearchFilters(entry: BundleEntry | Record<string, unknown>): SearchFilters {
  const bundleEntry = entry as any;
  if (bundleEntry?.request?.url) {
    return extractSearchFiltersFromEntry(bundleEntry, 'License');
  }

  const filters: SearchFilters = {};
  const meta = bundleEntry?.meta && typeof bundleEntry.meta === 'object' ? bundleEntry.meta as Record<string, any> : {};
  const resource = bundleEntry?.resource && typeof bundleEntry.resource === 'object' ? bundleEntry.resource as Record<string, any> : {};
  const resourceMeta = resource.meta && typeof resource.meta === 'object' ? resource.meta as Record<string, any> : {};
  const claims = {
    ...(resourceMeta.claims && typeof resourceMeta.claims === 'object' ? resourceMeta.claims as Record<string, any> : {}),
    ...(meta.claims && typeof meta.claims === 'object' ? meta.claims as Record<string, any> : {}),
  };

  const push = (key: string, rawValue: unknown): void => {
    const values = String(rawValue || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (values.length > 0) {
      filters[key] = values;
    }
  };

  push(ClaimsOfferSchemaorg.serialNumber, claims[ClaimsOfferSchemaorg.serialNumber]);
  push(ClaimsIndividualProductSchemaorg.category, claims[ClaimsIndividualProductSchemaorg.category]);
  push(ClaimsIndividualProductSchemaorg.additionalType, claims[ClaimsIndividualProductSchemaorg.additionalType]);
  push(ClaimsPersonSchemaorg.email, claims[ClaimsPersonSchemaorg.email]);
  push(ClaimsPersonSchemaorg.telephone, claims[ClaimsPersonSchemaorg.telephone]);
  push(ClaimsPersonSchemaorg.hasOccupationalRoleValue, claims[ClaimsPersonSchemaorg.hasOccupationalRoleValue]);
  push('status', meta.status ?? resourceMeta.status);
  push('subjectId', meta.subjectId ?? resourceMeta.subjectId);
  push('ownerOrganizationId', meta.ownerOrganizationId ?? resourceMeta.ownerOrganizationId);
  push('orderId', claims[ClaimsOfferSchemaorg.identifier]);
  return filters;
}

/**
 * Extracts original license search claims for diagnostic/error payloads.
 */
export function extractLicenseSearchMetaClaims(entry: BundleEntry | Record<string, unknown>): Record<string, unknown> {
  const bundleEntry = entry as any;
  const meta = bundleEntry?.meta && typeof bundleEntry.meta === 'object' ? bundleEntry.meta as Record<string, any> : {};
  const resource = bundleEntry?.resource && typeof bundleEntry.resource === 'object' ? bundleEntry.resource as Record<string, any> : {};
  const resourceMeta = resource.meta && typeof resource.meta === 'object' ? resource.meta as Record<string, any> : {};
  return {
    ...(resourceMeta.claims && typeof resourceMeta.claims === 'object' ? resourceMeta.claims as Record<string, unknown> : {}),
    ...(meta.claims && typeof meta.claims === 'object' ? meta.claims as Record<string, unknown> : {}),
  };
}

/**
 * Reads one tenant `device-licenses` pool and projects matching seats into the
 * row format expected by current shared SDK readers.
 *
 * TODO(pagination-high-level-first):
 * GW currently returns the full matching set. Introduce page/limit/date-range
 * semantics only after shared `common-utils` and BFF contracts define the
 * canonical UX-facing behavior.
 */
export async function searchLicenseDocuments(
  repository: LicenseSearchRepository,
  tenantVaultId: string,
  filters: SearchFilters,
  unprotect?: LicenseDocumentUnprotector,
): Promise<LicenseRow[]> {
  const storedDocuments =
    (await repository.getContainersInSection(
      tenantVaultId,
      getEnvSectionId('device-licenses'),
    )) as ConfidentialStorageDoc[] || [];
  const resolvedDocuments = await Promise.allSettled(storedDocuments.map(async (document) => {
    if (isDeviceLicense(document.content)) return document;
    if (!unprotect) {
      throw new Error('Encrypted device license cannot be searched without KMS.');
    }
    const content = await unprotect(document, tenantVaultId);
    if (!isDeviceLicense(content)) {
      throw new Error('Decrypted device license has an invalid shape.');
    }
    return { ...document, content };
  }));
  const licenseDocs = resolvedDocuments
    .filter((result): result is PromiseFulfilledResult<ConfidentialStorageDoc> => result.status === 'fulfilled')
    .map((result) => result.value);

  return licenseDocs
    .filter((doc) => matchesLicenseFilters(doc?.content as DeviceLicense & Record<string, any>, filters))
    .map((doc) => {
      const license = doc.content as DeviceLicense & Record<string, any>;
      return {
        id: license.id,
        meta: {
          status: license.status,
          ...(license.subjectId ? { subjectId: license.subjectId } : {}),
          ...(license.ownerOrganizationId ? { ownerOrganizationId: license.ownerOrganizationId } : {}),
          ...(license.authorizedSubjectDid ? { authorizedSubjectDid: license.authorizedSubjectDid } : {}),
          ...(license.relatedPersonId ? { relatedPersonId: license.relatedPersonId } : {}),
          ...(license.invitationId ? { invitationId: license.invitationId } : {}),
          maxDevices: Number.isInteger(Number(license.maxDevices)) && Number(license.maxDevices) > 0
            ? Number(license.maxDevices)
            : DEFAULT_LICENSE_DEVICE_ALLOWANCE,
          deviceBindings: Array.isArray(license.deviceBindings)
            ? license.deviceBindings.map((binding: any) => ({
                clientId: String(binding.clientId || ''),
                clientInstanceId: String(binding.clientInstanceId || ''),
                status: String(binding.status || ''),
                deviceInfo: {
                  clientInstanceId: String(binding.deviceInfo?.clientInstanceId || binding.clientInstanceId || ''),
                  model: String(binding.deviceInfo?.model || ''),
                  os: String(binding.deviceInfo?.os || ''),
                  osVersion: String(binding.deviceInfo?.osVersion || ''),
                },
                activatedAt: Number(binding.activatedAt || 0),
                ...(binding.revokedAt ? { revokedAt: Number(binding.revokedAt) } : {}),
              }))
            : [],
          claims: buildLicenseSearchClaims(license),
        },
      };
    });
}

function isDeviceLicense(value: unknown): value is DeviceLicense & Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.userClass === 'string'
    && typeof candidate.status === 'string';
}

/**
 * Projects one stored `DeviceLicense` into the schema.org-style claim shape
 * already used by shared `common-utils` readers.
 */
export function buildLicenseSearchClaims(
  license: DeviceLicense & Record<string, unknown>,
): Record<string, unknown> {
  const claims: Record<string, unknown> = {
    '@context': 'org.schema',
    [ClaimsOfferSchemaorg.serialNumber]: license.id,
    [ClaimsIndividualProductSchemaorg.category]: mapLicenseCategory(license.userClass as string | undefined),
    [ClaimsIndividualProductSchemaorg.additionalType]: license.type,
  };

  if (license.orderId) {
    claims[ClaimsOfferSchemaorg.identifier] = license.orderId;
  }
  if (license.issuedToEmail) {
    claims[ClaimsPersonSchemaorg.email] = license.issuedToEmail;
  }
  if (license.issuedToPhone) {
    claims[ClaimsPersonSchemaorg.telephone] = license.issuedToPhone;
  }
  if (license.issuedToRole) {
    claims[ClaimsPersonSchemaorg.hasOccupationalRoleValue] = license.issuedToRole;
  }

  return claims;
}

/**
 * Applies the current exact-match filter semantics to one stored license seat.
 */
export function matchesLicenseFilters(
  license: (DeviceLicense & Record<string, unknown>) | undefined,
  filters: SearchFilters,
): boolean {
  if (!license) return false;
  const entries = Object.entries(filters);
  if (entries.length === 0) return true;

  return entries.every(([key, expectedValues]) => {
    const actualValues = resolveLicenseFilterValues(license, key);
    if (actualValues.length === 0) return false;
    return expectedValues.some((expectedValue) => actualValues.includes(String(expectedValue).trim()));
  });
}

/**
 * Resolves one filter key into the comparable current storage values exposed by
 * `DeviceLicense`.
 */
export function resolveLicenseFilterValues(
  license: DeviceLicense & Record<string, unknown>,
  key: string,
): string[] {
  switch (key) {
    case 'id':
    case 'identifier':
    case ClaimsOfferSchemaorg.serialNumber:
      return toFilterValues(license.id);
    case 'status':
      return toFilterValues(license.status);
    case 'subject':
    case 'subjectId':
      return toFilterValues(license.subjectId);
    case 'ownerOrganizationId':
    case 'License.ownerOrganizationId':
      return toFilterValues(license.ownerOrganizationId);
    case 'userClass':
    case 'License.userClass':
      return toFilterValues(license.userClass);
    case ClaimsIndividualProductSchemaorg.category:
      return toFilterValues(mapLicenseCategory(license.userClass as string | undefined));
    case 'type':
    case 'License.type':
    case ClaimsIndividualProductSchemaorg.additionalType:
      return toFilterValues(license.type);
    case 'orderId':
    case ClaimsOfferSchemaorg.identifier:
      return toFilterValues(license.orderId);
    case 'activationCode':
      return toFilterValues(license.activationCode);
    case 'email':
    case ClaimsPersonSchemaorg.email:
      return toFilterValues(license.issuedToEmail);
    case 'telephone':
    case ClaimsPersonSchemaorg.telephone:
      return toFilterValues(license.issuedToPhone);
    case 'role':
    case ClaimsPersonSchemaorg.hasOccupationalRoleValue:
    case ClaimsPersonSchemaorg.hasOccupation:
      return toFilterValues(license.issuedToRole);
    case 'active':
      return toFilterValues(String(license.status === LICENSE_STATUS_ACTIVE));
    case 'unused':
      return toFilterValues(String(license.status === LICENSE_STATUS_AVAILABLE));
    case 'assigned':
      return toFilterValues(String(
        Boolean(license.subjectId || license.issuedToEmail || license.issuedToPhone || license.activationCode || license.status === LICENSE_STATUS_ISSUED),
      ));
    default:
      return [];
  }
}

/**
 * Maps runtime user-class storage to the current shared schema.org-flavored
 * category values.
 */
export function mapLicenseCategory(userClass: string | undefined): string {
  return userClass === LICENSE_USER_CLASS_INDIVIDUAL
    ? LICENSE_CATEGORY_INDIVIDUAL
    : LICENSE_CATEGORY_PROFESSIONAL;
}

/**
 * Normalizes one optional scalar into the string-array shape used by the
 * search matcher.
 */
export function toFilterValues(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}
