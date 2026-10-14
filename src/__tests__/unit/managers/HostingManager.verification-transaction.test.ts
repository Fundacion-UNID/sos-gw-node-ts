// TDD contract: each verification transaction starts with an isolated tenant repository and preserves exact Offer/controller evidence.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ClaimsOfferSchemaorg, ClaimsOrderSchemaorg, ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { getEnvSectionId } from '../../../utils/section-env';
import { DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE } from 'gdc-common-utils-ts/utils/didcomm-submit';
import {
  getLegalOrganizationVerificationController,
  getLegalOrganizationVerificationRepresentativePayload,
} from 'gdc-common-utils-ts/utils/legal-organization-verification-transaction';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import type { IServerConfig } from '../../../config';
import type { IStorageAdapter } from '../../../database/storage/IStorageAdapter';
import type { IKmsService } from '../../../gdc-backend-utils-node/models/IKmsService';
import type { ILogger } from '../../../loggers/ILogger';
import type { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import type { IVaultRepository } from '../../../database/repositories/vault/vault.repository';
import type { IHostRuntime } from '../../../managers/IHostRuntime';
import { ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST } from '../../data/example-payloads';
import { testClaimsRegisterTenantExpanded } from '../../data/organization.data';
import { HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS } from '../../../managers/hosting/hosting-claim-contracts';

const { HostingManager } = await import('../../../managers/HostingManager');
const EXAMPLE_SECTOR = Sector.HEALTH_CARE;
const EXAMPLE_HOST_COLLECTION = 'system_host';
const EXAMPLE_HOST_DID = 'did:web:host.example.org';
const EXAMPLE_ICA_BASE_URL = 'https://ica.example.org';
const EXAMPLE_ICA_POLL_URL = 'https://ica.example.org/poll/legal-org-verify';
const EXAMPLE_TENANT_ALTERNATE_NAME = 'acme-health';
const EXAMPLE_REQUEST_URL = '/host/cds-es/v1/test-network/registry/org.schema/Organization/_transaction';
const EXAMPLE_VERIFY_RESOURCE_TYPE = 'contract';
const EXAMPLE_TRANSACTION_RESPONSE_TYPE = 'Organization-verification-transaction-response-v1.0';
const EXAMPLE_NEXT_ACTION = 'Order/_batch';
const EXAMPLE_REQUEST_CONTENT_TYPE = DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE;
const EXAMPLE_ICA_RESPONSE_CONTENT_TYPE = 'application/json';
const EXAMPLE_ICA_DIDCOMM_RESPONSE_CONTENT_TYPE = 'application/didcomm-plain+json';
const EXAMPLE_ICA_VERIFY_RESPONSE_TYPE = 'VerifyResponse-v1.0';
const EXAMPLE_RESPONSE_STATUS_OK = '200';
const EXAMPLE_RESPONSE_STATUS_ACCEPTED = 202;
const EXAMPLE_ICA_RESPONSE_BUNDLE_TYPE = 'batch-response';
const EXAMPLE_TRANSACTION_BUNDLE_TYPE = 'transaction-response';

const mockVaultRepository = {
  vaultExists: jest.fn(async () => false),
  get: jest.fn(async () => undefined),
  getContainersInSection: jest.fn(async () => []),
  put: jest.fn(async () => undefined),
} as unknown as IVaultRepository;
const mockKmsService = {
  protectConfidentialData: jest.fn(async (doc: unknown) => doc),
  protectAttributesNameAndValue: jest.fn(async () => []),
  unprotectConfidentialData: jest.fn(async (doc: any) => doc?.content || doc),
} as unknown as IKmsService;
const mockTenantsCacheManager = {} as TenantsCacheManager;
const mockStorageAdapter = {} as IStorageAdapter;
const mockLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as ILogger;
const mockHostRuntime = {
  hostCollectionName: EXAMPLE_HOST_COLLECTION,
  hostDid: EXAMPLE_HOST_DID,
} as IHostRuntime;

const originalFetch = global.fetch;

function buildConfig(): IServerConfig {
  return {
    securityMode: 'demo',
    networkMode: 'test',
    fhirLegacy: false,
    jsonLegacy: false,
    didcommPlainEnabled: true,
    demoAllowInsecureBearer: true,
    nodeEnv: 'test',
    port: 3000,
    maxHeaderSize: 16384,
    apiHostname: 'testhost',
    hostExternalDomain: 'host.example.org',
    apiBaseUrl: 'https://host.example.org',
    namespace: 'test',
    sectorsAllowed: [EXAMPLE_SECTOR],
    allowedPaymentMethods: ['bank-transfer'],
    dbProvider: 'mem',
    storageProvider: 'mem',
    queueProvider: 'mem',
    host: {
      jurisdiction: 'ES',
    },
    mongo: {
      dbName: 'test',
    },
    firebase: {},
    ica: {
      mode: 'external',
      externalUrl: EXAMPLE_ICA_BASE_URL,
      jurisdiction: 'ES',
    },
  };
}

function buildTransactionJob(): JobRequest {
  const requestBody = JSON.parse(JSON.stringify(ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body));
  requestBody.data[0].resource.meta.claims = {
    ...testClaimsRegisterTenantExpanded,
    ...requestBody.data[0].resource.meta.claims,
    'org.schema.Organization.alternateName': EXAMPLE_TENANT_ALTERNATE_NAME,
  };
  delete requestBody.data[0].resource.meta.claims[ClaimsPersonSchemaorg.hasOccupation];
  requestBody.data[0].resource.meta.claims[ClaimsPersonSchemaorg.hasOccupationalRoleValue] = 'RESPRSN';
  return {
    tenantId: 'host',
    jurisdiction: 'es',
    sector: 'test-network',
    section: 'registry',
    format: 'org.schema',
    resourceType: 'Organization',
    action: '_transaction',
    requestUrl: EXAMPLE_REQUEST_URL,
    content: {
      jti: 'legal-organization-verification-request-001',
      thid: 'legal-organization-verification-thread-001',
      iss: 'did:web:portal.example.org',
      aud: 'did:web:host.example.org',
      type: 'application/api+json',
      body: requestBody,
      attachments: ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.attachments,
      meta: {
        jws: {
          protected: {
            alg: 'ES384',
            kid: 'portal-runtime-signing-key-001',
          },
        },
      },
    } as any,
  } as JobRequest;
}

function buildIssueJob(): JobRequest {
  const job = buildTransactionJob();
  job.action = '_issue';
  job.requestUrl = '/host/cds-es/v1/test-network/registry/org.schema/Organization/_issue';
  // These tests exercise ICA credential retrieval and controller-seat reuse.
  // Controller mutation has its own signer, DID, JWK and persistence suite.
  delete (job.content as any).body.data[0].resource.controller;
  return job;
}

function buildIcaVerifyResponse() {
  return {
    resourceType: 'Bundle',
    type: EXAMPLE_ICA_RESPONSE_BUNDLE_TYPE,
    data: [{
      type: EXAMPLE_ICA_VERIFY_RESPONSE_TYPE,
      resource: {
        sector: EXAMPLE_SECTOR,
      },
    }],
  };
}

function buildIcaVerifyCredentialResponse() {
  return {
    resourceType: 'Bundle',
    type: EXAMPLE_ICA_RESPONSE_BUNDLE_TYPE,
    data: [
      {
        type: 'Organization-verification-v1.0',
        resource: {
          id: 'urn:uuid:org-vc-001',
          issuer: 'did:web:ica.example.org',
          type: ['VerifiableCredential', 'OrganizationCredential'],
          credentialSubject: {
            id: 'did:web:provider.example.org:organization:taxid:VATES-B00112233',
            taxID: 'VATES-B00112233',
          },
        },
      },
      {
        type: 'LegalRepresentative-verification-v1.0',
        resource: {
          id: 'urn:uuid:rep-vc-001',
          issuer: 'did:web:ica.example.org',
          type: ['VerifiableCredential', 'LegalRepresentativeCredential'],
          credentialSubject: {
            id: 'did:web:controller.example.org',
            memberOf: {
              taxID: 'VATES-B00112233',
            },
          },
        },
      },
    ],
  };
}

describe('HostingManager legal organization verification transaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockVaultRepository.vaultExists as any).mockResolvedValue(false);
    (mockVaultRepository.get as any).mockReset().mockResolvedValue(undefined);
    (mockVaultRepository.getContainersInSection as any).mockResolvedValue([]);
    (mockVaultRepository.put as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('forwards host Organization/_transaction to ICA _verify and wraps the ICA response', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const icaVerifyResponse = buildIcaVerifyResponse();
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const config = buildConfig();
    config.host.jurisdiction = 'CA-BC';
    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      config,
      mockHostRuntime,
    );

    const job = buildTransactionJob();
    // The applicant country does not change the legal jurisdiction of an
    // Offer authored by the VetChain host.
    (job.content!.body!.data[0]!.resource as any).meta.claims[ClaimsOrganizationSchemaorg.addressCountry] = 'US';
    const response = await manager.process(job, 'test', false);

    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
    expect(fetchCalls[1]?.url).toBe(EXAMPLE_ICA_POLL_URL);
    expect(fetchCalls[0]?.init?.headers).toMatchObject({
      'content-type': EXAMPLE_REQUEST_CONTENT_TYPE,
    });

    const sentBody = JSON.parse(String(fetchCalls[0]?.init?.body || '{}'));
    expect(getLegalOrganizationVerificationController(sentBody.body)?.publicKeyJwk).toEqual(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body.data[0]?.resource?.controller?.publicKeyJwk,
    );
    expect(getLegalOrganizationVerificationRepresentativePayload(sentBody.body)?.email).toBe(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body.data[0]?.resource?.legalRepresentativePayload?.email,
    );
    expect(sentBody.attachments?.[0]?.data?.links?.[0]).toBe(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.attachments?.[0]?.data?.links?.[0],
    );
    expect(sentBody.body.data[0]?.resource?.meta?.claims?.[ClaimsServiceSchemaorg.serviceType]).toBe(
      testClaimsRegisterTenantExpanded[ClaimsServiceSchemaorg.serviceType],
    );
    expect(sentBody.body.data[0]?.meta).toBeUndefined();

    expect(response.body.type).toBe(EXAMPLE_TRANSACTION_BUNDLE_TYPE);
    expect(response.body.data[0]?.type).toBe(EXAMPLE_TRANSACTION_RESPONSE_TYPE);
    expect(response.body.data[0]?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
    expect(response.body.data[0]?.resource?.icaResponse).toEqual(icaVerifyResponse);
    expect(
      (response.body.data[0]?.resource as any)?.meta?.claims?.[ClaimsServiceSchemaorg.category],
    ).toBe(EXAMPLE_SECTOR);
    const offerId = String((response.body.data[0]?.resource as any)?.meta?.claims?.[ClaimsOfferSchemaorg.identifier] || '');
    expect(offerId).toMatch(/^urn:cds:CA-BC:v1:health-care:product:org\.schema:Offer:/);
    expect(response.body.data[0]?.resource?.next).toEqual({
      action: EXAMPLE_NEXT_ACTION,
      acceptedOffer: {
        identifier: offerId,
        identifierClaim: ClaimsOrderSchemaorg.acceptedOfferIdentifier,
      },
    });
    expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    expect((mockVaultRepository.put as any).mock.calls[0]?.[1]?.[0]?.content?.primaryDid).toBe(
      ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST.body.data[0]?.resource?.organization?.did,
    );
  });

  it('re-registers the deployment-authorized legacy representative controller through _transaction without a new Offer', async () => {
    const job = buildTransactionJob();
    (job.content!.meta as any).jws.protected.jwk = {
      kid: 'portal-runtime-signing-key-001',
      kty: 'AKP',
      alg: 'ML-DSA-44',
      pub: 'historical-portal-public-key',
      use: 'sig',
    };
    (job.content!.meta as any).jwe = {
      header: {
        skid: 'portal-runtime-encryption-key-001',
        jwk: {
          kid: 'portal-runtime-encryption-key-001',
          kty: 'OKP',
          crv: 'ML-KEM-768',
          x: 'historical-portal-encryption-key',
          use: 'enc',
        },
      },
    };
    process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER = 'true';
    const tenantVaultId = `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`;
    const tenantCollectionName = 'ES_VATES_B00112233_health-care';
    const storedTenant = {
      status: 'active',
      didDocument: { id: 'did:web:provider.example.org:organization:taxid:VATES-B00112233' },
      meta: {},
    };
    (mockVaultRepository.vaultExists as any).mockResolvedValue(true);
    (mockVaultRepository as any).get = jest.fn(async () => ({
      id: tenantVaultId,
      status: 'active',
      sequence: 0,
      content: storedTenant,
    }));
    (mockVaultRepository as any).createNewVault = jest.fn(async () => undefined);
    (mockKmsService as any).provisionKeys = jest.fn(async () => ({ keys: [] }));
    (mockTenantsCacheManager as any).getCollectionName = jest.fn(async () => tenantCollectionName);
    (mockTenantsCacheManager as any).refreshTenant = jest.fn(async () => storedTenant);
    const licenseDocuments: any[] = [];
    (mockVaultRepository.getContainersInSection as any).mockImplementation(
      async (_vaultId: string, sectionId: string) =>
        sectionId === getEnvSectionId('device-licenses') ? licenseDocuments : [],
    );
    (mockVaultRepository.put as any).mockImplementation(
      async (_vaultId: string, documents: any[], sectionId: string) => {
        if (sectionId === getEnvSectionId('device-licenses')) {
          for (const document of documents) {
            const index = licenseDocuments.findIndex(current => current.id === document.id);
            if (index >= 0) licenseDocuments[index] = document;
            else licenseDocuments.push(document);
          }
        }
        return true;
      },
    );
    global.fetch = (jest.fn() as any)
      .mockResolvedValueOnce({
        ok: false,
        status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
        headers: { get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: { get: () => EXAMPLE_ICA_RESPONSE_CONTENT_TYPE },
        json: async () => buildIcaVerifyCredentialResponse(),
      } as any) as any;

    try {
      const manager = new HostingManager(
        mockVaultRepository,
        mockKmsService,
        mockTenantsCacheManager,
        mockStorageAdapter,
        mockLogger,
        buildConfig(),
        mockHostRuntime,
      );
      const response = await manager.process(job, 'test', false);
      const resource = response.body.data[0]?.resource as any;

      expect(response.body.data[0]?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
      expect(resource.next).toBeUndefined();
      expect(resource.meta.claims[ClaimsOfferSchemaorg.identifier]).toBeUndefined();
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        EXAMPLE_HOST_COLLECTION,
        [expect.objectContaining({
          content: expect.objectContaining({
            didDocument: expect.objectContaining({ controller: [expect.any(String)] }),
          }),
        })],
        getEnvSectionId('tenants'),
      );
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        tenantCollectionName,
        [expect.objectContaining({ content: expect.objectContaining({ didDocument: expect.any(Object) }) })],
        getEnvSectionId('employees'),
      );
    } finally {
      delete process.env.HOST_LEGACY_REPRESENTATIVE_CONTROLLER;
      (mockVaultRepository.vaultExists as any).mockResolvedValue(false);
    }
  });

  it('resolves ICA jurisdiction from the trusted ICA did:web instead of the host route jurisdiction', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => buildIcaVerifyResponse(),
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      {
        ...buildConfig(),
        host: {
          jurisdiction: 'EU',
        },
        ica: {
          mode: 'external',
          externalUrl: EXAMPLE_ICA_BASE_URL,
          didWeb: 'did:web:34.175.75.120:ica:cds-ES:v1',
        },
      },
      mockHostRuntime,
    );

    await manager.process(buildTransactionJob(), 'test', false);

    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
  });

  it('preserves ICA verification payload when the ICA poll returns didcomm-plain+json', async () => {
    const icaVerifyResponse = buildIcaVerifyResponse();
    global.fetch = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      if ((global.fetch as any).mock.calls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_DIDCOMM_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const response = await manager.process(buildTransactionJob(), 'test', false);

    expect(response.body.data[0]?.resource?.icaResponse).toEqual(icaVerifyResponse);
  });

  it('projects credential resources into entry.vc while keeping the raw ICA response', async () => {
    const icaVerifyResponse = buildIcaVerifyCredentialResponse();
    global.fetch = jest.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      if ((global.fetch as any).mock.calls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const response = await manager.process(buildTransactionJob(), 'test', false);

    expect(response.body.data[0]?.resource?.icaResponse).toEqual(icaVerifyResponse);
    expect(response.body.data[0]?.vc).toEqual([
      icaVerifyResponse.data[0].resource,
      icaVerifyResponse.data[1].resource,
    ]);
  });

  it('returns OperationOutcome 400 when demo GW cannot resolve the trusted ICA jurisdiction', async () => {
    global.fetch = jest.fn() as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      {
        ...buildConfig(),
        host: {
          jurisdiction: 'EU',
        },
        ica: {
          mode: 'external',
          externalUrl: EXAMPLE_ICA_BASE_URL,
        },
      },
      mockHostRuntime,
    );

    const response = await manager.process(buildTransactionJob(), 'test', false);
    const errorEntry = response.body.data[0];

    expect(global.fetch).not.toHaveBeenCalled();
    expect(errorEntry?.response?.status).toBe('400');
    expect(errorEntry?.response?.outcome?.issue?.[0]?.diagnostics).toContain('ICA jurisdiction could not be resolved');
  });

  it('returns OperationOutcome 400 when _transaction omits Service.category', async () => {
    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const job = buildTransactionJob();
    delete (job.content as any).body.data[0].resource.meta.claims[ClaimsServiceSchemaorg.category];

    const response = await manager.process(job, 'test', false);
    const errorEntry = response.body.data[0];

    // Step 1: the manager must reject the request before ICA forwarding or
    // Offer creation because the sector claim is the minimum host input
    // contract for `_transaction`.
    expect(errorEntry?.response?.status).toBe('400');
    expect(errorEntry?.response?.outcome?.issue?.[0]?.diagnostics).toContain(
      `Missing required claim: '${HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS[1]}'`,
    );
  });

  it('rejects an organization.did that is not a DID before persisting onboarding state', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: Number(EXAMPLE_RESPONSE_STATUS_OK),
      headers: {
        get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
      },
      json: async () => buildIcaVerifyResponse(),
    })) as any;
    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );
    const job = buildTransactionJob();
    (job.content!.body.data[0].resource as any).organization.did = 'https://globaldatacare.es/not-a-did';

    const response = await manager.process(job, 'test', false);

    expect(response.body.data[0]?.response?.status).toBe('400');
    expect(JSON.stringify(response.body.data[0])).toContain('organization.did must be a valid DID');
    expect(mockVaultRepository.put).not.toHaveBeenCalled();
  });

  it('returns ICA credentials separately from the controller License activation code', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const icaVerifyResponse = buildIcaVerifyCredentialResponse();
    (icaVerifyResponse.data as any[]).push({
      type: 'ServiceController-verification-v1.0',
      resource: {
        id: 'urn:uuid:controller-vc-001',
        issuer: 'did:web:ica.example.org',
        type: ['VerifiableCredential', 'ServiceCredential', 'ServiceControllerCredential'],
        credentialSubject: {
          id: 'did:web:provider.example.org:service:tenant',
          owner: {
            additionalType: 'RESPRSN',
            sameAs: 'urn:multibase:zControllerHash',
            hasOccupation: { '@type': 'Occupation', occupationalCategory: 'ISCO-08|1330' },
            hasCredential: {
              material: 'urn:ietf:params:oauth:jwk-thumbprint:sha-256:controller-thumbprint',
            },
          },
        },
      },
    });
    const existingLicenseDoc = {
      id: 'license-seat-001',
      status: 'available',
      sequence: 0,
      content: {
        id: 'license-seat-001',
        tenantId: EXAMPLE_TENANT_ALTERNATE_NAME,
        orderId: 'existing-order-001',
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'available',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 86400,
      },
    };
    (mockVaultRepository.vaultExists as any).mockImplementation(async (vaultId: unknown) => (
      String(vaultId) === `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`
    ));
    (mockVaultRepository.getContainersInSection as any).mockResolvedValue([existingLicenseDoc]);
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const response = await manager.process(buildIssueJob(), 'test', false);
    const responseEntry = response.body.data[0];
    const claims = (responseEntry?.resource as any)?.meta?.claims || {};

    expect(responseEntry?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
    // Step 1: Organization/_issue exposes all ICA credentials as VCs and keeps
    // the complete raw ICA response separately.
    expect((responseEntry as any)?.vc).toEqual(
      (icaVerifyResponse.data as any[]).map((entry) => entry.resource),
    );
    expect((responseEntry as any)?.resource?.icaResponse).toEqual(icaVerifyResponse);
    expect((responseEntry as any)?.vc).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: expect.arrayContaining(['OrganizationCredential']),
      }),
      expect.objectContaining({
        type: expect.arrayContaining(['LegalRepresentativeCredential']),
      }),
      expect.objectContaining({
        type: expect.arrayContaining(['ServiceControllerCredential']),
      }),
    ]));
    expect((responseEntry as any)?.vc).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'License:Issued' }),
    ]));
    // Step 2: existing-tenant `_issue` is a controller/key/email reissue path,
    // not a new commercial onboarding. It must therefore not create a new
    // `org.schema.Offer.identifier`.
    expect(claims[ClaimsOfferSchemaorg.identifier]).toBeUndefined();
    // Step 3: no Offer means no workflow hint for `Order/_batch` either.
    expect((responseEntry as any)?.resource?.next).toBeUndefined();
    // Step 4: the License activation code is a separate claims projection. It
    // is not one of the ICA VCs and is not a License/_issue response entry.
    expect(claims['org.schema.IndividualProduct.serialNumber']).toEqual(expect.any(String));
    expect(claims['org.schema.IndividualProduct.category']).toBe('professional');
    expect(mockVaultRepository.put).toHaveBeenCalledWith(
      `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`,
      [expect.objectContaining({ id: 'license-seat-001' })],
      getEnvSectionId('device-licenses'),
    );
    expect(mockVaultRepository.put).not.toHaveBeenCalledWith(
      EXAMPLE_HOST_COLLECTION,
      expect.any(Array),
      getEnvSectionId('tenants'),
    );
  });

  it('resolves controller email from verified bearer payload in strict mode and falls back to stored role', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const icaVerifyResponse = buildIcaVerifyResponse();
    const existingLicenseDoc = {
      id: 'license-seat-002',
      status: 'available',
      sequence: 0,
      content: {
        id: 'license-seat-002',
        tenantId: EXAMPLE_TENANT_ALTERNATE_NAME,
        orderId: 'existing-order-002',
        userClass: 'employee',
        userCategory: 'default',
        type: 'mobile',
        status: 'available',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 86400,
      },
    };
    const existingControllerDoc = {
      id: 'employee-controller-001',
      status: 'active',
      sequence: 0,
      content: {
        id: 'employee-controller-001',
        claims: {
          'org.schema.Person.email': 'admin1@acme.org',
          'org.schema.Person.hasOccupation.identifier.value': 'RESPRSN',
        },
      },
    };
    (mockVaultRepository.vaultExists as any).mockImplementation(async (vaultId: unknown) => (
      String(vaultId) === `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`
    ));
    (mockVaultRepository.getContainersInSection as any).mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getEnvSectionId('device-licenses')) return [existingLicenseDoc];
      if (sectionId === getEnvSectionId('employees')) return [existingControllerDoc];
      return [];
    });
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const strictJob = buildIssueJob();
    const strictEntry = (strictJob.content as any).body.data[0];
    delete strictEntry.resource.meta.claims['org.schema.Person.email'];
    delete strictEntry.resource.meta.claims['org.schema.Person.hasOccupation'];
    delete strictEntry.resource.meta.claims['org.schema.Person.hasOccupation.identifier.value'];
    (strictJob.content as any).meta = {
      bearer: {
        token: 'Bearer strict-token',
        jwt: {
          header: { alg: 'RS256', kid: 'strict-key-001' },
          payload: { email: 'admin1@acme.org', sub: 'controller-sub-001' },
        },
      },
    };

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      {
        ...buildConfig(),
        securityMode: 'strict',
        demoAllowInsecureBearer: false,
      },
      mockHostRuntime,
    );

    const response = await manager.process(strictJob, 'test', false);
    const claims = (response.body.data[0]?.resource as any)?.meta?.claims || {};

    expect(response.body.data[0]?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
    expect(claims['org.schema.IndividualProduct.serialNumber']).toEqual(expect.any(String));
    expect(mockVaultRepository.put).toHaveBeenCalledWith(
      `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`,
      [expect.objectContaining({
        id: 'license-seat-002',
        content: expect.objectContaining({
          issuedToEmail: 'admin1@acme.org',
          issuedToRole: 'RESPRSN',
        }),
      })],
      getEnvSectionId('device-licenses'),
    );
  });

  it('reuses an already assigned controller license even when no available seat remains', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const icaVerifyResponse = buildIcaVerifyResponse();
    const assignedControllerLicenseDoc = {
      id: 'license-seat-reuse-001',
      status: 'active',
      sequence: 4,
      content: {
        id: 'license-seat-reuse-001',
        tenantId: EXAMPLE_TENANT_ALTERNATE_NAME,
        orderId: 'existing-order-003',
        userClass: 'employee',
        userCategory: 'default',
        type: 'web',
        status: 'active',
        plan: 'default',
        renewalCycle: '12m',
        reactivationEnabled: false,
        exp: Math.floor(Date.now() / 1000) + 86400,
        issuedToEmail: 'controller@example.org',
        issuedToRole: 'RESPRSN',
        ownerOrganizationId: 'urn:org:taxid:VATES-B00112233',
        activationCode: 'lic-old-code-001',
        activatedAt: Math.floor(Date.now() / 1000) - 3600,
        deviceId: 'device-old-001',
      },
    };
    (mockVaultRepository.vaultExists as any).mockImplementation(async (vaultId: unknown) => (
      String(vaultId) === `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`
    ));
    (mockVaultRepository.getContainersInSection as any).mockImplementation(async (_vaultId: string, sectionId: string) => {
      if (sectionId === getEnvSectionId('device-licenses')) return [assignedControllerLicenseDoc];
      return [];
    });
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const response = await manager.process(buildIssueJob(), 'test', false);
    const claims = (response.body.data[0]?.resource as any)?.meta?.claims || {};

    expect(response.body.data[0]?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
    expect(fetchCalls[0]?.url).toBe(
      `${EXAMPLE_ICA_BASE_URL}/ica/cds-ES/v1/${EXAMPLE_SECTOR}/terms/pdf/${EXAMPLE_VERIFY_RESOURCE_TYPE}/_verify`,
    );
    expect(claims['org.schema.IndividualProduct.serialNumber']).toEqual(expect.any(String));
    expect(mockVaultRepository.put).toHaveBeenCalledWith(
      `${EXAMPLE_SECTOR}_${EXAMPLE_TENANT_ALTERNATE_NAME}`,
      [expect.objectContaining({
        id: 'license-seat-reuse-001',
        content: expect.objectContaining({
          status: 'issued',
          issuedToEmail: 'controller@example.org',
          issuedToRole: 'RESPRSN',
        }),
      })],
      getEnvSectionId('device-licenses'),
    );
  });

  it('returns the canonical Offer identifier only for first-time legal _transaction onboarding', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const icaVerifyResponse = buildIcaVerifyResponse();
    (mockVaultRepository.vaultExists as any).mockImplementation(async () => false);
    (mockVaultRepository.getContainersInSection as any).mockResolvedValue([]);
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const normalizedUrl = typeof url === 'string' ? url : String(url);
      fetchCalls.push({ url: normalizedUrl, init });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: EXAMPLE_RESPONSE_STATUS_ACCEPTED,
          headers: {
            get: (name: string) => name.toLowerCase() === 'location' ? EXAMPLE_ICA_POLL_URL : null,
          },
        } as any;
      }
      return {
        ok: true,
        status: Number(EXAMPLE_RESPONSE_STATUS_OK),
        headers: {
          get: (name: string) => name.toLowerCase() === 'content-type' ? EXAMPLE_ICA_RESPONSE_CONTENT_TYPE : null,
        },
        json: async () => icaVerifyResponse,
      } as any;
    }) as any;

    const manager = new HostingManager(
      mockVaultRepository,
      mockKmsService,
      mockTenantsCacheManager,
      mockStorageAdapter,
      mockLogger,
      buildConfig(),
      mockHostRuntime,
    );

    const response = await manager.process(buildTransactionJob(), 'test', false);
    const responseEntry = response.body.data[0];
    const claims = (responseEntry?.resource as any)?.meta?.claims || {};
    const offerId = String(claims[ClaimsOfferSchemaorg.identifier] || '');

    // Step 1: first-time legal `_transaction` must create the canonical Offer.
    expect(responseEntry?.response?.status).toBe(EXAMPLE_RESPONSE_STATUS_OK);
    expect(offerId).toContain(':Offer:');
    // Step 2: the workflow hint may mirror it, but the claim path remains the
    // source of truth for `Order/_batch`.
    expect((responseEntry as any)?.resource?.next?.acceptedOffer?.identifier).toBe(offerId);
    expect((responseEntry as any)?.resource?.next?.acceptedOffer?.identifierClaim).toBe(
      ClaimsOrderSchemaorg.acceptedOfferIdentifier,
    );
  });
});
