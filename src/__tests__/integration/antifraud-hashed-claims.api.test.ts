// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { resolveHostPhysicalCollectionName } from '../../config/storage-layout';
// Flow contract: 1. provision a real in-memory veterinary tenant; 2. persist one encrypted Animal identity and its controller link; 3. submit authenticated Parameters whose UUID id equals the DIDComm thid; 4. poll the encrypted asynchronous response; 5. reconstruct the RFC 9901 disclosure locally from the signed seed, retained thid and original value. Authorization invariant: only the existing subject/controller boundary may request the pilot credential. Privacy invariant: attribute values and final salts never appear in the issued SD-JWT.
import { randomUUID } from 'node:crypto';
import { buildSubjectIdentityBundleEntry } from 'gdc-common-utils-ts/utils/subject-identity';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { EXAMPLE_EMAIL_CONTROLLER_ORG } from 'gdc-common-utils-ts/examples/shared';
import { startServer, resetServerConfig } from '../../server';
import { getTenantVaultId, generateTenantCollectionNameFromClaims } from '../../utils/tenant';
import { initializeTenantServicesConfig } from '../../utils/services';
import { getEnvSectionId } from '../../utils/section-env';
import { getIndividualSectionId } from '../../utils/individual-sections';
import {
  buildAntifraudAttributeNameUrn,
  reconstructAntifraudDisclosure,
} from '../../utils/antifraud-request-bound-sd-jwt';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { configureAuthenticatedTestActor } from './helpers/authenticated-test-actor';
import { invokeExpress } from './helpers/invokeExpress';

const tenantId = 'veterinary-clinic';
const sector = 'animal-care';
const jurisdiction = 'CA-BC';

describe('Antifraud request-bound SD-JWT API', () => {
  afterEach(() => resetServerConfig());

  it('issues signed seeds and commitments while the requester reconstructs disclosures locally', async () => {
    configureEnvironment();
    const authenticatedActor = await configureAuthenticatedTestActor();
    resetServerConfig();
    const { app, queueAdapter, tenantManager, vaultRepository, kmsService } = await startServer({ listen: false });
    try {
      const hostClaims = {
        [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
        [ClaimsOrganizationSchemaorg.identifierType]: 'BN',
        [ClaimsOrganizationSchemaorg.identifierValue]: '700000001',
        [ClaimsServiceSchemaorg.category]: 'system',
      };
      const tenantClaims = {
        ...(testPayloadCreateTenant1.body.data[0].resource.meta.claims as any),
        [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
        [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
        [ClaimsOrganizationSchemaorg.addressRegion]: jurisdiction,
        [ClaimsServiceSchemaorg.category]: sector,
      };
      const tenantVaultId = getTenantVaultId(sector, tenantId);
      await kmsService.provisionKeys(tenantVaultId);
      const secureTenant = await kmsService.protectConfidentialData({
        id: tenantVaultId,
        status: 'active',
        sequence: 0,
        content: {
          claims: tenantClaims,
          didConfig: { service: initializeTenantServicesConfig(sector as Sector) },
          didDocument: {
            '@context': 'https://www.w3.org/ns/did/v1',
            id: 'did:web:veterinary-clinic.example',
            controller: [authenticatedActor.actorDid],
          },
        },
      } as any, 'host');
      await vaultRepository.put(
        resolveHostPhysicalCollectionName(),
        [secureTenant as any],
        getEnvSectionId('tenants'),
      );
      const tenant = await tenantManager.getTenant(tenantVaultId);
      const collectionName = tenant!.collectionName;

      const cardId = 'urn:vetchain:card:animal:antifraud-pilot';
      const chip = '981020000123456';
      const birthDate = '2020-02-02';
      const identity = buildSubjectIdentityBundleEntry({
        subjectKind: 'animal',
        cardId,
        codingSystem: 'urn:iso:std:iso:11784-11785',
        jurisdiction: '',
        codeValue: chip,
        additionalClaims: { 'org.schema.Animal.birthDate': birthDate },
      });
      const protectedIdentity = await kmsService.protectConfidentialData({
        id: identity.id, sequence: 0, status: 'active', content: identity,
      } as any, tenantVaultId);
      const protectedPointer = await kmsService.protectConfidentialData({
        id: identity.id, sequence: 0, status: 'active', content: { cardId },
      } as any, tenantVaultId);
      await vaultRepository.put(
        collectionName, [protectedIdentity as any], getIndividualSectionId(cardId, 'subject-identities'),
      );
      await vaultRepository.put(
        collectionName, [protectedPointer as any], getEnvSectionId('subject-identity-match-index'),
      );
      await vaultRepository.put(collectionName, [{
        id: 'animal-controller-directory-link', status: 'active', sequence: 0,
        indexed: { attributes: [
          { name: ClaimsOrganizationSchemaorg.sameAs, value: cardId },
          { name: ClaimsOrganizationSchemaorg.ownerEmail, value: EXAMPLE_EMAIL_CONTROLLER_ORG.toLowerCase() },
        ] },
      } as any], getEnvSectionId('individual'));

      const thid = randomUUID();
      const parameters = {
        resourceType: 'Parameters', id: thid,
        parameter: [
          { name: 'Animal.identifier.additionalType', valueString: 'urn:iso:std:iso:11784-11785' },
          { name: 'Animal.identifier.jurisdiction', valueString: '' },
          { name: 'Animal.identifier.value', valueString: chip },
          { name: 'Animal.birthDate', valueString: birthDate },
        ],
      };
      const base = `/${tenantId}/cds-${jurisdiction}/v1/${sector}/individual/org.schema/Animal`;
      const submitted = await invokeExpress(app, {
        method: 'POST', url: `${base}/$hashed-claims-issue`,
        headers: { 'content-type': 'application/json', authorization: authenticatedActor.authorizationHeader },
        body: { thid, iss: authenticatedActor.actorDid, body: parameters },
      });
      expect(submitted.status).toBe(202);

      const response = await poll(app, `${base}/$hashed-claims-issue-response`, thid);
      expect(response).toMatchObject({ resourceType: 'Parameters', id: thid });
      const sdJwt = response.parameter[0].valueString as string;
      expect(sdJwt.endsWith('~')).toBe(true);
      const [compact] = sdJwt.split('~');
      const payload = JSON.parse(Buffer.from(compact.split('.')[1], 'base64url').toString('utf8'));
      const birthDateUrn = buildAntifraudAttributeNameUrn({
        jurisdiction, subjectKind: 'animal', context: 'org.schema', attributeName: 'Animal.birthDate',
      });
      const seed = payload[birthDateUrn];
      expect(seed).toEqual(expect.any(String));
      expect(payload).toMatchObject({ iss: 'did:web:veterinary-clinic.example', _sd_alg: 'sha-384' });
      expect(payload._sd).toHaveLength(4);
      expect(JSON.stringify(payload)).not.toContain(chip);
      expect(JSON.stringify(payload)).not.toContain(birthDate);

      const reconstructed = reconstructAntifraudDisclosure({
        thid, claimSaltSeed: seed, jurisdiction, subjectKind: 'animal', context: 'org.schema',
        attributeName: 'Animal.birthDate', attributeValue: birthDate,
      });
      expect(payload._sd).toContain(reconstructed.digest);
      expect(JSON.stringify(payload)).not.toContain(reconstructed.contents[0]);
    } finally {
      queueAdapter.stop();
    }
  });
});

function configureEnvironment(): void {
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_PROVIDER: 'mem', STORAGE_PROVIDER: 'mem', QUEUE_PROVIDER: 'mem',
    SECTORS_ALLOWED: sector, ORG_HOST_LEGAL_NAME: 'Gateway Host Services',
    ORG_HOST_JURISDICTION: 'CA', ORG_HOST_ID_TYPE: 'BN', ORG_HOST_ID_VALUE: '700000001',
    ORG_HOST_ADMIN_EMAIL: 'admin@host.example', ORG_HOST_ADMIN_UID: 'host-admin',
    ORG_HOST_ADMIN_ROLE: 'ISCO-08|1111', SECURITY_MODE: 'demo', JSON_LEGACY: 'true',
    SUBJECT_IDENTIFIER_LEDGER_ENABLED: 'false',
  });
}

async function poll(app: any, url: string, thid: string): Promise<any> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await invokeExpress(app, {
      method: 'POST', url, headers: { 'content-type': 'application/json' }, body: { thid },
    });
    if (response.status === 200) return JSON.parse(response.text);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out polling ${url}`);
}
