// Flow contract: individual member seats are provisioned by organization
// onboarding or Offer -> Order; lifecycle operations never use License/_add.
import { describe, expect, it, jest } from '@jest/globals';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import {
  buildLicenseSearchEntry,
  LicenseStatuses,
} from 'gdc-common-utils-ts/utils/license';
import { LicenseManager } from '../../managers/LicenseManager';
import { extractBundleSearchResources } from 'gdc-common-utils-ts/utils/organization-employee-lifecycle';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';

/**
 * Flow contract: individual-organization member licenses
 *
 * 1. Creating an individual organization provides a pool owned by that
 *    organization; the controller uses the first seat.
 * 2. Contacts and Consents do not consume seats.
 * 3. Sending an invitation to a FHIR v3-role member reserves one available
 *    seat and emits a single-use activation code.
 * 4. Accepting the code, or claiming the exact scanned-card invitation with a
 *    verified recipient email/phone, binds the authenticated member.
 * 5. Cancelling a pending invitation or purging a disabled member releases the
 *    seat for later reuse.
 * 6. ISCO professionals never consume this pool because their professional
 *    organization owns their license.
 * 7. Exact self lookup repairs historical active controller seats from their
 *    owned Organization.sameAs instead of making portal and phone diverge.
 */
describe('LicenseManager individual-member lifecycle', () => {
  function buildJob(action: string, data: any[]): JobRequest {
    return {
      id: `job-${action}`,
      tenantId: 'unid',
      jurisdiction: 'ES',
      sector: 'health-care',
      section: 'individual',
      format: 'org.schema',
      resourceType: 'License',
      action,
      content: {
        thid: `thread-${action}`,
        iss: 'did:web:unid.online:card:uhc:personal:controller-example',
        aud: 'did:web:api.unid.online',
        body: { resourceType: 'Bundle', type: 'batch', data },
      },
    } as JobRequest;
  }

  function seat(input: Partial<any> & { id: string }): ConfidentialStorageDoc {
    const content = {
      tenantId: 'unid',
      orderId: 'individual-default-free',
      userClass: 'individual',
      type: 'web',
      status: 'available',
      plan: 'individual-default-free',
      renewalCycle: null,
      reactivationEnabled: true,
      exp: Math.floor(Date.now() / 1000) + 31_536_000,
      ...input,
    };
    return { id: content.id, status: content.status, sequence: 0, content } as ConfidentialStorageDoc;
  }

  it('repairs a historical ONESELF seat during exact controller lookup', async () => {
    const cardDid = 'did:web:unid.online:card:uhc:personal:represented-example';
    const legacy = seat({
      id: 'seat-controller-legacy',
      ownerOrganizationId: 'represented-example-org',
      status: 'active',
      subjectId: 'controller@example.invalid',
      issuedToEmail: 'controller@example.invalid',
      issuedToRole: 'v3-RoleCode|ONESELF',
    });
    const organization = { id: 'represented-example-org', status: 'active', sequence: 0, content: {} } as ConfidentialStorageDoc;
    const put = jest.fn(async (_vault: string, _docs: ConfidentialStorageDoc[], _section: string) => true);
    const repository = {
      getContainersInSection: jest.fn(async () => [legacy]),
      get: jest.fn(async (_vault: string, id: string) => id === 'represented-example-org' ? organization : legacy),
      put,
    } as any;
    const manager = new LicenseManager(repository, {
      unprotectConfidentialData: jest.fn(async () => ({ claims: {
        'org.schema.Organization.sameAs': cardDid,
      } })),
    } as any, {
      getCollectionName: jest.fn(async () => 'physical-health-care-unid'),
    } as any);

    const response = await manager.process(buildJob('_search', [buildLicenseSearchEntry({
      userClass: 'individual',
      status: LicenseStatuses.Active,
      email: 'controller@example.invalid',
    })]));

    expect((extractBundleSearchResources(response.body) as any[])[0].meta.authorizedSubjectDid).toBe(cardDid);
    expect(repository.get).toHaveBeenCalledWith(
      'physical-health-care-unid',
      'represented-example-org',
      expect.any(String),
    );
    expect(put).toHaveBeenCalledWith('health-care_unid', expect.arrayContaining([expect.objectContaining({
      sequence: 1,
      content: expect.objectContaining({ authorizedSubjectDid: cardDid }),
    })]), expect.any(String));
  });

  it('reserves only the synthetic controller owned seat for a FHIR v3-role phone contact', async () => {
    const controllerAvailable = seat({ id: 'seat-controller-example-available', ownerOrganizationId: 'controller-example-org' });
    const otherAvailable = seat({ id: 'seat-other-available', ownerOrganizationId: 'other-org' });
    const put = jest.fn(async (_vault: string, _docs: ConfidentialStorageDoc[]) => true);
    const manager = new LicenseManager({
      vaultExists: jest.fn(async () => true),
      getContainersInSection: jest.fn(async () => [otherAvailable, controllerAvailable]),
      put,
    } as any);

    // Step 1. the synthetic controller selects the synthetic represented member from her existing contacts and sends
    // an invitation as a non-employee member/representative.
    const response = await manager.process(buildJob('_issue', [{
      type: 'IndividualMemberLicenseInvitation-v1.0',
      meta: {
        ownerOrganizationId: 'controller-example-org',
        subjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
        relatedPersonId: 'related-represented-example',
        invitationId: 'invite-represented-example',
      },
      resource: { resourceType: 'License', meta: { claims: {
          '@context': 'org.schema',
          'org.schema.IndividualProduct.category': 'individual',
          'org.schema.IndividualProduct.additionalType': 'web',
          'org.schema.Person.telephone': '+34600111222',
          'org.schema.Person.hasOccupation.identifier.value': 'v3-RoleCode|RESPRSN',
      } } },
    }]));

    // Step 2. GW reserves the synthetic controller's available seat, not another household's
    // seat in the same hosted UNID tenant.
    expect(put).toHaveBeenCalledTimes(1);
    const updated = put.mock.calls[0][1][0] as ConfidentialStorageDoc;
    expect(updated.id).toBe('seat-controller-example-available');
    expect(updated.status).toBe('issued');
    expect((updated.content as any)).toMatchObject({
      ownerOrganizationId: 'controller-example-org',
      issuedToPhone: '+34600111222',
      issuedToRole: 'v3-RoleCode|RESPRSN',
      relatedPersonId: 'related-represented-example',
      invitationId: 'invite-represented-example',
      authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
    });

    // Step 3. The returned code is the user-facing invitation code. It is not
    // the internal seat id and can be delivered by Communication/app/SMS.
    expect((response.body as any).data[0].id).toMatch(/^lic-/);
    expect((response.body as any).data[0].meta.licenseId).toBe('seat-controller-example-available');
  });

  it('rejects an ISCO professional before touching the individual pool', async () => {
    const put = jest.fn(async (_vault: string, _docs: ConfidentialStorageDoc[]) => true);
    const manager = new LicenseManager({
      vaultExists: jest.fn(async () => true),
      getContainersInSection: jest.fn(async () => [seat({ id: 'seat-family', ownerOrganizationId: 'controller-example-org' })]),
      put,
    } as any);

    // Step 1. the synthetic controller may grant a doctor Consent and send a Communication,
    // but an erroneous individual License/_issue request must be rejected.
    const response = await manager.process(buildJob('_issue', [{
      meta: {
        ownerOrganizationId: 'controller-example-org',
      },
      resource: { resourceType: 'License', meta: { claims: {
          '@context': 'org.schema',
          'org.schema.IndividualProduct.category': 'individual',
          'org.schema.Person.email': 'doctor@example.org',
          'org.schema.Person.hasOccupation.identifier.value': 'ISCO-08|2211',
      } } },
    }]));

    // Step 2. Consent remains a separate flow and no household seat changes.
    expect((response.body as any).data[0].response.status).toBe('400');
    expect((response.body as any).data[0].response.outcome.issue[0].diagnostics)
      .toContain('ISCO professional roles do not consume individual-member licenses');
    expect(put).not.toHaveBeenCalled();
  });

  it('activates an organization-provisioned invitation and releases it only after deactivation', async () => {
    const added = seat({ id: 'seat-controller-example-lifecycle', ownerOrganizationId: 'controller-example-org' });
    const documents = new Map<string, ConfidentialStorageDoc>([[added.id, added]]);
    const put = jest.fn(async (_vault: string, docs: ConfidentialStorageDoc[]) => {
      for (const doc of docs) documents.set(doc.id, structuredClone(doc));
      return true;
    });
    const repository = {
      vaultExists: jest.fn(async () => true),
      getContainersInSection: jest.fn(async () => Array.from(documents.values())),
      put,
    } as any;
    const manager = new LicenseManager(repository);

    // Step 1. Organization onboarding has already provisioned the available
    // seat. The License manager starts at invitation issuance.
    expect((added.content as any)).toMatchObject({ ownerOrganizationId: 'controller-example-org', status: 'available' });

    // Step 2. Sending and accepting the invitation changes available -> issued
    // -> active and binds the authenticated member id.
    const issue = await manager.process(buildJob('_issue', [{
      meta: {
        ownerOrganizationId: 'controller-example-org',
        relatedPersonId: 'related-represented-example',
        invitationId: 'invite-represented-example',
        subjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
      },
      resource: { resourceType: 'License', meta: { claims: {
          '@context': 'org.schema',
          'org.schema.IndividualProduct.category': 'individual',
          'org.schema.Person.telephone': '+34600111222',
          'org.schema.Person.hasOccupation.identifier.value': 'v3-RoleCode|RESPRSN',
      } } },
    }]));
    const activationCode = (issue.body as any).data[0].id;
    // Family Order can issue the controller seat before the personal actor is
    // known. Acceptance must bind that verified actor durably for later cards.
    delete (documents.get(added.id)!.content as any).activatedBy;
    await manager.process(buildJob('_accept', [{
      id: activationCode,
      meta: {
        subjectId: 'did:web:unid.online:person:represented-example',
        verifiedActorIdentifier: '+34600111222',
      },
      resource: { resourceType: 'License', meta: { claims: { '@context': 'org.schema', 'org.schema.IndividualProduct.serialNumber': activationCode } } },
    }]));
    expect((Array.from(documents.values())[0].content as any)).toMatchObject({
      status: 'active',
      subjectId: 'did:web:unid.online:person:represented-example',
      authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
      activatedBy: buildStableActorIdentifier({ contactKind: 'phone', contact: '+34600111222' }),
    });

    // Step 3. The post-accept card refresh uses the same verified recipient
    // identifier and must find the active seat before resolving its exact
    // authorizedSubjectDid. This protects the browser flow from relying on
    // invitation UI state as an authorization grant.
    const search = await manager.process(buildJob('_search', [
      buildLicenseSearchEntry({
        userClass: 'individual',
        status: LicenseStatuses.Active,
        additionalClaims: {
          'org.schema.Person.telephone': '+34600111222',
        },
      }),
    ]));
    const activeSeats = extractBundleSearchResources(search.body) as any[];
    expect(activeSeats).toHaveLength(1);
    expect(activeSeats[0]).toMatchObject({
      meta: {
        status: 'active',
        authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
      },
    });

    // Step 4. An active member cannot be silently reassigned. Disable first,
    // then release after the relationship/Consent lifecycle has been closed.
    const activeRelease = await manager.process(buildJob('_release', [{
      id: activationCode,
      meta: { ownerOrganizationId: 'controller-example-org' },
      resource: { resourceType: 'License', meta: { claims: { 'org.schema.IndividualProduct.serialNumber': activationCode } } },
    }]));
    expect((activeRelease.body as any).data[0].response.status).toBe('409');

    await manager.process(buildJob('_deactivate', [{
      // Controllers manage the persisted row by seat id after the invitation
      // code has left the screen; only the recipient accepts with the code.
      id: added.id,
      meta: { ownerOrganizationId: 'controller-example-org' },
      resource: { resourceType: 'License', meta: { claims: { 'org.schema.IndividualProduct.serialNumber': added.id } } },
    }]));
    await manager.process(buildJob('_release', [{
      id: added.id,
      meta: { ownerOrganizationId: 'controller-example-org' },
      resource: { resourceType: 'License', meta: { claims: { 'org.schema.IndividualProduct.serialNumber': added.id } } },
    }]));
    expect((Array.from(documents.values())[0].content as any)).toMatchObject({ status: 'available' });
    expect((Array.from(documents.values())[0].content as any).activationCode).toBeUndefined();
  });

  it('claims the exact scanned-card invitation with the verified Firebase email', async () => {
    const issued = seat({
      id: 'seat-spouse-issued',
      ownerOrganizationId: 'controller-example-org',
      status: 'issued',
      activationCode: 'lic-private-code',
      issuedToEmail: 'spouse@example.org',
      issuedToPhone: '+34600111222',
      issuedToRole: 'v3-RoleCode|SPS',
      authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
    });
    const put = jest.fn(async (_vault: string, docs: ConfidentialStorageDoc[]) => {
      Object.assign(issued, structuredClone(docs[0]));
      return true;
    });
    const manager = new LicenseManager({
      vaultExists: jest.fn(async () => true),
      getContainersInSection: jest.fn(async () => [issued]),
      put,
    } as any);

    // Step 1. The BFF supplies only Firebase-verified identifiers, the exact
    // scanned subject DID and the authenticated recipient uid.
    const claimed = await manager.process(buildJob('_claim', [{
      meta: {
        subjectId: 'firebase:spouse-uid',
        authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
        verifiedActorIdentifiers: ['spouse@example.org', '+34600111222'],
      },
      resource: { resourceType: 'License', meta: { claims: { '@context': 'org.schema' } } },
    }]));

    // Step 2. GW activates exactly that issued member seat without exposing its
    // activation code to the scanner or browser.
    expect((claimed.body as any).data[0]).toMatchObject({
      response: { status: '200' },
      meta: {
        licenseId: 'seat-spouse-issued',
        ownerOrganizationId: 'controller-example-org',
        authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
      },
    });
    expect((issued.content as any)).toMatchObject({
      status: 'active',
      subjectId: 'firebase:spouse-uid',
      authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
    });
    expect((issued.content as any).activationCode).toBeUndefined();
  });

  it('keeps the issued seat unchanged when the verified actor does not match', async () => {
    const issued = seat({
      id: 'seat-spouse-issued',
      ownerOrganizationId: 'controller-example-org',
      status: 'issued',
      activationCode: 'lic-private-code',
      issuedToEmail: 'spouse@example.org',
      issuedToRole: 'v3-RoleCode|SPS',
      authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
    });
    const put = jest.fn();
    const manager = new LicenseManager({
      vaultExists: jest.fn(async () => true),
      getContainersInSection: jest.fn(async () => [issued]),
      put,
    } as any);

    // Step 1. An outsider presents a real Firebase identity, but neither that
    // fact nor possession of the public card locator is a permission.
    const rejected = await manager.process(buildJob('_claim', [{
      meta: {
        subjectId: 'firebase:outsider-uid',
        authorizedSubjectDid: 'did:web:unid.online:card:uhc:personal:controller-example',
        verifiedActorIdentifiers: ['outsider@example.org'],
      },
      resource: { resourceType: 'License', meta: { claims: { '@context': 'org.schema' } } },
    }]));

    // Step 2. GW returns a per-entry not-found result and preserves the issued
    // seat/code for the intended spouse.
    expect((rejected.body as any).data[0].response).toMatchObject({ status: '404' });
    expect((rejected.body as any).data[0].response.outcome.issue[0].diagnostics)
      .toContain('No issued invitation matches');
    expect(put).not.toHaveBeenCalled();
    expect((issued.content as any)).toMatchObject({
      status: 'issued',
      activationCode: 'lic-private-code',
    });
  });
});
