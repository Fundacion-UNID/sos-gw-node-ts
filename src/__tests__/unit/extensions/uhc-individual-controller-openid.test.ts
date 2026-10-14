// Flow contract: an already registered personal-controller device may select a
// represented card only when GW owns an active target-specific RESPRSN seat for
// the same verified controller contact; no browser claim or second DCR suffices.
import {
  buildUhcRepresentedControllerActorDid,
  buildUhcRequestScopedAuthorizationDependencies,
  prepareUhcRepresentedSubjectClinicalBinding,
  projectUhcRepresentedControllerDeviceProfile,
  readUhcOpenIdActorAndSubject,
  resolveUhcControllerSubjectDeviceProfile,
} from '../../../extensions/uhc/individual-controller-openid';
import {
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_DEVICE_CLIENT_ID,
  EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
  EXAMPLE_KYC_CONTROLLER_TELEPHONE,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
  EXAMPLE_SUBJECT_DID,
  EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
  EXAMPLE_TENANT_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID } from 'gdc-common-utils-ts/examples/subject-identity-binding';
import { DeviceBindingStatuses, DeviceUserClasses } from 'gdc-common-utils-ts/constants/device';
import {
  getHealthcareRoleByClaim,
  HealthcareActorRoles,
} from 'gdc-common-utils-ts/constants/healthcare';
import {
  FhirIpsCreatorKinds,
  normalizeClinicalCreatorBinding,
} from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { buildSmartCompositionReadScope } from 'gdc-common-utils-ts/utils/smart-scope';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import { CommunicationClaim } from 'gdc-common-utils-ts/models/interoperable-claims/communication-claims';
import {
  buildUhcRepresentedClinicalRepository,
  readUhcRepresentedClinicalProvenance,
} from '../../../extensions/uhc/represented-clinical-provenance';
import { getClinicalCreatorBindingsSectionId } from '../../../utils/clinical-creator-binding';
import { getTenantVaultId } from '../../../utils/tenant';
import { Sector } from 'gdc-common-utils-ts/constants/Schemas';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/index';
import { BundleTypes } from 'gdc-common-utils-ts/models/bundle-editor-types';

const tenantVaultId = getTenantVaultId(Sector.HEALTH_CARE, EXAMPLE_TENANT_IDENTIFIER);
const controllerRoleClaim = getHealthcareRoleByClaim(HealthcareActorRoles.Controller)!.claim;

describe('UHC represented-subject OpenID bridge', () => {
  it('reads the actor from sub and the represented subject from the canonical SMART scope', () => {
    expect(readUhcOpenIdActorAndSubject({
      sub: EXAMPLE_CONTROLLER_DID,
      scope: buildSmartCompositionReadScope({ subjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID }),
    })).toEqual({
      actorDid: EXAMPLE_CONTROLLER_DID,
      subjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
    });
  });

  it('projects the exact issued represented-subject seat onto the already active controller device', async () => {
    const deviceProfile = {
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
      status: DeviceBindingStatuses.Active,
      actorDid: EXAMPLE_CONTROLLER_DID,
      profileDid: EXAMPLE_CONTROLLER_DID,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
      authenticatedSubject: 'firebase-controller',
      authenticatedTelephone: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
      licenseId: EXAMPLE_LICENSE_SUBJECT_ID_ACTIVE,
    };
    const representedLicense = {
      id: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
      status: 'issued',
      userClass: DeviceUserClasses.Individual,
      issuedToPhone: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
      issuedToRole: controllerRoleClaim,
      authorizedSubjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
    };
    const invalidLegacyLicense = { id: 'legacy-plaintext-license', content: { status: 'issued' } };
    const repository = {
      get: jest.fn().mockResolvedValue({ id: EXAMPLE_DEVICE_CLIENT_ID, content: deviceProfile }),
      getContainersInSection: jest.fn().mockResolvedValue([
        invalidLegacyLicense,
        { id: representedLicense.id, content: representedLicense },
      ]),
    };
    const kms = {
      unprotectConfidentialData: jest.fn(async (record: any) => {
        if (record === invalidLegacyLicense) throw new Error('invalid legacy envelope');
        if (record.content === representedLicense) {
          throw new Error('plaintext issued licence must not be sent to the KMS');
        }
        return record.content;
      }),
    };

    await expect(resolveUhcControllerSubjectDeviceProfile({
      repository: repository as any,
      kmsService: kms as any,
      tenantVaultId,
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
      actorDid: EXAMPLE_CONTROLLER_DID,
      subjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
    })).resolves.toEqual(expect.objectContaining({
      authorizedSubjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
      licenseId: representedLicense.id,
    }));
  });

  it('presents the request-scoped profile through the KMS boundary without persisting or re-encrypting it', async () => {
    const encryptedDevice = { id: EXAMPLE_DEVICE_CLIENT_ID, jwe: { ciphertext: 'registered' } };
    const projected = {
      actorDid: EXAMPLE_CONTROLLER_DID,
      authorizedSubjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
    };
    const repository = { get: jest.fn().mockResolvedValue(encryptedDevice) };
    const kms = {
      unprotectConfidentialData: jest.fn(async () => {
        throw new Error('the underlying KMS must not decrypt the request-scoped projection');
      }),
      protectConfidentialData: jest.fn(),
    };
    const scoped = buildUhcRequestScopedAuthorizationDependencies({
      repository: repository as any,
      kmsService: kms as any,
      registeredDocument: encryptedDevice,
      projected,
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
    });

    const selected = await scoped.repository.get(
      tenantVaultId,
      EXAMPLE_DEVICE_CLIENT_ID,
      'device-profiles',
    );
    await expect(scoped.kmsService.unprotectConfidentialData(selected as any, tenantVaultId))
      .resolves.toBe(projected);
    expect(kms.protectConfidentialData).not.toHaveBeenCalled();
    expect(kms.unprotectConfidentialData).not.toHaveBeenCalled();
  });

  it('derives one subject-specific RelatedPerson binding without copying shared DCR aliases', async () => {
    const normalizedSourceBinding = normalizeClinicalCreatorBinding({
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: EXAMPLE_KYC_CONTROLLER_UUID,
      assignmentIdentifier: EXAMPLE_KYC_CONTROLLER_USER_UUID,
      ownerIdentifier: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
      role: HealthcareActorRoles.Controller,
      actorDids: [EXAMPLE_CONTROLLER_DID],
      dcrClientIds: [EXAMPLE_DEVICE_CLIENT_ID],
    });
    const sourceBinding = {
      ...normalizedSourceBinding,
      id: normalizedSourceBinding.authorIdentifier,
    };
    const repository = {
      listContainersInSection: jest.fn().mockResolvedValue([sourceBinding]),
    };
    const resolved = await prepareUhcRepresentedSubjectClinicalBinding({
      repository: repository as any,
      tenantVaultId,
      registeredActorDid: EXAMPLE_CONTROLLER_DID,
      license: {
        relatedPersonId: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
        subjectId: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
      } as any,
    });

    expect(resolved.actorDid).toBe(buildUhcRepresentedControllerActorDid({
      registeredActorDid: EXAMPLE_CONTROLLER_DID,
      assignmentIdentifier: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
    }));
    expect(resolved.binding).toEqual(expect.objectContaining({
      id: resolved.binding.authorIdentifier,
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: sourceBinding.actorIdentifier,
      authorIdentifier: resolved.binding.authorIdentifier,
      ownerIdentifier: resolved.binding.ownerIdentifier,
      role: expect.stringContaining(HealthcareActorRoles.Controller),
      actorDids: [resolved.actorDid],
    }));
    expect(resolved.binding.dcrClientIds).toBeUndefined();
  });

  it('keeps the registered transport actor while narrowing only the represented subject', () => {
    expect(projectUhcRepresentedControllerDeviceProfile({
      actorDid: EXAMPLE_CONTROLLER_DID,
      profileDid: EXAMPLE_CONTROLLER_DID,
      authorizedSubjectDid: EXAMPLE_SUBJECT_DID,
    }, EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID)).toEqual({
      actorDid: EXAMPLE_CONTROLLER_DID,
      profileDid: EXAMPLE_CONTROLLER_DID,
      authorizedSubjectDid: EXAMPLE_ALTERNATE_PORTAL_INDIVIDUAL_DID,
    });
  });

  it('reads represented author and assignment from the attached flat-claims batch', () => {
    const assignmentIdentifier = normalizeClinicalCreatorBinding({
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: EXAMPLE_KYC_CONTROLLER_UUID,
      assignmentIdentifier: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
      ownerIdentifier: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
      role: HealthcareActorRoles.Controller,
    }).authorIdentifier;
    const attachedBatch = {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: BundleTypes.batch,
      data: [{
        resource: {
          meta: {
            claims: {
              [CompositionClaim.Author]: assignmentIdentifier,
              [CompositionClaim.Attester]: assignmentIdentifier,
            },
          },
        },
      }],
    };
    const job = {
      content: {
        body: {
          data: [{
            meta: {
              claims: {
                [CommunicationClaim.ContentAttachmentData]: Buffer.from(
                  JSON.stringify(attachedBatch),
                  'utf8',
                ).toString('base64'),
              },
            },
          }],
        },
      },
    };

    expect(readUhcRepresentedClinicalProvenance(job as any)).toEqual({
      authorIdentifier: assignmentIdentifier,
      assignmentIdentifier,
    });
  });

  it('exposes only the authorized represented assignment for one clinical request', async () => {
    const normalizedSourceBinding = normalizeClinicalCreatorBinding({
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: EXAMPLE_KYC_CONTROLLER_UUID,
      assignmentIdentifier: EXAMPLE_KYC_CONTROLLER_USER_UUID,
      ownerIdentifier: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
      role: HealthcareActorRoles.Controller,
      actorDids: [EXAMPLE_CONTROLLER_DID],
    });
    const sourceBinding = {
      ...normalizedSourceBinding,
      id: normalizedSourceBinding.authorIdentifier,
    };
    const normalizedRepresentedBinding = normalizeClinicalCreatorBinding({
      kind: FhirIpsCreatorKinds.IndividualMember,
      actorIdentifier: sourceBinding.actorIdentifier,
      assignmentIdentifier: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
      ownerIdentifier: EXAMPLE_PRIVATE_INDIVIDUAL_UUID,
      role: HealthcareActorRoles.Controller,
      actorDids: [buildUhcRepresentedControllerActorDid({
        registeredActorDid: EXAMPLE_CONTROLLER_DID,
        assignmentIdentifier: EXAMPLE_LICENSE_SEAT_UUID_SECONDARY,
      })],
    });
    const representedBinding = {
      ...normalizedRepresentedBinding,
      id: normalizedRepresentedBinding.authorIdentifier,
    };
    const repository = {
      listContainersInSection: jest.fn().mockResolvedValue([sourceBinding, representedBinding]),
      put: jest.fn().mockResolvedValue(true),
    };
    const scoped = await buildUhcRepresentedClinicalRepository({
      repository: repository as any,
      tenantVaultId,
      registeredActorDid: EXAMPLE_CONTROLLER_DID,
      provenance: {
        authorIdentifier: representedBinding.authorIdentifier,
        assignmentIdentifier: representedBinding.authorIdentifier,
      },
    });

    const visible = await scoped.listContainersInSection(
      tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    expect(visible).toEqual([expect.objectContaining({
      authorIdentifier: representedBinding.authorIdentifier,
      actorDids: expect.arrayContaining([EXAMPLE_CONTROLLER_DID]),
    })]);
    await scoped.put(
      tenantVaultId,
      visible as any,
      getClinicalCreatorBindingsSectionId(),
    );
    expect(repository.put).not.toHaveBeenCalled();
  });
});
