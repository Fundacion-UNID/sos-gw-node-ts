// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it, jest } from '@jest/globals';
import { buildSubjectIdentityBundleEntry } from 'gdc-common-utils-ts/utils/subject-identity';
import { SubjectIdentityManager } from '../../../managers/SubjectIdentityManager';

/**
 * Teaching goal:
 *
 * Exercise the complete private-identity collection boundary. `Subject` is
 * the collection operation, while each stored Bundle entry remains Person or
 * Animal and points through `sameAs` to one public unified card.
 */
describe('SubjectIdentityManager', () => {
  const tenantVaultId = 'health-care_VATES-G02793479';
  const collectionName = 'tenant_collection';
  const cardId = 'urn:vetchain:card:animal:luna';
  const entry = buildSubjectIdentityBundleEntry({
    subjectKind: 'animal',
    cardId,
    codingSystem: 'urn:iso:std:iso:11784-11785',
    jurisdiction: '',
    codeValue: '981020000123456',
    additionalClaims: {
      'org.schema.Animal.birthDate': '2020-02-02',
    },
  });

  function fixture() {
    const encrypted = new Map<string, unknown>();
    const repository: any = {
      query: jest.fn(async () => [{ id: 'authorized-card' }]),
      put: jest.fn(async () => true),
      get: jest.fn(async () => undefined),
      getContainersInSection: jest.fn(async () => []),
      delete: jest.fn(async () => true),
    };
    const kms: any = {
      protectConfidentialData: jest.fn(async (doc: any) => {
        encrypted.set(doc.id, doc.content);
        return { id: doc.id, sequence: 0, status: 'active', jwe: { ciphertext: 'encrypted' } };
      }),
      unprotectConfidentialData: jest.fn(async (doc: any) => encrypted.get(doc.id) || doc.content),
      getPublicVerificationKey: jest.fn(async () => ({ kid: 'did:web:gw.example#vc-sign-1' })),
      createCompactJws: jest.fn(async (payload: object) => (
        `eyJ0eXAiOiJzZCtqd3QifQ.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
      )),
    };
    const tenants: any = {
      getCollectionName: jest.fn(async () => collectionName),
      getTenantDid: jest.fn(async () => 'did:web:gw.example'),
    };
    const ledger: any = {
      upsert: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
    };
    return { repository, kms, tenants, ledger, manager: new SubjectIdentityManager(repository, kms, tenants, ledger) };
  }

  it('encrypts an Animal identity and publishes only its provider-routable opaque alias', async () => {
    const { manager, repository, kms, ledger } = fixture();

    // Step 1. Write one semantic identity through the Subject collection.
    const response = await manager.process(job('_batch', { resourceType: 'Bundle', type: 'batch', data: [entry] }));

    // Step 2. The complete entry is protected before tenant persistence.
    expect(kms.protectConfidentialData).toHaveBeenCalledTimes(2);
    expect(kms.protectConfidentialData).toHaveBeenNthCalledWith(1, expect.objectContaining({
      id: entry.id,
      content: expect.objectContaining({ resource: expect.objectContaining({ resourceType: 'Animal' }) }),
    }), tenantVaultId);
    expect(kms.protectConfidentialData).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: entry.id,
      content: { cardId },
    }), tenantVaultId);
    expect(repository.put).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(repository.put.mock.calls)).not.toContain('981020000123456');

    // Step 3. Fabric receives only the opaque alias; its adapter adds the provider DID.
    expect(ledger.upsert).toHaveBeenCalledWith({ assetId: entry.id });
    expect(JSON.stringify(ledger.upsert.mock.calls)).not.toContain(cardId);
    expect(JSON.stringify(ledger.upsert.mock.calls)).not.toContain('981020000123456');
    expect((response.body as any).data[0].resource.resourceType).toBe('Animal');
  });

  it('reads every identity associated with one exact public card', async () => {
    const { manager, repository } = fixture();
    repository.getContainersInSection.mockResolvedValue([{ id: entry.id, content: entry }]);

    const response = await manager.process(job('_search', parameters({ card: cardId })));

    expect((response.body as any).data).toHaveLength(1);
    expect((response.body as any).data[0].resource.meta.claims['org.schema.Animal.sameAs']).toBe(cardId);
  });

  it('deletes current vault and Fabric resolution using an opaque asset id', async () => {
    const { manager, repository, ledger } = fixture();

    const response = await manager.process(job('_delete', parameters({
      card: cardId,
      'coding-system': 'urn:iso:std:iso:11784-11785',
      jurisdiction: '',
      'code-value': '981020000123456',
    })));

    expect(repository.delete).toHaveBeenCalledWith(collectionName, entry.id, expect.any(String));
    expect(repository.delete).toHaveBeenCalledWith(collectionName, entry.id, expect.stringContaining('match-index'));
    expect(repository.delete).toHaveBeenCalledTimes(2);
    expect(ledger.delete).toHaveBeenCalledWith(expect.objectContaining({ assetId: entry.id }));
    expect((response.body as any).data[0].response.status).toBe('204');
  });

  it('matches an exact microchip through PDQm without receiving a caller-supplied hash', async () => {
    const { manager, repository } = fixture();
    repository.get.mockResolvedValue({
      id: entry.id,
      content: { cardId },
    });
    repository.getContainersInSection.mockResolvedValue([{ id: entry.id, content: entry }]);

    const response = await manager.process(job('$match', matchParameters({
      system: 'urn:iso:std:iso:11784-11785',
      value: '981020000123456',
    }), 'Patient'));

    expect(repository.get).toHaveBeenCalledWith(collectionName, entry.id, expect.any(String));
    expect(JSON.stringify((response.body as any))).not.toContain(entry.id);
    expect(response.body).toEqual(expect.objectContaining({
      resourceType: 'Bundle',
      type: 'searchset',
      total: 1,
      entry: [expect.objectContaining({
        resource: expect.objectContaining({
          resourceType: 'Patient',
          identifier: [{ system: 'urn:ietf:rfc:3986', value: cardId }],
        }),
        search: expect.objectContaining({ mode: 'match', score: 1 }),
      })],
    }));
  });

  it('matches an exact public card without hashing it or reading the private identifier index', async () => {
    const { manager, repository } = fixture();
    repository.getContainersInSection.mockResolvedValue([{ id: entry.id, content: entry }]);

    const response = await manager.process(job('$match', matchParameters({
      system: 'urn:ietf:rfc:3986',
      value: cardId,
    }), 'Patient'));

    expect(repository.get).not.toHaveBeenCalled();
    expect((response.body as any).total).toBe(1);
  });

  it('returns an empty PDQm searchset for an unknown exact identifier', async () => {
    const { manager } = fixture();
    const response = await manager.process(job('$match', matchParameters({
      system: 'urn:iso:std:iso:11784-11785',
      value: '981020000123456',
    }), 'Patient'));
    expect(response.body).toEqual(expect.objectContaining({
      resourceType: 'Bundle', type: 'searchset', total: 0, entry: [],
    }));
  });

  it('accepts the asynchronous DIDComm batch envelope for POST Patient/$match', async () => {
    const { manager, repository } = fixture();
    repository.getContainersInSection.mockResolvedValue([{ id: entry.id, content: entry }]);

    const response = await manager.process(job('$match', {
      resourceType: 'Bundle',
      type: 'batch',
      data: [{
        request: { method: 'POST', url: 'Patient/$match' },
        resource: matchParameters({ system: 'urn:ietf:rfc:3986', value: cardId }),
      }],
    }, 'Patient'));

    expect((response.body as any).total).toBe(1);
  });

  it('accepts omitted count and rejects non-certain Patient/$match requests', async () => {
    const { manager } = fixture();
    const withoutCount = matchParameters({ system: 'urn:ietf:rfc:3986', value: cardId });
    withoutCount.parameter = withoutCount.parameter.filter((item: any) => item.name !== 'count');
    const response = await manager.process(job('$match', withoutCount, 'Patient'));
    expect((response.body as any).type).toBe('searchset');

    const ambiguous = matchParameters({ system: 'urn:ietf:rfc:3986', value: cardId });
    ambiguous.parameter.find((item: any) => item.name === 'onlyCertainMatches')!.valueBoolean = false;
    await expect(manager.process(job('$match', ambiguous, 'Patient'))).rejects.toThrow(/onlyCertainMatches=true/);
  });

  it('issues a request-bound Antifraud SD-JWT containing seeds but neither final salts nor attribute values', async () => {
    const { manager, repository, kms } = fixture();
    repository.get.mockResolvedValue({ id: entry.id, content: { cardId } });
    repository.getContainersInSection.mockResolvedValue([{ id: entry.id, content: entry }]);
    const thid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';

    // Step 1. The requester sends its DIDComm thid again as Parameters.id and
    // supplies ResourceType-first flat claims already known to it.
    const response = await manager.process(job('$hashed-claims-issue', {
      resourceType: 'Parameters',
      id: thid,
      parameter: [
        { name: 'Animal.identifier.additionalType', valueString: 'urn:iso:std:iso:11784-11785' },
        { name: 'Animal.identifier.jurisdiction', valueString: '' },
        { name: 'Animal.identifier.value', valueString: '981020000123456' },
        { name: 'Animal.birthDate', valueString: '2020-02-02' },
      ],
    }, 'Animal', thid));

    // Step 2. The tenant signs a zero-disclosure SD-JWT. Canonical URN claims
    // carry only seeds; the verified input values and final salts are absent.
    const signedPayload = kms.createCompactJws.mock.calls[0][0];
    expect(signedPayload).toEqual(expect.objectContaining({
      iss: 'did:web:gw.example',
      aud: 'did:web:portal.example',
      _sd_alg: 'sha-384',
      _sd: expect.arrayContaining([expect.any(String)]),
      'urn:cds-ES:v1:identity:animal:org.schema:Animal.birthDate': expect.any(String),
    }));
    expect(JSON.stringify(signedPayload)).not.toContain('2020-02-02');
    expect(JSON.stringify(signedPayload)).not.toContain('981020000123456');
    expect(kms.createCompactJws).toHaveBeenCalledWith(
      signedPayload,
      'did:web:gw.example#vc-sign-1',
      tenantVaultId,
      'vc_sign',
      { typ: 'sd+jwt' },
    );
    expect(response.body).toEqual({
      resourceType: 'Parameters',
      id: thid,
      parameter: [{ name: 'verifiableCredential', valueString: expect.stringMatching(/~$/) }],
    });
  });

  it('refuses to sign when Parameters.id differs from thid or a supplied claim differs from issuer evidence', async () => {
    const { manager, repository, kms } = fixture();
    repository.get.mockResolvedValue({ id: entry.id, content: { cardId } });
    repository.getContainersInSection.mockResolvedValue([{ id: entry.id, content: entry }]);
    const thid = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
    const requested = {
      resourceType: 'Parameters',
      id: thid,
      parameter: [
        { name: 'Animal.identifier.additionalType', valueString: 'urn:iso:std:iso:11784-11785' },
        { name: 'Animal.identifier.jurisdiction', valueString: '' },
        { name: 'Animal.identifier.value', valueString: '981020000123456' },
        { name: 'Animal.birthDate', valueString: '2019-01-01' },
      ],
    };

    await expect(manager.process(job('$hashed-claims-issue', {
      ...requested,
      id: '67e55044-10b1-426f-9247-bb680e5fe0c8',
    }, 'Animal', thid))).rejects.toThrow(/Parameters.id must equal/i);
    await expect(manager.process(job('$hashed-claims-issue', requested, 'Animal', thid)))
      .rejects.toThrow(/do not match issuer evidence/i);
    expect(kms.createCompactJws).not.toHaveBeenCalled();
  });

  it('rejects the obsolete SubjectIdentifier pseudo-resource', async () => {
    const { manager } = fixture();
    await expect(manager.process(job('_batch', {
      resourceType: 'Bundle',
      type: 'batch',
      data: [{ resource: { resourceType: 'SubjectIdentifier', subjectDid: cardId } }],
    }))).rejects.toThrow(/Person, Animal or Place/);
  });

  function job(
    action: '_batch' | '_search' | '_delete' | '$match' | '$hashed-claims-issue',
    body: unknown,
    resourceType: 'Subject' | 'Patient' | 'Person' | 'Animal' = 'Subject',
    thid = `subject-${action}`,
  ): any {
    return {
      tenantId: 'VATES-G02793479',
      sector: 'health-care',
      jurisdiction: 'ES',
      section: 'individual',
      format: 'org.schema',
      resourceType,
      action,
      content: {
        thid,
        iss: 'did:web:portal.example',
        aud: 'did:web:gw.example',
        body,
        meta: { bearer: { jwt: { payload: { email: 'controller@example.org' } } } },
      },
    };
  }

  function matchParameters(identifier: { system: string; value: string }) {
    return {
      resourceType: 'Parameters',
      parameter: [
        {
          name: 'resource',
          resource: { resourceType: 'Patient', identifier: [identifier] },
        },
        { name: 'onlyCertainMatches', valueBoolean: true },
        { name: 'count', valueInteger: 1 },
      ],
    };
  }

  function parameters(values: Record<string, string>) {
    return {
      resourceType: 'Parameters',
      parameter: Object.entries(values).map(([name, valueString]) => ({ name, valueString })),
    };
  }
});
