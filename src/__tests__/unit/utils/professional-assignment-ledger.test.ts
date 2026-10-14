// Flow contract: professional onboarding projects the exact FHIR assignment,
// employee and legal-organization references into joinable opaque ledger links.
import { describe, expect, it } from '@jest/globals';
import { buildOrganizationAuthorizationUrnCds } from 'gdc-common-utils-ts';
import { HealthcareActorRoles } from 'gdc-common-utils-ts/constants/healthcare';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import {
  EXAMPLE_JURISDICTION,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
} from 'gdc-common-utils-ts/examples/shared';
import { buildClinicalLedgerReferenceId, buildFhirLedgerProvenance } from '../../../utils/fhir-versioning';
import { buildProfessionalAssignmentLedgerPayload } from '../../../utils/professional-assignment-ledger';
import { ManageAssetProfessionalAssignment } from '../../../blockchain/fabric/v3/manageAssetProfessionalAssignment';

describe('professional assignment ledger projection', () => {
  it('uses the PractitionerRole link as asset key and the CDS organization URN as author link', () => {
    const assignmentIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_UUID}`;
    const employeeIdentifier = `urn:uuid:${EXAMPLE_KYC_CONTROLLER_USER_UUID}`;
    const organizationIdentifier = buildOrganizationAuthorizationUrnCds({
      jurisdiction: EXAMPLE_JURISDICTION,
      version: 'v1',
      identifierType: 'tax',
      identifierValue: 'ES-B00112233',
    });

    const projection = buildProfessionalAssignmentLedgerPayload({
      assignmentIdentifier,
      employeeIdentifier,
      organizationIdentifier,
      role: HealthcareActorRoles.Veterinarian,
    });

    expect(projection).toEqual({
      assignmentLink: buildClinicalLedgerReferenceId(assignmentIdentifier),
      employeeLink: buildClinicalLedgerReferenceId(employeeIdentifier),
      organizationLink: buildClinicalLedgerReferenceId(organizationIdentifier),
      role: HealthcareActorRoles.Veterinarian,
      status: 'active',
    });
    expect(JSON.stringify(projection)).not.toMatch(/urn:|did:|ES-B00112233/);
    const artifactProvenance = buildFhirLedgerProvenance({
      claims: {
        [CompositionClaim.Author]: organizationIdentifier,
        [CompositionClaim.Attester]: assignmentIdentifier,
      },
    });
    expect(artifactProvenance.relationships.author).toEqual([projection.organizationLink]);
    expect(artifactProvenance.relationships.attester).toEqual([projection.assignmentLink]);
  });

  it('fixes employee-sc inside the manager instead of accepting a deployment override', () => {
    const previous = process.env.LEDGER_EMPLOYEE_CHAINCODE;
    process.env.LEDGER_EMPLOYEE_CHAINCODE = 'poisoned-chaincode';
    try {
      const manager = new ManageAssetProfessionalAssignment({ channelName: 'identity-local' });
      expect((manager as any).getContractName()).toBe('employee-sc');
    } finally {
      if (previous === undefined) delete process.env.LEDGER_EMPLOYEE_CHAINCODE;
      else process.env.LEDGER_EMPLOYEE_CHAINCODE = previous;
    }
  });
});
