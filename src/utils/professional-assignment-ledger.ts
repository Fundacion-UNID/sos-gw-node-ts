// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.
import { buildClinicalLedgerReferenceId } from './fhir-versioning';
import { shouldUseFabricLedger } from '../adapters/credential-ledger-resolver';
import { ManageAssetProfessionalAssignment } from '../blockchain/fabric/v3/manageAssetProfessionalAssignment';
import { resolveOrganizationIdentityChannel } from './ledger';

export type ProfessionalAssignmentLedgerPayload = Readonly<{
  assignmentLink: string;
  employeeLink: string;
  organizationLink: string;
  role: string;
  status: 'active' | 'suspended' | 'revoked';
}>;

/**
 * Converts the three private professional provenance identifiers into the
 * distinct opaque links shared by clinical evidence and assignment history.
 * Callers pass canonical identifiers; they never pass precomputed hashes.
 *
 * @example
 * ```ts
 * const links = buildProfessionalAssignmentLedgerPayload({
 *   organizationIdentifier: legalOrganizationUrn,
 *   assignmentIdentifier: practitionerRoleReference,
 *   employeeIdentifier: employeeReference,
 *   role: healthcareRole,
 * });
 * // links.organizationLink identifies the responsible organization.
 * // links.assignmentLink identifies the professional assignment.
 * // links.employeeLink identifies the person holding that assignment.
 * ```
 *
 * @see docs/01-OVERVIEW-AND-GUIDES/101-01.N-AUTHENTICATED-CLINICAL-AUTHOR.md
 * @see docs-v2/28-clinical-employee-ledger-schema.md
 */
export function buildProfessionalAssignmentLedgerPayload(params: Readonly<{
  assignmentIdentifier: string;
  employeeIdentifier: string;
  organizationIdentifier: string;
  role: string;
  status?: 'active' | 'suspended' | 'revoked';
}>): ProfessionalAssignmentLedgerPayload {
  return {
    assignmentLink: buildClinicalLedgerReferenceId(params.assignmentIdentifier),
    employeeLink: buildClinicalLedgerReferenceId(params.employeeIdentifier),
    organizationLink: buildClinicalLedgerReferenceId(params.organizationIdentifier),
    role: params.role,
    status: params.status || 'active',
  };
}

/**
 * Anchors a professional assignment using only the opaque links shared with
 * artifact-sc. Channel and employee-sc selection are fixed by GW policy.
 */
export async function registerProfessionalAssignmentOnLedger(params: Readonly<{
  jurisdiction: string;
  assignmentIdentifier: string;
  employeeIdentifier: string;
  organizationIdentifier: string;
  role: string;
  status?: 'active' | 'suspended' | 'revoked';
}>): Promise<void> {
  if (!shouldUseFabricLedger()) return;
  const mspId = String(process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_HOST1 || '').trim();
  if (!mspId) return;

  const payload = buildProfessionalAssignmentLedgerPayload(params);
  const manager = new ManageAssetProfessionalAssignment({
    channelName: resolveOrganizationIdentityChannel(params.jurisdiction),
  });
  await manager.upsertProfessionalAssignment(mspId, payload.assignmentLink, payload);
}
