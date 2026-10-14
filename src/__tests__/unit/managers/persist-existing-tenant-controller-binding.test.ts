import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getEnvSectionId } from '../../../utils/section-env';
import { persistExistingTenantControllerBinding } from '../../../managers/hosting/persist-existing-tenant-controller-binding';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';

const CONTROLLER_DID = 'did:web:gateway.example.org:VATES-B00000000:cds-EU:v1:research:employee:second-controller';
const EXISTING_CONTROLLER_DID = 'did:web:gateway.example.org:VATES-B00000000:cds-EU:v1:research:employee:first-controller';
const EXISTING_SIGNER_KID = 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:cto-existing-signing-key';
const TENANT_VAULT_ID = 'onehealth-research_VATES-G02793479';

function publicKey(kid: string, alg: string) {
  return alg.startsWith('ES')
    ? { kid, kty: 'EC', crv: alg === 'ES384' ? 'P-384' : 'secp256k1', alg, use: 'sig', x: `${alg}-public-x`, y: `${alg}-public-y` } as any
    : { kid, kty: 'AKP', alg, use: 'sig', pub: `${alg}-public` } as any;
}

function controllerCredential(key: any, sameAs: string) {
  return {
    type: ['VerifiableCredential', 'ServiceCredential', 'ServiceControllerCredential'],
    credentialSubject: {
      provider: { taxID: 'VATES-G02793479' },
      owner: {
        additionalType: 'RESPRSN',
        sameAs,
        hasOccupation: { '@type': 'Occupation', occupationalCategory: 'ISCO-08|1330' },
        hasCredential: { material: toJwkThumbprintSha256Urn(key) },
      },
    },
  };
}

describe('persistExistingTenantControllerBinding', () => {
  it('adds an ICA-approved single-key Pontus-X controller without replacing the existing controller', async () => {
    const tenantConfig = {
      id: TENANT_VAULT_ID,
      status: 'active',
      didDocument: {
        id: 'did:web:gateway.example.org:VATES-B00000000',
        controller: EXISTING_CONTROLLER_DID,
      },
      meta: { existing: true, controllerDidDocument: { id: EXISTING_CONTROLLER_DID } },
    };
    const tenantRegistrationDoc = { id: TENANT_VAULT_ID, status: 'active', sequence: 0, content: tenantConfig };
    const vaultRepository = {
      get: jest.fn(async () => tenantRegistrationDoc),
      query: jest.fn(async () => [{ content: {
        status: 'active',
        didDocument: { id: EXISTING_CONTROLLER_DID },
      } }]),
      put: jest.fn(async () => undefined),
    } as any;
    const kmsService = {
      protectAttributesNameAndValue: jest.fn(async (attributes: unknown) => attributes),
      protectConfidentialData: jest.fn(async (doc: unknown) => doc),
      unprotectConfidentialData: jest.fn(async (doc: any) => doc.content),
    } as any;
    const tenantsCacheManager = {
      getTenant: jest.fn(async () => tenantConfig),
      getCollectionName: jest.fn(async () => 'ES_VATES_G02793479_onehealth-research'),
      refreshTenant: jest.fn(async () => tenantConfig),
    } as any;
    const registerControllerKeysOnLedger = jest.fn(async (_input: unknown) => undefined);

    const secondControllerKey = publicKey('legacy-controller-key', 'ES256K');
    const secondControllerSameAs = 'second.controller@example.test';
    await expect(persistExistingTenantControllerBinding({
      claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G02793479',
        [ClaimsPersonSchemaorg.hasOccupationalRoleValue]: 'RESPRSN',
        [ClaimsServiceSchemaorg.category]: 'onehealth-research',
      },
      controller: {
        did: CONTROLLER_DID,
        sameAs: secondControllerSameAs,
        publicKeyJwk: secondControllerKey,
      },
      controllerCredential: controllerCredential(
        publicKey('different-controller-key', 'ES384'),
        secondControllerSameAs,
      ),
      verifiedSignerKid: EXISTING_SIGNER_KID,
      hostCollectionName: 'system_host',
      vaultRepository,
      kmsService,
      tenantsCacheManager,
      registerControllerKeysOnLedger,
    })).rejects.toThrow('JWK does not match');
    expect(vaultRepository.put).not.toHaveBeenCalled();

    await persistExistingTenantControllerBinding({
      claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G02793479',
        [ClaimsPersonSchemaorg.hasOccupationalRoleValue]: 'RESPRSN',
        [ClaimsServiceSchemaorg.category]: 'onehealth-research',
      },
      controller: {
        did: CONTROLLER_DID,
        sameAs: secondControllerSameAs,
        publicKeyJwk: secondControllerKey,
      },
      controllerCredential: controllerCredential(secondControllerKey, secondControllerSameAs),
      verifiedSignerKid: EXISTING_SIGNER_KID,
      transactionId: 'legal-organization-verification-thread-001',
      hostCollectionName: 'system_host',
      vaultRepository,
      kmsService,
      tenantsCacheManager,
      registerControllerKeysOnLedger,
    });

    const persisted = (vaultRepository.put as any).mock.calls.find((call: any[]) => call[2] === getEnvSectionId('tenants'))[1][0].content;
    expect(persisted.didDocument.controller).toEqual([EXISTING_CONTROLLER_DID, CONTROLLER_DID]);
    expect(persisted.meta.controllerDidDocument).toBeUndefined();
    const employee = (vaultRepository.put as any).mock.calls.find((call: any[]) => call[2] === getEnvSectionId('employees'))[1][0];
    expect(employee.content.didDocument.id).toBe(CONTROLLER_DID);
    expect(employee.indexed.attributes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'org.schema.Person.identifier', value: CONTROLLER_DID }),
      expect.objectContaining({ name: 'org.schema.Person.sameAs' }),
      expect.objectContaining({ name: 'org.schema.Person.additionalType', value: 'RESPRSN' }),
      expect.objectContaining({ name: 'org.schema.Person.hasOccupation.occupationalCategory', value: 'ISCO-08|1330' }),
      expect.objectContaining({ name: 'org.schema.Person.hasCredential.material', value: expect.stringMatching(/^urn:ietf:params:oauth:jwk-thumbprint:sha-256:/) }),
    ]));
    expect(employee.content.didDocument.verificationMethod).toHaveLength(1);
    expect(vaultRepository.put).toHaveBeenCalledWith(
      'system_host',
      expect.any(Array),
      getEnvSectionId('tenants'),
    );
    expect(vaultRepository.put).toHaveBeenCalledWith(
      'ES_VATES_G02793479_onehealth-research',
      expect.any(Array),
      getEnvSectionId('employees'),
    );
    expect(tenantsCacheManager.refreshTenant).toHaveBeenCalledWith(TENANT_VAULT_ID);
    expect(registerControllerKeysOnLedger).toHaveBeenCalledWith(expect.objectContaining({
      controllerDid: CONTROLLER_DID,
      transactionId: 'legal-organization-verification-thread-001',
      verificationMethods: expect.arrayContaining([
        expect.objectContaining({ publicKeyJwk: expect.objectContaining({ alg: 'ES256K' }) }),
      ]),
    }));
  });

  it('rejects adding a controller when the verified signer is not an active existing controller', async () => {
    const tenantConfig = {
      id: TENANT_VAULT_ID,
      status: 'active',
      didDocument: { id: 'did:web:gateway.example.org:VATES-B00000000', controller: EXISTING_CONTROLLER_DID },
      meta: {},
    };
    const secondControllerKey = publicKey('legacy-controller-key', 'ES256K');
    const secondControllerSameAs = 'second.controller@example.test';
    await expect(persistExistingTenantControllerBinding({
      claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'VATES-G02793479',
        [ClaimsPersonSchemaorg.hasOccupationalRoleValue]: 'RESPRSN',
        [ClaimsServiceSchemaorg.category]: 'onehealth-research',
      },
      controller: {
        did: CONTROLLER_DID,
        sameAs: secondControllerSameAs,
        publicKeyJwk: secondControllerKey,
      },
      controllerCredential: controllerCredential(secondControllerKey, secondControllerSameAs),
      verifiedSignerKid: 'unrelated-signer',
      hostCollectionName: 'system_host',
      vaultRepository: {
        get: jest.fn(async () => ({ id: TENANT_VAULT_ID, content: tenantConfig })),
        query: jest.fn(async () => []),
      } as any,
      kmsService: {
        protectAttributesNameAndValue: jest.fn(async (attributes: unknown) => attributes),
      } as any,
      tenantsCacheManager: {
        getTenant: jest.fn(async () => tenantConfig),
        getCollectionName: jest.fn(async () => 'ES_VATES_G02793479_onehealth-research'),
      } as any,
    })).rejects.toThrow('active existing controller');
  });
});
