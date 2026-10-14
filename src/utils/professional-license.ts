import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { LICENSE_STATUS_ACTIVE } from '../constants/domain';
import { getEnvSectionId } from './section-env';
import { normalizeIndexedEmail } from './indexed-contact';
import { normalizeCodeSystemAndValue } from './normalize-codeAndSystem';
import { getPersonOccupationClaim } from './occupation';

export type ActiveProfessionalIdentity = Readonly<{
  stableActorIdentifier: string;
  role: string;
}>;

/**
 * Verifies the current Employee projection and its applicable active licence.
 * The caller remains responsible for checking DCR and the requested Consent.
 */
export async function hasActiveProfessionalIdentityAndLicense(input: {
  tenantVaultId: string;
  employeeCollectionName: string;
  identity: ActiveProfessionalIdentity;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
}): Promise<boolean> {
  const employeeDocuments = await input.vaultRepository.getContainersInSection<any>(
    input.employeeCollectionName,
    getEnvSectionId('employees'),
  );
  let activeEmployeeEmail: string | undefined;
  for (const document of employeeDocuments || []) {
    try {
      const employee = await input.kmsService.unprotectConfidentialData<any>(document, input.tenantVaultId);
      if (String(employee?.status || '').trim().toLowerCase() !== LICENSE_STATUS_ACTIVE) continue;
      const email = normalizeIndexedEmail(employee?.claims?.[ClaimsPersonSchemaorg.email]);
      const role = getPersonOccupationClaim(employee?.claims || {});
      if (!email || normalizeCodeSystemAndValue(role) !== normalizeCodeSystemAndValue(input.identity.role)) continue;
      if (buildStableActorIdentifier({ contactKind: 'email', contact: email }) === input.identity.stableActorIdentifier) {
        activeEmployeeEmail = email;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!activeEmployeeEmail) return false;

  const now = Math.floor(Date.now() / 1000);
  const licenseDocuments = await input.vaultRepository.getContainersInSection<any>(
    input.tenantVaultId,
    getEnvSectionId('device-licenses'),
  );
  for (const document of licenseDocuments || []) {
    try {
      const license = await input.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, unknown>>(
        document,
        input.tenantVaultId,
      );
      if (!license || String(license.status || document?.status || '') !== LICENSE_STATUS_ACTIVE) continue;
      if (Number.isFinite(Number(license.exp)) && Number(license.exp) <= now) continue;
      if (normalizeCodeSystemAndValue(String(license.issuedToRole || '')) !== normalizeCodeSystemAndValue(input.identity.role)) {
        continue;
      }
      const issuedEmail = normalizeIndexedEmail(String(license.issuedToEmail || ''));
      const stableBinding = String(license.activatedBy || '').replace(/^firebase:/, '');
      if (issuedEmail === activeEmployeeEmail
        && (!stableBinding || stableBinding === input.identity.stableActorIdentifier)) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}
