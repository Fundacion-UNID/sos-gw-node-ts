import type { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { normalizeIndexedEmail } from '../../utils/indexed-contact';
import { getPersonOccupationClaim } from '../../utils/occupation';
import { getEnvSectionId } from '../../utils/section-env';

type FindStoredControllerRoleByEmailDeps = Readonly<{
  tenantVaultId: string;
  email: string | undefined;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
}>;

type ResolveOrganizationIssueControllerIdentityDeps = Readonly<{
  claims: ClaimsRecord;
  bearerPayload?: Record<string, any>;
  tenantVaultId: string;
  securityMode: string;
  vaultRepository: IVaultRepository;
  kmsService: IKmsService;
}>;

/**
 * Finds the stored controller role for the resolved controller email when the
 * incoming request does not carry an explicit occupation claim.
 */
export async function findStoredControllerRoleByEmail(
  deps: FindStoredControllerRoleByEmailDeps,
): Promise<string | undefined> {
  const normalizedEmail = normalizeIndexedEmail(deps.email) as string | undefined;
  if (!normalizedEmail) {
    return undefined;
  }

  const employeeDocs = await deps.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
    deps.tenantVaultId,
    getEnvSectionId('employees'),
  );
  for (const employeeDoc of employeeDocs) {
    let claims = (employeeDoc?.content as any)?.claims as Record<string, any> | undefined;
    if (!claims && typeof (deps.kmsService as any)?.unprotectConfidentialData === 'function') {
      try {
        const unprotected = await (deps.kmsService as any).unprotectConfidentialData(employeeDoc, deps.tenantVaultId);
        claims = unprotected?.claims as Record<string, any> | undefined;
      } catch {
        claims = claims || undefined;
      }
    }
    const storedEmail = normalizeIndexedEmail(claims?.[ClaimsPersonSchemaorg.email]) as string | undefined;
    if (!storedEmail || storedEmail !== normalizedEmail) {
      continue;
    }
    const storedRole = getPersonOccupationClaim(claims);
    if (storedRole) {
      return storedRole;
    }
  }
  return undefined;
}

/**
 * Resolves the controller identity used by `Organization/_issue`.
 *
 * In demo mode GW can fall back to payload email and a default controller role.
 * In stricter modes bearer identity wins and stored role lookup fills the gap.
 */
export async function resolveOrganizationIssueControllerIdentity(
  deps: ResolveOrganizationIssueControllerIdentityDeps,
): Promise<{ email?: string; role?: string; }> {
  const emailFromPayload = normalizeIndexedEmail(deps.claims[ClaimsPersonSchemaorg.email]) as string | undefined;
  const emailFromBearer = normalizeIndexedEmail(
    (deps.bearerPayload?.email as string | undefined)
    || (deps.bearerPayload?.upn as string | undefined)
    || (deps.bearerPayload?.preferred_username as string | undefined),
  ) as string | undefined;
  const roleFromPayload = getPersonOccupationClaim(deps.claims as Record<string, any> | undefined);
  const isDemoMode = deps.securityMode === 'demo';

  const email = isDemoMode ? (emailFromPayload || emailFromBearer) : emailFromBearer;
  let role = roleFromPayload || await findStoredControllerRoleByEmail({
    tenantVaultId: deps.tenantVaultId,
    email,
    vaultRepository: deps.vaultRepository,
    kmsService: deps.kmsService,
  });

  if (isDemoMode && !role) {
    role = 'RESPRSN';
    console.log('[GW][demo] Organization/_issue controller role fallback applied', {
      tenantVaultId: deps.tenantVaultId,
      email,
      role,
    });
  }
  if (isDemoMode) {
    console.log('[GW][demo] Organization/_issue controller identity resolved', {
      tenantVaultId: deps.tenantVaultId,
      email,
      role,
      usedBearerEmail: email === emailFromBearer && !!emailFromBearer,
      usedPayloadEmail: email === emailFromPayload && !!emailFromPayload,
    });
  }
  return { email, role };
}
