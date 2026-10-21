// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/integration/wellKnownApi.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { jest } from '@jest/globals';
import express from 'express';
import { createHash } from 'node:crypto';
import { createDiscoveryRouter } from '../../routes/discovery';
import { DiscoveryService } from '../../services/DiscoveryService';
import type { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { testTenant1AlternateName, testTenant1DidWebHosted, testTenant1IdentifierUrn, testTenant1VaultId } from '../data/organization.data';
import { DidDocument } from '../../gdc-backend-utils-node/models/did';
import { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { parseTenantUrn } from '../../utils/urn';
import { ILogger } from '../../loggers/ILogger';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { invokeExpress } from './helpers/invokeExpress';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HostNetworkTypes } from 'gdc-common-utils-ts/constants/network';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import { ServiceCapability, serializeServiceCapabilityTokens } from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  buildExampleHostedTenantBaseUrl,
  EXAMPLE_COVERAGE_SCOPE_EU,
  EXAMPLE_GATEWAY_PUBLIC_ORIGIN,
  EXAMPLE_HOSTING_OPERATOR_DID,
  EXAMPLE_HOST_PUBLIC_HOSTNAME,
  EXAMPLE_PROVIDER_LEGAL_NAME,
  EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
  EXAMPLE_SECONDARY_PROVIDER_LEGAL_NAME,
  EXAMPLE_SECONDARY_TENANT_SERVICE_DID,
  EXAMPLE_SIGNED_TERMS_PDF_URL,
} from 'gdc-common-utils-ts/examples/shared';
import {
  buildGwCatalogArtifactPath,
  buildGwDspaceVersionWellKnownPath,
} from 'gdc-common-utils-ts/utils/dataspace-protocol';
import { NativeFhirFormats } from '../../constants/fhir-discovery';
import { SUBJECT_SECTION_DIGITAL_TWIN } from '../../constants/domain';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { ContinuityServiceCapability } from 'sos-data-utils-ts/continuity-service-capabilities';
import { PublicAlertOperationalClaim } from 'sos-data-utils-ts/public-notifications';
import { CommunicationRequestClaim, DocumentReferenceClaim } from 'fhir-data-utils-ts/claims';

const EXAMPLE_SIGNED_TERMS_PDF_HASH = createHash('sha256')
  .update(EXAMPLE_SIGNED_TERMS_PDF_URL)
  .digest('hex');
const mockTenantsCacheManager = {
  getDidDocument: jest.fn(),
  getEmployeeDidDocument: jest.fn(),
  getTenant: jest.fn(),
  isTenantOperational: jest.fn(async () => true),
  getTenantDomainUrl: jest.fn(async () => 'https://host.example.com'),
  getTenantOperationalUrl: jest.fn(),
  getTenantJurisdiction: jest.fn(async () => 'CA-BC'),
  getTenantSector: jest.fn(async () => 'health-care'),
  getDidServiceConfig: jest.fn(),
  listAutodiscoverableTenants: jest.fn(),
  listRegisteredTenants: jest.fn(),
  getCollectionName: jest.fn(async () => testTenant1VaultId),
} as unknown as jest.Mocked<TenantsCacheManager>;

const mockVaultRepository = {
  getContainersInSection: jest.fn(async () => []),
  listContainersInSection: jest.fn(async () => []),
} as unknown as jest.Mocked<IVaultRepository>;

// Create a fully typed mock of the IKmsService to satisfy the interface
const mockKmsService: jest.Mocked<IKmsService> = {
  init: jest.fn(),
  provisionKeys: jest.fn(),
  getPublicJwks: jest.fn(),
  getPublicVerificationKey: jest.fn(),
  getPublicEncryptionKey: jest.fn(),
  getHostPublicJwkSet: jest.fn(),
  decodeRequest: jest.fn(),
  signWithManagedKey: jest.fn(),
  signWithReconstructedKey: jest.fn(),
  createDetachedJws: jest.fn(),
  createCompactJws: jest.fn(),
  encodeResponse: jest.fn(),
  protectConfidentialData: jest.fn(),
  unprotectConfidentialData: jest.fn(async (doc: ConfidentialStorageDoc) => doc.content as any),
  getHmacBase64Url: jest.fn(),
  protectAttributesNameAndValue: jest.fn(),
};

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as jest.Mocked<ILogger>;

const app = express();
const discoveryService = new DiscoveryService(mockTenantsCacheManager);
// Pass the mocked kmsService and logger to the router
const discoveryRouter = createDiscoveryRouter(
  mockTenantsCacheManager,
  discoveryService,
  mockKmsService,
  mockLogger,
  mockVaultRepository,
);
app.use('/', discoveryRouter);

describe('Well-Known DID Discovery API', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the correct DID Document for a hosted tenant via the cds-style path', async () => {
    // --- Arrange ---
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;

    // Construct the exact URL the gateway is expected to handle for a hosted DID.
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/did.json`;
    
    const expectedDidDoc: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: testTenant1IdentifierUrn,
      alsoKnownAs: [testTenant1DidWebHosted],
      service: [{ // This is the new assertion
        id: '#legal-participant-credential',
        type: 'gx:LegalParticipant',
        serviceEndpoint: `${testTenant1DidWebHosted}/.well-known/legal-participant.vc.json`
      }]
    };

    // Configure the mock: The `resolveTenant` middleware will call `getDidDocument` to find the tenant.
    // The final route handler will then call it again via the discoveryService to get the document.
    mockTenantsCacheManager.getDidDocument.mockResolvedValue(expectedDidDoc);

    // --- Act ---
    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.text)).toEqual(expectedDidDoc);
    
    // Verify the middleware and the service handler used the correctly constructed vaultId to find the tenant.
    expect(mockTenantsCacheManager.getDidDocument).toHaveBeenCalledWith(testTenant1VaultId);
    // It's called twice: once in the middleware to check existence, once in the handler to get the data.
    expect(mockTenantsCacheManager.getDidDocument).toHaveBeenCalledTimes(2);
  });

  it('returns the same tenant DID document at the did:web path and the legacy well-known alias', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantPath = `/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}`;
    const legacyKid = `${testTenant1DidWebHosted}#legacy-es384`;
    const expectedDidDoc = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: testTenant1DidWebHosted,
      verificationMethod: [{
        id: legacyKid,
        controller: testTenant1DidWebHosted,
        type: 'JsonWebKey2020',
        publicKeyJwk: { kid: 'legacy-es384', kty: 'EC', crv: 'P-384', alg: 'ES384', use: 'sig' },
      }],
      authentication: [legacyKid],
      assertionMethod: [legacyKid],
    } as DidDocument;
    mockTenantsCacheManager.getDidDocument.mockResolvedValue(expectedDidDoc);

    const standardResponse = await invokeExpress(app, { method: 'GET', url: `${tenantPath}/did.json` });
    const compatibilityResponse = await invokeExpress(app, {
      method: 'GET',
      url: `${tenantPath}/.well-known/did.json`,
    });

    expect(standardResponse.status).toBe(200);
    expect(compatibilityResponse.status).toBe(200);
    expect(JSON.parse(standardResponse.text)).toEqual(expectedDidDoc);
    expect(JSON.parse(compatibilityResponse.text)).toEqual(expectedDidDoc);
    expect(JSON.parse(standardResponse.text)).toEqual(JSON.parse(compatibilityResponse.text));
    const publishedDid = JSON.parse(standardResponse.text) as DidDocument;
    const es384Method = publishedDid.verificationMethod?.find(
      (method) => (method.publicKeyJwk as any)?.alg === 'ES384',
    );
    expect(publishedDid.authentication).toContain(es384Method?.id);
    expect(publishedDid.assertionMethod).toContain(es384Method?.id);
    expect((es384Method?.publicKeyJwk as any)?.purpose).toBeUndefined();
  });

  it('resolves a lowercase hosted VAT DID path against the canonical tenant', async () => {
    const canonicalTenantId = 'VATES-G02793479';
    const canonicalVaultId = `${DataspaceSectors.OneHealthResearch}_${canonicalTenantId}`;
    const expectedDid = `did:web:gateway.example:${canonicalTenantId}:cds-ES:v1:${DataspaceSectors.OneHealthResearch}`;
    const expectedDidDoc = { id: expectedDid } as DidDocument;
    mockTenantsCacheManager.getDidDocument.mockImplementation(async (vaultId: string) => (
      vaultId === canonicalVaultId ? expectedDidDoc : undefined
    ));

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/vates-g02793479/cds-es/v1/${DataspaceSectors.OneHealthResearch}/.well-known/did.json`,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedDidDoc);
    expect(mockTenantsCacheManager.getDidDocument).toHaveBeenCalledWith(canonicalVaultId);
  });

  it('publishes safe authoritative tenant status separately from the DID document', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantDid = `did:web:gateway.example:${testTenant1AlternateName}:cds-${urnParts.jurisdiction}:${urnParts.version}:${urnParts.sector}`;
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: tenantDid } as DidDocument);
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      status: 'active',
      didDocument: { id: tenantDid, controller: null },
      collectionName: testTenant1VaultId,
    });

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/tenant-status.json`,
    });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(response.text)).toEqual(expect.objectContaining({
      resourceType: 'OrganizationTenantStatus',
      tenant: expect.objectContaining({ did: tenantDid, controllerBindingStatus: 'required' }),
      controllers: [],
    }));
    expect(response.text).not.toContain('email');
    expect(response.text).not.toContain('activationCode');
    expect(response.text).not.toContain('privateKeyJwk');
  });

  it('resolves the public multikey controller did:web document separately from the tenant DID', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantDid = `did:web:gateway.example:${testTenant1AlternateName}:cds-${urnParts.jurisdiction}:${urnParts.version}:${urnParts.sector}`;
    const memberId = 'zControllerEmailHash';
    const role = 'RESPRSN';
    const controllerDid = `${tenantDid}:employee:${memberId}:${role}`;
    const controllerDidDocument: DidDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: controllerDid,
      verificationMethod: [
        { id: `${controllerDid}#es384`, type: 'JsonWebKey2020', controller: controllerDid, publicKeyJwk: { kid: 'es384', kty: 'EC', crv: 'P-384', x: 'x', y: 'y', alg: 'ES384' } },
        { id: `${controllerDid}#pontus`, type: 'JsonWebKey2020', controller: controllerDid, publicKeyJwk: { kid: 'pontus', kty: 'EC', crv: 'secp256k1', x: 'x', y: 'y', alg: 'ES256K' } },
        { id: `${controllerDid}#pqc`, type: 'JsonWebKey2020', controller: controllerDid, publicKeyJwk: { kid: 'pqc', kty: 'AKP', alg: 'ML-DSA-65', pub: 'public' } },
      ],
    };
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: tenantDid, controller: [controllerDid] },
    } as any);
    mockVaultRepository.getContainersInSection.mockResolvedValueOnce([{
      id: 'historical-controller-record',
      content: { id: controllerDid, didDocument: controllerDidDocument },
    }] as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/employee/${memberId}/${role}/did.json`,
    });

    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(controllerDidDocument);
    expect(mockVaultRepository.getContainersInSection).toHaveBeenCalled();
  });

  it('publishes human-health capabilities at the exact section and format FHIR base', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const operationalUrl = `https://gateway.example/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}`;
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1DidWebHosted } as any);
    mockTenantsCacheManager.getTenantOperationalUrl.mockResolvedValue(operationalUrl);
    mockTenantsCacheManager.getDidServiceConfig.mockResolvedValue([{
      selector: { section: SUBJECT_SECTION_DIGITAL_TWIN, format: NativeFhirFormats.R4 },
      serviceEndpoint: ResourceTypesFhirR4.ResearchSubject,
      actions: ['_search'],
    }] as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/${SUBJECT_SECTION_DIGITAL_TWIN}/${NativeFhirFormats.R4}/metadata`,
    });
    const statement = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(statement.implementation.url).toBe(`${operationalUrl}/${SUBJECT_SECTION_DIGITAL_TWIN}/${NativeFhirFormats.R4}`);
    expect(statement.rest[0].resource.map((resource: any) => resource.type)).toEqual([
      ResourceTypesFhirR4.ResearchSubject,
    ]);
  });

  it('publishes veterinary capabilities at the exact section and format FHIR base', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const operationalUrl = `https://gateway.example/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}`;
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1DidWebHosted } as any);
    mockTenantsCacheManager.getTenantOperationalUrl.mockResolvedValue(operationalUrl);
    mockTenantsCacheManager.getDidServiceConfig.mockResolvedValue([{
      selector: { section: SUBJECT_SECTION_DIGITAL_TWIN, format: NativeFhirFormats.R4 },
      serviceEndpoint: `${ResourceTypesFhirR4.ResearchSubject},ResearchStudy`,
      actions: ['_search'],
    }] as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/${SUBJECT_SECTION_DIGITAL_TWIN}/${NativeFhirFormats.R4}/metadata`,
    });
    const statement = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(statement.implementation.url).toBe(`${operationalUrl}/${SUBJECT_SECTION_DIGITAL_TWIN}/${NativeFhirFormats.R4}`);
    expect(statement.rest[0].resource.map((resource: any) => resource.type)).toEqual([
      ResourceTypesFhirR4.ResearchSubject,
      'ResearchStudy',
    ]);
  });
});

describe('Well-Known JWKS Discovery API', () => {
  // Flow contract: the root host DID advertises /jwks.json, so that exact
  // public URL must expose the host keys without requiring CDS route context.

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns the host JWK Set at the exact URL advertised by the root host DID', async () => {
    const expectedJwks = { keys: [{ kid: 'root-host-key-1', kty: 'AKP' }] };
    mockKmsService.getPublicJwks.mockResolvedValue(expectedJwks);

    const response = await invokeExpress(app, { method: 'GET', url: '/jwks.json' });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.text)).toEqual(expectedJwks);
    expect(mockKmsService.getPublicJwks).toHaveBeenCalledWith('host');
  });

  it('should return the JWKSet for the host', async () => {
    // --- Arrange ---
    const expectedJwks = { keys: [{ kid: 'host-key-1', kty: 'AKP' }] };
    const expectedUrl = `/host/cds-${EXAMPLE_COVERAGE_SCOPE_EU}/v1/${HostNetworkTypes.Test}/.well-known/jwks.json`;

    // Mock the KMS service directly
    mockKmsService.getPublicJwks.mockResolvedValue(expectedJwks);
    
    // The middleware still needs to resolve the host.
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);

    // --- Act ---
    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.parse(response.text)).toEqual(expectedJwks);
    expect(mockKmsService.getPublicJwks).toHaveBeenCalledWith('host');
  });

  it('should return the JWKSet for a hosted tenant', async () => {
    // --- Arrange ---
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/jwks.json`;
    const expectedJwks = { keys: [{ kid: 'tenant-key-1', kty: 'AKP' }] };

    mockKmsService.getPublicJwks.mockResolvedValue(expectedJwks);
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);

    // --- Act ---
    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    // --- Assert ---
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedJwks);
    expect(mockKmsService.getPublicJwks).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('does not expose private KMS purpose labels in the public JWK Set', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const expectedUrl = `/${testTenant1AlternateName}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/jwks.json`;
    mockKmsService.getPublicJwks.mockResolvedValue({
      keys: [
        { kid: 'comm-ml', kty: 'AKP', alg: 'ML-DSA-44', use: 'sig', purpose: 'comm_sig' },
        { kid: 'vc-ml', kty: 'AKP', alg: 'ML-DSA-44', use: 'sig', purpose: 'vc_sign' },
      ],
    } as any);
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed.keys).toEqual([
      { kid: 'comm-ml', kty: 'AKP', alg: 'ML-DSA-44', use: 'sig' },
      { kid: 'vc-ml', kty: 'AKP', alg: 'ML-DSA-44', use: 'sig' },
    ]);
  });
});

describe('Well-Known Ping API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the host ping response via the host-scoped CDS path', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/host/cds-eu/v1/${HostNetworkTypes.Test}/.well-known/ping`,
    });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed.type).toBe('batch-response');
    expect(parsed.data?.[0]?.issue?.[0]?.diagnostics).toBe('Ping successful');
    expect(mockTenantsCacheManager.getDidDocument).toHaveBeenCalledWith('host');
  });
});

describe('Well-Known Tenant Artifacts API', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the stored legal participant VC (legal-participant.vc.json) for a hosted tenant', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/legal-participant.vc.json`;

    const expectedVc = { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: 'did:web:host' };
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({ governanceVc: expectedVc } as any);
    mockKmsService.getPublicJwks.mockResolvedValue({ keys: [{ kid: 'tenant-vc-sign', use: 'sig', purpose: 'vc_sign' }] } as any);
    mockKmsService.createCompactJws.mockResolvedValue('header.payload.signature');

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual({
      ...expectedVc,
      proof: {
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt,header.payload.signature',
      },
    });
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('should return the stored legal participant VC via the legacy vc.json alias', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/vc.json`;

    const expectedVc = { '@context': ['https://www.w3.org/2018/credentials/v1'], type: ['VerifiableCredential'], issuer: 'did:web:host' };
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({ governanceVc: expectedVc } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedVc);
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('should return the stored self-description (self-description.json) for a hosted tenant', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/self-description.json`;

    const expectedSelfDesc = { type: ['VerifiableCredential'], credentialSubject: { id: testTenant1IdentifierUrn } };
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({ selfDescriptionVc: expectedSelfDesc } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text)).toEqual(expectedSelfDesc);
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith(testTenant1VaultId);
  });

  it('should return the index service offering artifact for a hosted tenant when indexing is enabled', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/service-offering-index.json`;

    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockKmsService.getPublicJwks.mockResolvedValue({ keys: [{ kid: 'tenant-vc-sign', use: 'sig', purpose: 'vc_sign' }] } as any);
    mockKmsService.createCompactJws.mockResolvedValue('header.payload.signature');
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: testTenant1IdentifierUrn },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
        [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: urnParts.sector,
        [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
          alternateName: tenantId,
          jurisdiction: urnParts.jurisdiction,
          version: urnParts.version,
          sector: urnParts.sector,
        }),
        [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
          ServiceCapability.IndexProvider,
          ServiceCapability.IndexReader,
        ]),
        [ClaimsServiceSchemaorg.termsOfService]: EXAMPLE_SIGNED_TERMS_PDF_URL,
        [`${ClaimsServiceSchemaorg.termsOfService}#hash`]: EXAMPLE_SIGNED_TERMS_PDF_HASH,
      },
    } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed.type).toEqual(['VerifiableCredential', 'ServiceOffering']);
    expect(parsed.credentialSubject.type).toBe('gx:ServiceOffering');
    expect(parsed.credentialSubject['gx:endpoint']).toEqual([{ 'gx:endpointURL': buildExampleHostedTenantBaseUrl({
      alternateName: tenantId,
      jurisdiction: urnParts.jurisdiction,
      version: urnParts.version,
      sector: urnParts.sector,
    }) }]);
    expect(parsed.proof).toEqual({
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc+jwt,header.payload.signature',
    });
    expect(mockKmsService.createCompactJws).toHaveBeenCalledWith(
      expect.objectContaining({ type: ['VerifiableCredential', 'ServiceOffering'] }),
      'tenant-vc-sign',
      testTenant1VaultId,
      'vc_sign',
      { typ: 'vc+ld+json+jwt', cty: 'vc+ld+json' },
    );
  });

  it('should return 404 for the research service offering artifact when digital twin is not enabled', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction}/${urnParts.version}/${urnParts.sector}/.well-known/service-offering-research.json`;

    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: testTenant1IdentifierUrn },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
        [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: urnParts.sector,
        [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
          alternateName: tenantId,
          jurisdiction: urnParts.jurisdiction,
          version: urnParts.version,
          sector: urnParts.sector,
        }),
        [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
          ServiceCapability.IndexProvider,
          ServiceCapability.IndexReader,
        ]),
      },
    } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });

    expect(response.status).toBe(404);
  });

  it('should return an independently selectable personal-backup service offering artifact', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = `/${tenantId}/cds-${urnParts.jurisdiction.toLowerCase()}/${urnParts.version}/${urnParts.sector}/.well-known/service-offering-personal-backup.json`;

    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockKmsService.getPublicJwks.mockResolvedValue({ keys: [{ kid: 'tenant-vc-sign', use: 'sig', purpose: 'vc_sign' }] } as any);
    mockKmsService.createCompactJws.mockResolvedValue('header.payload.signature');
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: testTenant1IdentifierUrn },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
        [ClaimsOrganizationSchemaorg.alternateName]: tenantId,
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: urnParts.sector,
        [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
          alternateName: tenantId,
          jurisdiction: urnParts.jurisdiction,
          version: urnParts.version,
          sector: urnParts.sector,
        }),
        [ClaimsServiceSchemaorg.serviceType]: ContinuityServiceCapability.DocumentBackupProvider,
        [ClaimsServiceSchemaorg.termsOfService]: EXAMPLE_SIGNED_TERMS_PDF_URL,
        [`${ClaimsServiceSchemaorg.termsOfService}#hash`]: EXAMPLE_SIGNED_TERMS_PDF_HASH,
      },
    } as any);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed.id).toContain(expectedUrl);
    expect(parsed.credentialSubject['gx:name']).toContain('Personal Backup');
    expect(parsed.proof).toEqual({
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc+jwt,header.payload.signature',
    });
    expect(mockKmsService.createCompactJws).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialSubject: expect.objectContaining({
          'gx:name': expect.stringContaining('Personal Backup'),
        }),
      }),
      'tenant-vc-sign',
      testTenant1VaultId,
      'vc_sign',
      { typ: 'vc+ld+json+jwt', cty: 'vc+ld+json' },
    );
  });

  it('should hide tenant dataspace publication endpoints when the tenant is disabled', async () => {
    const urnParts = parseTenantUrn(testTenant1IdentifierUrn)!;
    const tenantId = testTenant1AlternateName;
    const expectedUrl = buildGwDspaceVersionWellKnownPath({
      tenantId,
      jurisdiction: urnParts.jurisdiction,
      version: urnParts.version,
      sector: urnParts.sector,
    });

    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: testTenant1IdentifierUrn } as any);
    mockTenantsCacheManager.isTenantOperational.mockResolvedValue(false);

    const response = await invokeExpress(app, { method: 'GET', url: expectedUrl });
    expect(response.status).toBe(404);
  });
});

describe('Well-Known Legal Participant VC API', () => {

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the stored Legal Participant VC for the host', async () => {
    const hostDidDoc = { id: 'did:web:host' };
    const hostEntityConfig = {
      didDocument: hostDidDoc,
      governanceVc: { id: 'urn:uuid:host-legal-participant', issuer: 'did:web:host' },
    };

    mockTenantsCacheManager.getTenant.mockResolvedValue(hostEntityConfig);
    mockTenantsCacheManager.getDidDocument.mockResolvedValue(hostDidDoc as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: `/host/cds-${EXAMPLE_COVERAGE_SCOPE_EU}/v1/${HostNetworkTypes.Test}/.well-known/legal-participant.vc.json`,
    });

    expect(response.status).toBe(200);
    const parsed = JSON.parse(response.text);
    expect(parsed).toEqual({
      ...hostEntityConfig.governanceVc,
      proof: {
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt,header.payload.signature',
      },
    });
    expect(mockTenantsCacheManager.getTenant).toHaveBeenCalledWith('host');
  });
});

describe('DSP Discovery API', () => {
  beforeEach(() => {
    mockTenantsCacheManager.isTenantOperational.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return host DSP version metadata for a sector-scoped host catalog', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: buildGwDspaceVersionWellKnownPath({
        participantId: 'host',
        jurisdiction: 'eu',
        version: 'v1',
        hostNetwork: HostNetworkTypes.Test,
      }),
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME },
    });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed.protocolVersions).toEqual([
      {
        version: '2025-1',
        path: `/host/cds-eu/v1/${HostNetworkTypes.Test}/dsp`,
      },
    ]);
  });

  it('should return a sector-scoped host catalog artifact with dcat:service entries derived from serviceType capabilities', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);
    mockTenantsCacheManager.listAutodiscoverableTenants.mockResolvedValue([
      {
        didDocument: { id: testTenant1DidWebHosted },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: testTenant1AlternateName,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapability.IndexProvider,
            ServiceCapability.DigitalTwinProvider,
            ContinuityServiceCapability.DocumentBackupProvider,
            ContinuityServiceCapability.ImagingStudyProvider,
            ContinuityServiceCapability.BinaryObjectProvider,
          ]),
        },
      },
      {
        didDocument: { id: EXAMPLE_SECONDARY_TENANT_SERVICE_DID },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_SECONDARY_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapability.IndexReader,
            ServiceCapability.DigitalTwinReader,
          ]),
        },
      },
    ] as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: buildGwCatalogArtifactPath({
        participantId: 'host',
        jurisdiction: 'eu',
        version: 'v1',
        hostNetwork: HostNetworkTypes.Test,
      }),
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME },
    });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed['@type']).toBe('dcat:Catalog');
    expect(Array.isArray(parsed['dcat:service'])).toBe(true);
    expect(parsed['dcat:service']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-index.json`,
          '@type': 'dcat:DataService',
        }),
        expect.objectContaining({
          '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-research.json`,
          '@type': 'dcat:DataService',
        }),
        expect.objectContaining({
          '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-personal-backup.json`,
          '@type': 'dcat:DataService',
          'dcat:keyword': [
            ContinuityServiceCapability.DocumentBackupProvider,
            ContinuityServiceCapability.ImagingStudyProvider,
            ContinuityServiceCapability.BinaryObjectProvider,
          ],
        }),
      ]),
    );
    expect(parsed['dcat:dataset'][0]['dcat:service']).toEqual(
      expect.arrayContaining([
        { '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-index.json` },
        { '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-research.json` },
        { '@id': `http://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/${testTenant1AlternateName}/cds-es/v1/${DataspaceSectors.HealthResearch}/.well-known/service-offering-personal-backup.json` },
      ]),
    );
    expect(parsed['dcat:dataset'][0]['dcat:distribution'][0]['dcat:accessURL']).toBe(
      `https://${EXAMPLE_HOST_PUBLIC_HOSTNAME}/.well-known/did.json`,
    );
    expect(parsed['dcat:dataset']).toHaveLength(1);
    expect(mockTenantsCacheManager.listAutodiscoverableTenants).toHaveBeenCalledTimes(1);
  });

  it('should publish provider datasets when service claims are stored under provider.service', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: 'did:web:host' } as any);
    mockTenantsCacheManager.listAutodiscoverableTenants.mockResolvedValue([
      {
        didDocument: { id: testTenant1DidWebHosted },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        },
        provider: {
          service: {
            [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
            [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
              alternateName: testTenant1AlternateName,
              jurisdiction: 'ES',
              version: 'v1',
              sector: DataspaceSectors.HealthResearch,
            }),
            [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
              ServiceCapability.IndexProvider,
            ]),
          },
        },
      },
    ] as any);

    const response = await invokeExpress(app, {
      method: 'GET',
      url: buildGwCatalogArtifactPath({
        participantId: 'host',
        jurisdiction: 'eu',
        version: 'v1',
        hostNetwork: HostNetworkTypes.Test,
      }),
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME },
    });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed['dcat:dataset']).toHaveLength(1);
    expect(parsed['dcat:service']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@type': 'dcat:DataService',
          'dcat:keyword': [ServiceCapability.IndexProvider],
        }),
      ]),
    );
  });

  it('should return normalized published-provider discovery DTOs for backend consumers', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: EXAMPLE_HOSTING_OPERATOR_DID } as any);
    mockTenantsCacheManager.getTenant.mockResolvedValue({
      didDocument: { id: EXAMPLE_HOSTING_OPERATOR_DID },
      claims: {
        [ClaimsOrganizationSchemaorg.legalName]: 'Host Operator Example',
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
        [ClaimsServiceSchemaorg.areaServed]: `ES,${EXAMPLE_COVERAGE_SCOPE_EU}`,
      },
    } as any);
    mockTenantsCacheManager.listAutodiscoverableTenants.mockResolvedValue([
      {
        didDocument: { id: testTenant1DidWebHosted },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: testTenant1AlternateName,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: testTenant1AlternateName,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapability.IndexProvider,
            ServiceCapability.DigitalTwinProvider,
          ]),
        },
      },
      {
        didDocument: { id: EXAMPLE_SECONDARY_TENANT_SERVICE_DID },
        claims: {
          [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
          [ClaimsOrganizationSchemaorg.legalName]: EXAMPLE_SECONDARY_PROVIDER_LEGAL_NAME,
          [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
          [ClaimsServiceSchemaorg.category]: DataspaceSectors.HealthResearch,
          [ClaimsServiceSchemaorg.url]: buildExampleHostedTenantBaseUrl({
            alternateName: EXAMPLE_SECONDARY_PROVIDER_ALTERNATE_NAME,
            jurisdiction: 'ES',
            version: 'v1',
            sector: DataspaceSectors.HealthResearch,
          }),
          [ClaimsServiceSchemaorg.serviceType]: serializeServiceCapabilityTokens([
            ServiceCapability.IndexReader,
            ServiceCapability.DigitalTwinReader,
          ]),
        },
      },
    ] as any);

    const response = await invokeExpress(app, {
      method: 'POST',
      url: '/api/dataspace-discovery/providers',
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME, 'content-type': 'application/json' },
      body: {
        sector: DataspaceSectors.HealthResearch,
        providerCapability: ServiceCapability.IndexProvider,
        jurisdiction: 'ES',
        coverageScope: EXAMPLE_COVERAGE_SCOPE_EU,
      },
    });

    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(Array.isArray(parsed.providers)).toBe(true);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0]).toEqual(
      expect.objectContaining({
        providerDid: testTenant1DidWebHosted,
        hostingOperatorDid: EXAMPLE_HOSTING_OPERATOR_DID,
        title: EXAMPLE_PROVIDER_LEGAL_NAME,
      }),
    );
    expect(parsed.providers[0].record).toEqual(
      expect.objectContaining({
        providerDid: testTenant1DidWebHosted,
        serviceType: ServiceCapability.IndexProvider,
        category: DataspaceSectors.HealthResearch,
        areaServed: 'ES',
      }),
    );
    expect(parsed.hostingOperators).toEqual([
      expect.objectContaining({
        operatorDid: EXAMPLE_HOSTING_OPERATOR_DID,
        matchedCapabilities: [ServiceCapability.IndexProvider],
      }),
    ]);
    expect(parsed.hostingOperators[0].record).toEqual(
      expect.objectContaining({
        subjectId: EXAMPLE_HOSTING_OPERATOR_DID,
        coverageScope: EXAMPLE_COVERAGE_SCOPE_EU,
      }),
    );
  });

  it('returns active public notification projections without attachment bytes or subscriber data', async () => {
    mockTenantsCacheManager.getDidDocument.mockResolvedValue({ id: EXAMPLE_HOSTING_OPERATOR_DID } as any);
    mockTenantsCacheManager.listAutodiscoverableTenants.mockResolvedValue([{
      didDocument: { id: 'did:web:clinic.example' },
      collectionName: 'clinic-collection',
      claims: {
        [ClaimsOrganizationSchemaorg.alternateName]: 'clinic',
        [ClaimsOrganizationSchemaorg.name]: 'Example clinic',
        [ClaimsOrganizationSchemaorg.addressCountry]: 'CA-BC',
        [ClaimsServiceSchemaorg.category]: 'animal-care',
      },
    }] as any);
    mockVaultRepository.listContainersInSection.mockImplementation(async (_collection: string, section: string) => section === 'care-communication-requests'
      ? [{ id: 'notice-1', content: { claims: {
        [CommunicationRequestClaim.Status]: ['active'],
        [CommunicationRequestClaim.InformationProvider]: ['Organization/clinic'],
        [CommunicationRequestClaim.Note]: ['Dog blood needed'],
        [CommunicationRequestClaim.PayloadReference]: ['DocumentReference/content-1'],
        [CommunicationRequestClaim.About]: ['DocumentReference/instructions-1'],
        [CommunicationRequestClaim.AuthoredOn]: ['2026-10-20T00:00:00.000Z'],
        [CommunicationRequestClaim.OccurrencePeriodEnd]: ['2099-10-21T00:00:00.000Z'],
        [PublicAlertOperationalClaim.DatasetName]: ['ca-bc_animal-care_public_blood-donation_dog_alert'],
      } } }]
      : section === 'organization-document-references'
        ? [{ id: 'content-1', content: { claims: {
          [DocumentReferenceClaim.ContentType]: ['text/markdown'],
          [DocumentReferenceClaim.ContentData]: [Buffer.from('Call before travelling.').toString('base64')],
        } } }]
        : [] as any);
    mockKmsService.unprotectConfidentialData.mockImplementation(async (record: any) => record.content);

    const response = await invokeExpress(app, {
      method: 'POST', url: '/api/public-notifications/search',
      headers: { host: EXAMPLE_HOST_PUBLIC_HOSTNAME, 'content-type': 'application/json' },
      body: { datasetNames: ['ca-bc_animal-care_public_blood-donation_dog_alert'] },
    });
    const parsed = JSON.parse(response.text);

    expect(response.status).toBe(200);
    expect(parsed.notifications).toEqual([expect.objectContaining({ notificationId: 'notice-1', subject: 'Dog blood needed' })]);
    expect(JSON.stringify(parsed)).not.toMatch(/contentData|subscriber|recipient/i);
  });
});
