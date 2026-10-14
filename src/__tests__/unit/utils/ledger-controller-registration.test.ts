import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ManageAssetCryptographicKey } from '../../../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../../../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { registerControllerKeysOnLedger } from '../../../utils/ledger-device-registration';

const originalEnvironment = {
  NETWORK_MODE: process.env.NETWORK_MODE,
  LEDGER_ENABLED: process.env.LEDGER_ENABLED,
  LEDGER_MSP_ID: process.env.LEDGER_MSP_ID,
  LEDGER_PROVIDER_MAP: process.env.LEDGER_PROVIDER_MAP,
  LEDGER_PROVIDER_DEFAULT: process.env.LEDGER_PROVIDER_DEFAULT,
};

afterEach(() => {
  jest.restoreAllMocks();
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('controller key ledger registration', () => {
  it('records public key assets and legal-controller bindings without treating them as Pontus-X custody', async () => {
    process.env.NETWORK_MODE = 'test-network';
    process.env.LEDGER_ENABLED = 'true';
    process.env.LEDGER_MSP_ID = 'Org1MSP';
    process.env.LEDGER_PROVIDER_MAP = '{"test-network":"fabric"}';
    process.env.LEDGER_PROVIDER_DEFAULT = 'fabric';
    const registerKey = jest.spyOn(ManageAssetCryptographicKey.prototype, 'registerKey').mockResolvedValue({} as any);
    const upsertBinding = jest.spyOn(ManageAssetSubjectKeyBinding.prototype, 'upsertSubjectKeyBinding').mockResolvedValue({} as any);
    const controllerDid = 'did:web:gateway.example.org:controller:primary';
    const actorIdentifier = 'urn:multibase:zControllerHash:professional';
    const key = {
      kid: 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:legacy-pontus-x',
      kty: 'EC', crv: 'secp256k1', x: 'public-x', y: 'public-y', alg: 'ES256K', use: 'sig',
    } as any;

    await registerControllerKeysOnLedger({
      jurisdiction: 'ES',
      organizationClaims: {
        [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'VATES-G02793479',
      },
      controllerDid,
      actorIdentifier,
      verificationMethods: [{
        id: `${controllerDid}#${key.kid}`,
        controller: controllerDid,
        type: 'JsonWebKey2020',
        publicKeyJwk: key,
      }],
      transactionId: 'ica-approved-thread-001',
    });

    expect(registerKey).toHaveBeenCalledWith(
      'Org1MSP',
      expect.any(String),
      expect.objectContaining({
        alg: 'ES256K',
        purpose: 'legal-organization-controller-signing',
        origin: 'ica-verified-issue',
        status: 'active',
      }),
    );
    expect(upsertBinding).toHaveBeenCalledWith(
      'Org1MSP',
      expect.stringContaining(`employee_${actorIdentifier}__`),
      expect.objectContaining({
        subjectType: 'employee',
        subjectId: actorIdentifier,
        relationship: 'legal-organization-controller-signing',
        status: 'active',
        meta: {
          attributes: expect.objectContaining({
            controllerDid,
            did: controllerDid,
            transactionId: 'ica-approved-thread-001',
          }),
        },
      }),
    );
  });

  it('fails closed when a Fabric-backed deployment lacks its MSP identity', async () => {
    process.env.NETWORK_MODE = 'test-network';
    process.env.LEDGER_ENABLED = 'true';
    process.env.LEDGER_PROVIDER_MAP = '{"test-network":"fabric"}';
    process.env.LEDGER_PROVIDER_DEFAULT = 'fabric';
    delete process.env.LEDGER_MSP_ID;
    delete process.env.HLF_MSP_ID_ORG1;

    await expect(registerControllerKeysOnLedger({
      organizationClaims: {},
      controllerDid: 'did:web:controller.example.org',
      actorIdentifier: 'urn:multibase:zControllerHash:professional',
      verificationMethods: [],
    })).rejects.toThrow('requires LEDGER_MSP_ID');
  });
});
