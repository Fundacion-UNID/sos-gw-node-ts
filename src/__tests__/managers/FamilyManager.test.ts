// Flow contract: family lifecycle tests preserve exact Offer, controller contact, subject, license-pool, and authenticated-owner bindings.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { mock, MockProxy } from 'jest-mock-extended';
import { tmpdir } from 'os';
import path from 'path';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { BundleJsonApi, BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import {
  buildExampleFamilyRegistrationClaims,
  buildExampleFamilyRegistrationContent,
  EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE,
  mergeIndividualOrganizationClaims,
} from 'gdc-common-utils-ts';
import { PDFDocument } from 'pdf-lib';
import { DocumentReferenceClaim } from 'gdc-common-utils-ts/models/interoperable-claims/document-reference-claims';
import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsPersonSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import {
  EXAMPLE_CONTROLLER_IDENTIFIER_TYPE,
  EXAMPLE_DOCUMENT_REFERENCE_CONTENT_TYPE_PDF,
  EXAMPLE_FORM_CONTROLLER_PHONE,
  EXAMPLE_FORM_SUBJECT_IDENTIFIER_VALUE,
  EXAMPLE_FORM_SUBJECT_PHONE,
  EXAMPLE_KYC_CONTROLLER_BIRTHDATE,
  EXAMPLE_KYC_CONTROLLER_CITY,
  EXAMPLE_KYC_CONTROLLER_COUNTRY,
  EXAMPLE_KYC_CONTROLLER_CREATED_AT,
  EXAMPLE_KYC_CONTROLLER_FAMILY_NAME,
  EXAMPLE_KYC_CONTROLLER_GENDER_MALE,
  EXAMPLE_KYC_CONTROLLER_GIVEN_NAME,
  EXAMPLE_KYC_CONTROLLER_IDENTIFIER,
  EXAMPLE_KYC_CONTROLLER_LANGUAGE,
  EXAMPLE_KYC_CONTROLLER_POSTAL_CODE,
  EXAMPLE_KYC_CONTROLLER_STREET_ADDRESS,
  EXAMPLE_KYC_CONTROLLER_TELEPHONE,
  EXAMPLE_KYC_CONTROLLER_UPDATED_AT,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_KYC_CONTROLLER_UUID,
  EXAMPLE_KYC_CONTROLLER_VERIFIED_AT,
  EXAMPLE_PDF_CONSENT_DATE,
  EXAMPLE_SERVICE_PROVIDER_DOMAIN,
  EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
  EXAMPLE_REGISTERED_SUBJECT_BIRTH_YEAR,
  EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
  EXAMPLE_SUBJECT_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { getSubjectScopedSectionId } from '../../utils/individual-sections';
import { getEnvSectionId } from '../../utils/section-env';
import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { IStorageAdapter } from '../../database/storage/IStorageAdapter';
import { ILogger } from '../../loggers/ILogger';
import { FamilyManager } from '../../managers/FamilyManager';
import { AnimalIndividualRegistration, FamilyRegistrationStatus, GatewayClaim } from '../../shared/gateway-claim-contract';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import { mockKmsService } from '../mocks/kms.mock';
import { buildClaimsFromIndividualFormPdf } from '../../utils/individual-form-pdf';
import { testDefaultTenantServiceTypeClaim } from '../data/organization.data';
import { SUBJECT_SECTION_INDIVIDUAL } from '../../constants/domain';
import { REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META } from '../../utils/secure-route-bearer-binding';
import {
  buildSignedIndividualPdfFixture,
  SIGNED_INDIVIDUAL_PDF_EXPECTED,
} from '../utils/signed-individual-pdf-fixture';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const TENANT_ID = 'acme';
const SECTOR = Sector.HEALTH_CARE;
const COLLECTION_NAME = `${SECTOR}_${TENANT_ID}`;
const TENANT_DID = 'did:web:host.example.com';
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HUMAN_DRAFT_BIRTH_YEAR = '2022';
const HUMAN_DRAFT_IDENTIFIER = '00000000-0000-4000-8000-000000000088';
const HUMAN_COMPLETED_NAME = 'Patricia Doe';
const INDIVIDUAL_SELF_ROLE = 'ONESELF';

/**
 * Base set of already-normalized claims (org.schema.<Resource>.<field>) that satisfy
 * the minimum required by FamilyManager.extractResources(): Organization + Service
 * (Person is optional for individual organizations).
 * `termsOfService` is an https URL so handleServiceAttachment skips file upload.
 */
const BASE_CLAIMS: Record<string, unknown> = buildExampleFamilyRegistrationClaims({
  [ClaimsServiceSchemaorg.category]: SECTOR,
  [ClaimsOrganizationSchemaorg.identifierType]: 'UUID',
  [ClaimsOrganizationSchemaorg.identifierValue]: randomUUID(),
  [ClaimsPersonSchemaorg.identifierType]: 'UUID',
  [ClaimsPersonSchemaorg.identifierValue]: randomUUID(),
  [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
});

const TEST_KYC_PROFILE = Object.freeze({
  uuid: EXAMPLE_KYC_CONTROLLER_UUID,
  user_uuid: EXAMPLE_KYC_CONTROLLER_USER_UUID,
  first_name: EXAMPLE_KYC_CONTROLLER_GIVEN_NAME,
  last_name: EXAMPLE_KYC_CONTROLLER_FAMILY_NAME,
  nationality: null,
  country: EXAMPLE_KYC_CONTROLLER_COUNTRY,
  ip_country: null,
  city: EXAMPLE_KYC_CONTROLLER_CITY,
  address: EXAMPLE_KYC_CONTROLLER_STREET_ADDRESS,
  id_number: EXAMPLE_KYC_CONTROLLER_IDENTIFIER,
  postal_code: EXAMPLE_KYC_CONTROLLER_POSTAL_CODE,
  phone_number: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
  birthdate: EXAMPLE_KYC_CONTROLLER_BIRTHDATE,
  kyc_verified_at: EXAMPLE_KYC_CONTROLLER_VERIFIED_AT,
  gender: EXAMPLE_KYC_CONTROLLER_GENDER_MALE,
  language: EXAMPLE_KYC_CONTROLLER_LANGUAGE,
  created_at: EXAMPLE_KYC_CONTROLLER_CREATED_AT,
  updated_at: EXAMPLE_KYC_CONTROLLER_UPDATED_AT,
  primary_wallet_address: null,
  primary_wallet: null,
} as const);

function makeBatchJob(overrideClaims: Record<string, unknown> = {}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    jurisdiction: 'ES',
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_batch',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-registration-form-v1.0',
          resource: {
            resourceType: 'Organization',
            meta: { claims: { ...BASE_CLAIMS, ...overrideClaims } },
          },
        }],
      },
    },
  };
}

function makeTransactionJob(
  overrideClaims: Record<string, unknown> = {},
  attachments?: Array<Record<string, unknown>>,
): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    jurisdiction: 'ES',
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_transaction',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'Family-registration-form-v1.0',
          resource: {
            resourceType: 'Organization',
            meta: { claims: { ...BASE_CLAIMS, ...overrideClaims } },
          },
        }],
      },
      ...(attachments ? { attachments } : {}),
    },
  };
}

function makeSearchJob(overrideClaims: Record<string, unknown> = {}, bearerPayload?: Record<string, unknown>): JobRequest {
  const ownerEmail = String(overrideClaims[ClaimsOrganizationSchemaorg.ownerEmail] ?? BASE_CLAIMS[ClaimsOrganizationSchemaorg.ownerEmail] ?? '').trim();
  const ownerPhone = String(overrideClaims[ClaimsOrganizationSchemaorg.ownerTelephone] ?? EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE).trim();
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_search',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      meta: { bearer: { jwt: { payload: bearerPayload || {
        sub: 'verified-owner-account',
        ...(ownerEmail ? { email: ownerEmail, email_verified: true } : {}),
        ...(ownerPhone ? { phone_number: ownerPhone, phone_number_verified: true } : {}),
      } } } } as any,
      body: {
        data: [{
          type: 'Family-search-v1.0',
          resource: {
            resourceType: 'Organization',
            meta: { claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE,
              [ClaimsOrganizationSchemaorg.ownerEmail]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.ownerEmail]),
              [ClaimsOrganizationSchemaorg.alternateName]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.alternateName]),
              [ClaimsServiceSchemaorg.category]: SECTOR,
              ...overrideClaims,
            } },
          },
        }],
      },
    },
  };
}

/** Confirms one exact pending family Offer. */
function makeOrderJob(offerId: string): JobRequest {
  return {
    id: randomUUID(), status: JobStatus.DRAFT, sequence: 0, createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID, jurisdiction: 'CA-BC', sector: SECTOR,
    section: 'individual', format: 'org.schema', action: '_batch', resourceType: 'Order',
    content: {
      jti: randomUUID(), thid: randomUUID(), iss: 'did:web:client.example.com', aud: TENANT_DID,
      type: 'application/api+json',
      body: { data: [{
        type: 'Family-order-request-v1.0',
        resource: {
          resourceType: 'Order',
          meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } },
        },
      }] },
    },
  };
}

async function createIndividualOnboardingTemplateBase64(): Promise<string> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([600, 800]);
  const form = pdf.getForm();

  const alternateNameField = form.createTextField('controllerAlternateName');
  alternateNameField.addToPage(page, { x: 20, y: 740, width: 200, height: 20 });
  const emailField = form.createTextField('controllerEmail');
  emailField.addToPage(page, { x: 20, y: 700, width: 200, height: 20 });
  const consentDateField = form.createTextField('docDate');
  consentDateField.addToPage(page, { x: 20, y: 660, width: 200, height: 20 });
  const providerField = form.createTextField('serviceProviderDomain');
  providerField.addToPage(page, { x: 20, y: 620, width: 200, height: 20 });
  const selfField = form.createCheckBox('controllerIsSubject');
  selfField.addToPage(page, { x: 20, y: 580, width: 20, height: 20 });

  return Buffer.from(await pdf.save()).toString('base64');
}

function makePdfDraftJob(input: {
  templateBytesBase64: string;
  formFields?: Record<string, unknown>;
  kyc?: Record<string, unknown>;
  claims?: Record<string, unknown>;
}): JobRequest {
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'pdf',
    action: '_create',
    resourceType: 'DocumentReference',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      body: {
        data: [{
          type: 'DocumentReference',
          resource: {
            resourceType: 'DocumentReference',
            meta: {
              claims: {
                [ClaimsOrganizationSchemaorg.identifier]: EXAMPLE_SUBJECT_DID,
                [ClaimsServiceSchemaorg.category]: SECTOR,
                ...(input.claims || {}),
              },
              template: {
                sector: SECTOR,
                language: 'es',
                version: 'v1',
                templateBytesBase64: input.templateBytesBase64,
              },
              formFields: {
                controllerIsSubject: true,
                controllerAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
                controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
                controllerPhone: EXAMPLE_FORM_CONTROLLER_PHONE,
                controllerIdType: EXAMPLE_CONTROLLER_IDENTIFIER_TYPE,
                docDate: EXAMPLE_PDF_CONSENT_DATE,
                serviceProviderDomain: EXAMPLE_SERVICE_PROVIDER_DOMAIN,
                ...(input.formFields || {}),
              },
              ...(input.kyc ? { kyc: input.kyc } : {}),
            },
          },
        }],
      },
    },
  };
}

function makePurgeJob(overrideClaims: Record<string, unknown> = {}, bearerPayload?: Record<string, unknown>): JobRequest {
  const ownerEmail = String(overrideClaims[ClaimsOrganizationSchemaorg.ownerEmail] ?? BASE_CLAIMS[ClaimsOrganizationSchemaorg.ownerEmail] ?? '').trim();
  const ownerPhone = String(overrideClaims[ClaimsOrganizationSchemaorg.ownerTelephone] ?? EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE).trim();
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_purge',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      meta: { bearer: { jwt: { payload: bearerPayload || {
        sub: 'verified-owner-account',
        ...(ownerEmail ? { email: ownerEmail, email_verified: true } : {}),
        ...(ownerPhone ? { phone_number: ownerPhone, phone_number_verified: true } : {}),
      } } } } as any,
      body: {
        data: [{
          type: 'Family-purge-request-v1.0',
          resource: {
            resourceType: 'Organization',
            meta: { claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE,
              [ClaimsOrganizationSchemaorg.ownerEmail]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.ownerEmail]),
              [ClaimsOrganizationSchemaorg.alternateName]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.alternateName]),
              [ClaimsServiceSchemaorg.category]: SECTOR,
              ...overrideClaims,
            } },
          },
        }],
      },
    },
  };
}

function makeDisableJob(overrideClaims: Record<string, unknown> = {}, bearerPayload?: Record<string, unknown>): JobRequest {
  const ownerEmail = String(overrideClaims[ClaimsOrganizationSchemaorg.ownerEmail] ?? BASE_CLAIMS[ClaimsOrganizationSchemaorg.ownerEmail] ?? '').trim();
  const ownerPhone = String(overrideClaims[ClaimsOrganizationSchemaorg.ownerTelephone] ?? EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE).trim();
  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: TENANT_ID,
    sector: SECTOR,
    section: 'individual',
    format: 'org.schema',
    action: '_disable',
    resourceType: 'Organization',
    content: {
      jti: randomUUID(),
      thid: randomUUID(),
      iss: 'did:web:client.example.com',
      aud: `did:web:${TENANT_ID}.example.com`,
      type: 'application/api+json',
      meta: { bearer: { jwt: { payload: bearerPayload || {
        sub: 'verified-owner-account',
        ...(ownerEmail ? { email: ownerEmail, email_verified: true } : {}),
        ...(ownerPhone ? { phone_number: ownerPhone, phone_number_verified: true } : {}),
      } } } } as any,
      body: {
        data: [{
          type: 'Family-disable-request-v1.0',
          resource: {
            resourceType: 'Organization',
            meta: { claims: {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE,
              [ClaimsOrganizationSchemaorg.ownerEmail]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.ownerEmail]),
              [ClaimsOrganizationSchemaorg.alternateName]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.alternateName]),
              [ClaimsServiceSchemaorg.category]: SECTOR,
              ...overrideClaims,
            } },
          },
        }],
      },
    },
  };
}

async function extractPdfFormFieldsFromFixture(pdfBytes: Buffer): Promise<Record<string, string>> {
  const document = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const fields: Record<string, string> = {};
  for (const field of document.getForm().getFields()) {
    const name = field.getName()?.trim();
    if (!name) continue;

    let value = '';
    if (typeof (field as any).getText === 'function') {
      value = String((field as any).getText() || '').trim();
    } else if (typeof (field as any).getSelected === 'function') {
      const selected = (field as any).getSelected();
      value = Array.isArray(selected) ? selected.join(', ').trim() : String(selected || '').trim();
    } else if (typeof (field as any).isChecked === 'function') {
      value = (field as any).isChecked() ? 'true' : 'false';
    }
    if (value) fields[name] = value;
  }
  return fields;
}

function extractNaturalPersonSignerSubjectFromPdf(pdfBytes: Buffer): string {
  const pdfAsLatin1 = pdfBytes.toString('latin1');
  const byteRangeRegex = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const match = byteRangeRegex.exec(pdfAsLatin1);
  if (!match) {
    throw new Error('Real PDF fixture is missing ByteRange.');
  }

  const [start1, length1, start2] = match.slice(1, 4).map((value) => Number.parseInt(value, 10));
  const signatureWindow = pdfBytes.subarray(start1 + length1, start2);
  const lt = signatureWindow.indexOf(0x3c);
  const gt = signatureWindow.lastIndexOf(0x3e);
  let hex = signatureWindow.subarray(lt + 1, gt).toString('latin1').replace(/[^0-9a-fA-F]/g, '');
  while (hex.endsWith('00')) {
    hex = hex.slice(0, -2);
  }

  const tempDir = mkdtempSync(path.join(tmpdir(), 'gw-family-pdf-fixture-'));
  try {
    const signatureDerPath = path.join(tempDir, 'signature.der');
    const certsPath = path.join(tempDir, 'certs.pem');
    writeFileSync(signatureDerPath, Buffer.from(hex, 'hex'));
    execFileSync('openssl', ['pkcs7', '-inform', 'DER', '-in', signatureDerPath, '-print_certs', '-out', certsPath]);

    const certs = (readFileSync(certsPath, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []);
    for (const [index, certPem] of certs.entries()) {
      const certPath = path.join(tempDir, `cert-${index}.pem`);
      writeFileSync(certPath, `${certPem}\n`);
      const subject = execFileSync(
        'openssl',
        ['x509', '-in', certPath, '-noout', '-subject', '-nameopt', 'RFC2253'],
        { encoding: 'utf8' },
      ).trim();
      if (/\bserialNumber=IDCES-/i.test(subject)) {
        return subject.replace(/^subject=/i, '');
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  throw new Error('Natural-person signer certificate not found in real PDF fixture.');
}

const signedIndividualPdfFixture = buildSignedIndividualPdfFixture();

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('FamilyManager', () => {
  let manager: FamilyManager;
  let mockVaultRepository: MockProxy<IVaultRepository>;
  let mockStorageAdapter: MockProxy<IStorageAdapter>;
  let mockLogger: MockProxy<ILogger>;
  let mockTenantsCacheManager: jest.Mocked<Pick<TenantsCacheManager, 'getCollectionName' | 'getTenantDid' | 'isTenantOperational'>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockVaultRepository = mock<IVaultRepository>();
    mockStorageAdapter = mock<IStorageAdapter>();
    mockLogger = mock<ILogger>();

    mockTenantsCacheManager = {
      getCollectionName: jest.fn().mockResolvedValue(COLLECTION_NAME),
      getTenantDid: jest.fn().mockResolvedValue(TENANT_DID),
      isTenantOperational: jest.fn().mockResolvedValue(true),
    };

    manager = new FamilyManager(
      mockVaultRepository,
      mockKmsService as any,
      mockTenantsCacheManager as unknown as TenantsCacheManager,
      mockStorageAdapter as any,
      mockLogger as any,
      { allowedPaymentMethods: ['Stripe'] } as any,
    );
  });

  // -------------------------------------------------------------------------
  // _batch — processFamilyRegistrationEntry
  // -------------------------------------------------------------------------

  describe('_batch / processFamilyRegistrationEntry', () => {
    it('stores a cardless human draft when the verified controller provides a birth year but no name', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeBatchJob({
        [ClaimsOrganizationSchemaorg.alternateName]: '',
        [ClaimsOrganizationSchemaorg.sameAs]: '',
        [ClaimsPersonSchemaorg.birthDate]: HUMAN_DRAFT_BIRTH_YEAR,
        [ClaimsOrganizationSchemaorg.memberRole]: '',
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('201');
      expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
        [ClaimsPersonSchemaorg.birthDate]: HUMAN_DRAFT_BIRTH_YEAR,
        [ClaimsOrganizationSchemaorg.memberRole]: INDIVIDUAL_SELF_ROLE,
        [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.DraftSaved,
      }));
      expect(entry.resource?.meta?.claims?.[ClaimsOrganizationSchemaorg.sameAs]).toBe('');
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        COLLECTION_NAME,
        [expect.objectContaining({ status: EntityLifecycleStatus.Pending })],
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
    });

    it('rejects a nameless human draft without a valid birth year or date', async () => {
      const response = await manager.process(makeBatchJob({
        [ClaimsOrganizationSchemaorg.alternateName]: '',
        [ClaimsOrganizationSchemaorg.sameAs]: '',
        [ClaimsPersonSchemaorg.birthDate]: '',
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('400');
      expect(entry.response?.outcome?.issue?.[0]?.diagnostics).toContain(ClaimsPersonSchemaorg.birthDate);
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('resumes an owned pending human draft without creating a second individual', async () => {
      const pendingDocument = {
        id: HUMAN_DRAFT_IDENTIFIER,
        status: EntityLifecycleStatus.Pending,
        sequence: 2,
        indexed: { attributes: [], hmac: { id: 'urn:test', type: 'Sha256HmacKey2019' } },
        jwe: { ciphertext: '' },
      } as any;
      mockVaultRepository.get.mockResolvedValue(pendingDocument);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOrganizationSchemaorg.identifierValue]: HUMAN_DRAFT_IDENTIFIER,
          [ClaimsOrganizationSchemaorg.alternateName]: '',
          [ClaimsOrganizationSchemaorg.sameAs]: '',
          [ClaimsPersonSchemaorg.birthDate]: HUMAN_DRAFT_BIRTH_YEAR,
          [ClaimsOrganizationSchemaorg.memberRole]: INDIVIDUAL_SELF_ROLE,
        },
      }) as any);
      mockKmsService.protectConfidentialData.mockImplementation(async (document: any) => document);

      const response = await manager.process(makeBatchJob({
        [ClaimsOrganizationSchemaorg.identifierValue]: HUMAN_DRAFT_IDENTIFIER,
        [ClaimsOrganizationSchemaorg.alternateName]: HUMAN_COMPLETED_NAME,
        [ClaimsOrganizationSchemaorg.sameAs]: EXAMPLE_SUBJECT_DID,
        [ClaimsPersonSchemaorg.birthDate]: HUMAN_DRAFT_BIRTH_YEAR,
        [ClaimsOrganizationSchemaorg.memberRole]: INDIVIDUAL_SELF_ROLE,
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('200');
      expect(entry.resource?.id).toBe(HUMAN_DRAFT_IDENTIFIER);
      expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
        [ClaimsOrganizationSchemaorg.alternateName]: HUMAN_COMPLETED_NAME,
        [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.ResumeRequired,
      }));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        COLLECTION_NAME,
        [expect.objectContaining({ id: HUMAN_DRAFT_IDENTIFIER, sequence: 3 })],
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
    });

    it('stores an incomplete animal as pending without a card and keeps SELF separate from its owner controller', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeBatchJob({
        [ClaimsServiceSchemaorg.category]: 'animal-care' as Sector,
        [ClaimsOrganizationSchemaorg.additionalType]: 'animal',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
        [ClaimsOrganizationSchemaorg.sameAs]: '',
        [ClaimsOrganizationSchemaorg.memberAdditionalType]: '',
        [ClaimsOrganizationSchemaorg.memberRole]: 'ONESELF',
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('201');
      expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
        [ClaimsOrganizationSchemaorg.memberRole]: 'ONESELF',
        [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.DraftSaved,
      }));
      expect(entry.resource?.meta?.claims?.[ClaimsOrganizationSchemaorg.sameAs]).toBeFalsy();
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        COLLECTION_NAME,
        [expect.objectContaining({ status: EntityLifecycleStatus.Pending })],
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
    });

    it('rejects an animal envelope that assigns the controller RESPRSN role to its SELF member', async () => {
      const response = await manager.process(makeBatchJob({
        [ClaimsServiceSchemaorg.category]: 'animal-care' as Sector,
        [ClaimsOrganizationSchemaorg.additionalType]: 'animal',
        [ClaimsOrganizationSchemaorg.memberRole]: 'RESPRSN',
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('400');
      expect(entry.response?.outcome).toEqual(expect.objectContaining({ issue: expect.arrayContaining([
        expect.objectContaining({ diagnostics: expect.stringMatching(/ONESELF/) }),
      ]) }));
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('new_created: stores doc and returns status new_created when vault has no match', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('new_created');
      expect(entry.response?.status).toBe('201');
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
    });

    it('creates a represented individual from a verified email without requiring telephone or legal Person claims', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);
      const job = makeBatchJob({
        [ClaimsOrganizationSchemaorg.ownerEmail]: 'controller@example.org',
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        'org.schema.Organization.member.role': 'RESPRSN',
      });
      const claims = (job.content as any).body.data[0].resource.meta.claims as Record<string, unknown>;
      for (const claim of Object.keys(claims)) {
        if (claim.startsWith('org.schema.Person.')) delete claims[claim];
      }

      const response = await manager.process(job);
      const entry = ((response.body as BundleJsonApi).data[0]) as BundleEntry;

      expect(entry.response?.status).toBe('201');
      expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
        [ClaimsOrganizationSchemaorg.ownerEmail]: 'controller@example.org',
        'org.schema.Organization.member.role': 'RESPRSN',
        'org.schema.FamilyRegistration.status': 'new_created',
      }));
    });

    it('already_exists: returns status already_exists without inserting when Active record is found', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-active-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('already_exists');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('resume_required: returns status resume_required without inserting when Pending record is found', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: { ...BASE_CLAIMS },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-pending-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('resume_required');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('repairs a legacy idempotent record that has no card sameAs or member role', async () => {
      const cardDid = 'did:web:unid.online:card:uhc:personal:recovered';
      const existingClaims = { ...BASE_CLAIMS };
      delete existingClaims[ClaimsOrganizationSchemaorg.sameAs];
      delete existingClaims['org.schema.Organization.member.role'];
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: existingClaims,
      });
      const existingDocument = {
        id: 'legacy-active-id',
        status: EntityLifecycleStatus.Active,
        sequence: 4,
        indexed: { attributes: [], hmac: { id: 'urn:test', type: 'Sha256HmacKey2019' } },
        jwe: { ciphertext: '' },
      } as any;
      mockVaultRepository.query.mockResolvedValue([existingDocument]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockKmsService.protectConfidentialData.mockImplementation(async (document: any) => document);

      const response = await manager.process(makeBatchJob({
        [ClaimsOrganizationSchemaorg.sameAs]: cardDid,
        'org.schema.Organization.member.role': 'ONESELF',
      }));
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.id).toBe(existingDocument.id);
      expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
        [ClaimsOrganizationSchemaorg.sameAs]: cardDid,
        'org.schema.Organization.member.role': 'ONESELF',
        'org.schema.FamilyRegistration.status': 'already_exists',
      }));
      expect(mockVaultRepository.put).toHaveBeenCalledWith(
        COLLECTION_NAME,
        [expect.objectContaining({
          id: existingDocument.id,
          sequence: 5,
          content: expect.objectContaining({
            claims: expect.objectContaining({
              [ClaimsOrganizationSchemaorg.sameAs]: cardDid,
              'org.schema.Organization.member.role': 'ONESELF',
            }),
          }),
          indexed: expect.objectContaining({
            attributes: expect.arrayContaining([
              { name: ClaimsOrganizationSchemaorg.sameAs, value: cardDid },
            ]),
          }),
        })],
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
    });

    it('does not replace the card sameAs already stored on an idempotent record', async () => {
      const existingDid = 'did:web:unid.online:card:uhc:personal:existing';
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOrganizationSchemaorg.sameAs]: existingDid,
          'org.schema.Organization.member.role': 'ONESELF',
        },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'existing-active-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeBatchJob({
        [ClaimsOrganizationSchemaorg.sameAs]: 'did:web:unid.online:card:uhc:personal:retry',
      }));
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.[ClaimsOrganizationSchemaorg.sameAs]).toBe(existingDid);
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('idempotency query uses owner.telephone + alternateName as composite key', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      await manager.process(makeBatchJob());

      expect(mockVaultRepository.query).toHaveBeenCalledWith(
        COLLECTION_NAME,
        expect.objectContaining({
          where: expect.arrayContaining([
            expect.objectContaining({ name: ClaimsOrganizationSchemaorg.ownerTelephone, value: `tel:${EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE}` }),
            expect.objectContaining({ name: ClaimsOrganizationSchemaorg.alternateName, value: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.alternateName]) }),
          ]),
        }),
      );
    });

    it('indexes each Organization.sameAs alias for exact authorized-subject lookup', async () => {
      const subjectDid = 'did:web:unid.online:card:uhc:personal:subject-example';
      const documentCid = 'zb2rhsubject-exampledocument';
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      await manager.process(makeBatchJob({
        [ClaimsOrganizationSchemaorg.sameAs]: `${subjectDid}, ${documentCid}`,
      }));

      const protectedDoc = mockKmsService.protectConfidentialData.mock.calls[0]?.[0] as ConfidentialStorageDoc;
      expect(protectedDoc.indexed?.attributes).toEqual(expect.arrayContaining([
        { name: ClaimsOrganizationSchemaorg.sameAs, value: subjectDid },
        { name: ClaimsOrganizationSchemaorg.sameAs, value: documentCid },
      ]));
    });

    it('merges KYC metadata into family registration claims before persistence', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);

      const job = makeBatchJob({
        [ClaimsOrganizationSchemaorg.alternateName]: 'request-only-alias',
        [ClaimsOrganizationSchemaorg.ownerAlternateName]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: '',
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: '',
        [ClaimsPersonSchemaorg.birthDate]: '',
      });
      const firstEntry = (job.content?.body?.data?.[0] || {}) as BundleEntry;
      firstEntry.meta = {
        claims: firstEntry.meta?.claims,
        kyc: {
          profile: TEST_KYC_PROFILE,
          controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
          individualAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          individualBirthDate: EXAMPLE_REGISTERED_SUBJECT_BIRTH_YEAR,
        },
      } as any;

      const response = await manager.process(job);
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;
      const protectedDoc = mockKmsService.protectConfidentialData.mock.calls[0]?.[0] as ConfidentialStorageDoc;
      const persistedClaims = (protectedDoc.content as any).claims as Record<string, unknown>;

      expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
        [ClaimsOrganizationSchemaorg.alternateName]: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
        [ClaimsOrganizationSchemaorg.ownerAlternateName]: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
        [ClaimsOrganizationSchemaorg.ownerEmail]: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
        [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
        [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: expect.stringMatching(UUID_V4_PATTERN),
        [ClaimsOrganizationSchemaorg.addressCountry]: EXAMPLE_KYC_CONTROLLER_COUNTRY,
        [ClaimsPersonSchemaorg.givenName]: EXAMPLE_KYC_CONTROLLER_GIVEN_NAME.toUpperCase(),
        [ClaimsPersonSchemaorg.familyName]: EXAMPLE_KYC_CONTROLLER_FAMILY_NAME.toUpperCase(),
        [ClaimsPersonSchemaorg.birthDate]: EXAMPLE_KYC_CONTROLLER_BIRTHDATE.slice(0, 4),
      }));
      expect(persistedClaims).toEqual(expect.objectContaining({
        [ClaimsOrganizationSchemaorg.ownerAlternateName]: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
        [ClaimsOrganizationSchemaorg.ownerEmail]: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
        [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_KYC_CONTROLLER_TELEPHONE,
        [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: entry.resource?.meta?.claims?.[
          ClaimsOrganizationSchemaorg.ownerIdentifierValue
        ],
        [ClaimsPersonSchemaorg.birthDate]: EXAMPLE_KYC_CONTROLLER_BIRTHDATE.slice(0, 4),
      }));
    });

    it('rejects a KYC fallback that has no provider verification timestamp', async () => {
      mockVaultRepository.query.mockResolvedValue([]);
      mockVaultRepository.put.mockResolvedValue(true);
      const job = makeBatchJob();
      const firstEntry = (job.content?.body?.data?.[0] || {}) as BundleEntry;
      firstEntry.meta = {
        claims: firstEntry.meta?.claims,
        kyc: {
          profile: { ...TEST_KYC_PROFILE, kyc_verified_at: null },
          controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
          individualAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
        },
      } as any;

      const response = await manager.process(job);
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('400');
      expect(entry.response?.outcome?.issue?.[0]?.diagnostics).toBe(
        'KYC fallback requires a valid profile.kyc_verified_at timestamp.',
      );
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('renders a filled onboarding PDF draft from template + formFields + KYC and returns it as DocumentReference claims', async () => {
      const templateBytesBase64 = await createIndividualOnboardingTemplateBase64();

      const response = await manager.process(makePdfDraftJob({
        templateBytesBase64,
        kyc: {
          profile: TEST_KYC_PROFILE,
          controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
          individualAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          individualBirthDate: EXAMPLE_REGISTERED_SUBJECT_BIRTH_YEAR,
        },
        formFields: {
          controllerIsSubject: true,
          controllerAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
          docDate: EXAMPLE_PDF_CONSENT_DATE,
          serviceProviderDomain: EXAMPLE_SERVICE_PROVIDER_DOMAIN,
        },
      }));
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;
      const claims = entry.resource?.meta?.claims as Record<string, unknown>;

      expect(entry.type).toBe('DocumentReference');
      expect(entry.response?.status).toBe('200');
      expect(claims[DocumentReferenceClaim.ContentType]).toBe(EXAMPLE_DOCUMENT_REFERENCE_CONTENT_TYPE_PDF);
      expect(typeof claims[DocumentReferenceClaim.ContentData]).toBe('string');
      expect(String(claims[DocumentReferenceClaim.ContentData]).length).toBeGreaterThan(100);
      expect(claims[ClaimsOrganizationSchemaorg.alternateName]).toBe(EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME);
      expect(claims[ClaimsOrganizationSchemaorg.ownerEmail]).toBe(EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED);
      expect(claims[ClaimConsent.date]).toBe(EXAMPLE_PDF_CONSENT_DATE);
      expect(claims[ClaimsOrderSchemaorg.orderedItemServiceType]).toBe(EXAMPLE_SERVICE_PROVIDER_DOMAIN);

      const renderedPdf = await PDFDocument.load(
        Buffer.from(String(claims[DocumentReferenceClaim.ContentData]), 'base64'),
        { ignoreEncryption: true, updateMetadata: false },
      );
      const renderedForm = renderedPdf.getForm();
      expect(renderedForm.getTextField('controllerAlternateName').getText()).toBe(EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME);
      expect(renderedForm.getTextField('controllerEmail').getText()).toBe(EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED);
      expect(renderedForm.getTextField('docDate').getText()).toBe(EXAMPLE_PDF_CONSENT_DATE);
      expect(renderedForm.getTextField('serviceProviderDomain').getText()).toBe(EXAMPLE_SERVICE_PROVIDER_DOMAIN);
      expect(renderedForm.getCheckBox('controllerIsSubject').isChecked()).toBe(true);
    });

    it('accepts final resource.meta.claims built step by step after KYC and returns a filled PDF draft', async () => {
      const templateBytesBase64 = await createIndividualOnboardingTemplateBase64();
      const claimsAfterKyc = mergeIndividualOrganizationClaims({
        kyc: {
          profile: TEST_KYC_PROFILE,
          controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
          individualAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          individualBirthDate: EXAMPLE_REGISTERED_SUBJECT_BIRTH_YEAR,
        },
      }).claims;
      const finalClaims = mergeIndividualOrganizationClaims({
        claims: claimsAfterKyc,
        formFields: {
          controllerIsSubject: false,
          controllerPhone: EXAMPLE_FORM_CONTROLLER_PHONE,
          subjectAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          subjectPhone: EXAMPLE_FORM_SUBJECT_PHONE,
          subjectIdValue: EXAMPLE_FORM_SUBJECT_IDENTIFIER_VALUE,
          subjectDateOfBirth: EXAMPLE_REGISTERED_SUBJECT_BIRTH_YEAR,
          docDate: EXAMPLE_PDF_CONSENT_DATE,
          serviceProviderDomain: EXAMPLE_SERVICE_PROVIDER_DOMAIN,
        },
      }).claims;

      const response = await manager.process(makePdfDraftJob({
        templateBytesBase64,
        claims: finalClaims,
        formFields: {
          controllerIsSubject: false,
          controllerAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          controllerEmail: EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED,
          controllerPhone: EXAMPLE_FORM_CONTROLLER_PHONE,
          subjectAlternateName: EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME,
          subjectPhone: EXAMPLE_FORM_SUBJECT_PHONE,
          subjectIdValue: EXAMPLE_FORM_SUBJECT_IDENTIFIER_VALUE,
          subjectDateOfBirth: EXAMPLE_REGISTERED_SUBJECT_BIRTH_YEAR,
          docDate: EXAMPLE_PDF_CONSENT_DATE,
          serviceProviderDomain: EXAMPLE_SERVICE_PROVIDER_DOMAIN,
        },
      }));
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;
      const claims = entry.resource?.meta?.claims as Record<string, unknown>;

      expect(entry.type).toBe('DocumentReference');
      expect(entry.response?.status).toBe('200');
      expect(claims[ClaimsOrganizationSchemaorg.ownerEmail]).toBe(EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED);
      expect(claims[ClaimsOrganizationSchemaorg.ownerTelephone]).toBe(EXAMPLE_FORM_CONTROLLER_PHONE);
      expect(claims[ClaimsOrganizationSchemaorg.alternateName]).toBe(EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME);
      expect(claims[ClaimsOrganizationSchemaorg.ownerAlternateName]).toBe(EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME);
      expect(claims[ClaimsOrganizationSchemaorg.memberIdentifierValue]).toBe(EXAMPLE_FORM_SUBJECT_IDENTIFIER_VALUE);
      expect(claims[ClaimsOrderSchemaorg.orderedItemServiceType]).toBe(EXAMPLE_SERVICE_PROVIDER_DOMAIN);

      const renderedPdf = await PDFDocument.load(
        Buffer.from(String(claims[DocumentReferenceClaim.ContentData]), 'base64'),
        { ignoreEncryption: true, updateMetadata: false },
      );
      const renderedForm = renderedPdf.getForm();
      expect(renderedForm.getTextField('controllerAlternateName').getText()).toBe(EXAMPLE_REGISTERED_SUBJECT_ALTERNATE_NAME);
      expect(renderedForm.getTextField('controllerEmail').getText()).toBe(EXAMPLE_SELF_REGISTERED_INDIVIDUAL_EMAIL_NORMALIZED);
      expect(renderedForm.getTextField('docDate').getText()).toBe(EXAMPLE_PDF_CONSENT_DATE);
      expect(renderedForm.getTextField('serviceProviderDomain').getText()).toBe(EXAMPLE_SERVICE_PROVIDER_DOMAIN);
      expect(renderedForm.getCheckBox('controllerIsSubject').isChecked()).toBe(false);
    });

    it('individual-form-pdf-cert-signed maps the real signed PDF into valid CORE family claims', async () => {
        const pdfBytes = await signedIndividualPdfFixture;

        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.put.mockResolvedValue(true);

        const pdfFields = await extractPdfFormFieldsFromFixture(pdfBytes);
        const signerSubjectDn = extractNaturalPersonSignerSubjectFromPdf(pdfBytes);
        const mapped = buildClaimsFromIndividualFormPdf(pdfFields, signerSubjectDn);

        const response = await manager.process(makeBatchJob({
          [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
          ...mapped,
        }));
        const body = response.body as BundleJsonApi;
        const entry = body.data[0] as BundleEntry;

        expect(entry.response?.status).toBe('201');
        expect(pdfFields.controllerEmail).toBe(SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail);
        expect(pdfFields.controllerAlternateName).toBe(SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName);
        expect(signerSubjectDn).toBe(SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSubjectDn);

        expect(mapped).toEqual(expect.objectContaining({
          '@context': 'org.schema',
          [ClaimsOrganizationSchemaorg.alternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerAlternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerEmail]: SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail,
          [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSerialNumber,
          [ClaimsPersonSchemaorg.identifierValue]: SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSerialNumber,
          [ClaimsOrganizationSchemaorg.addressCountry]: SIGNED_INDIVIDUAL_PDF_EXPECTED.signerCountry,
        }));
        expect(mapped[ClaimsPersonSchemaorg.givenName]).toBe(SIGNED_INDIVIDUAL_PDF_EXPECTED.signerGivenName);
        expect(mapped[ClaimsPersonSchemaorg.familyName]).toBe(SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSurname);
        expect(mapped[ClaimsPersonSchemaorg.name]).toBe(
          `${SIGNED_INDIVIDUAL_PDF_EXPECTED.signerGivenName} ${SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSurname}`,
        );

        expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
          'org.schema.FamilyRegistration.status': 'new_created',
          [ClaimsOrganizationSchemaorg.alternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerAlternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerEmail]: SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail,
          [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: expect.stringMatching(UUID_V4_PATTERN),
          [ClaimsPersonSchemaorg.identifierValue]: SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSerialNumber,
        }));
      });

    it('individual-form-pdf attachment flow accepts _transaction alias and completes claims from signed PDF', async () => {
        const pdfBytes = await signedIndividualPdfFixture;

        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.put.mockResolvedValue(true);

        const pdfBase64 = pdfBytes.toString('base64');
        const response = await manager.process(makeTransactionJob(
          {
            [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
            [ClaimsServiceSchemaorg.category]: SECTOR,
            [ClaimsServiceSchemaorg.identifier]: 'did:web:provider.example.com',
            [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
            [ClaimsServiceSchemaorg.termsOfService]: 'https://example.com/terms',
          },
          [{
            id: 'signed-individual-form',
            media_type: 'application/pdf',
            data: { base64: pdfBase64 },
          }],
        ));
        const body = response.body as BundleJsonApi;
        const entry = body.data[0] as BundleEntry;

        expect(body.type).toBe('transaction-response');
        expect(mockLogger.error).not.toHaveBeenCalled();
        expect(entry.response).toEqual(expect.objectContaining({ status: '201' }));
        expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
          'org.schema.FamilyRegistration.status': 'new_created',
          [ClaimsOrganizationSchemaorg.alternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerAlternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
          [ClaimsOrganizationSchemaorg.ownerEmail]: SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail,
          [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: expect.stringMatching(UUID_V4_PATTERN),
          [ClaimsPersonSchemaorg.identifierValue]: SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSerialNumber,
        }));
      });

    it('individual-form-pdf attachment flow also accepts HTTPS links[] and downloads the PDF before extracting claims', async () => {
        const pdfBytes = await signedIndividualPdfFixture;

        mockVaultRepository.query.mockResolvedValue([]);
        mockVaultRepository.put.mockResolvedValue(true);

        const fetchSpy = jest.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
          ok: true,
          status: 200,
          arrayBuffer: async () => pdfBytes,
        } as any);

        try {
          const response = await manager.process(makeTransactionJob(
            {
              [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
              [ClaimsServiceSchemaorg.category]: SECTOR,
              [ClaimsServiceSchemaorg.identifier]: 'did:web:provider.example.com',
              [ClaimsServiceSchemaorg.serviceType]: testDefaultTenantServiceTypeClaim,
              [ClaimsServiceSchemaorg.termsOfService]: 'https://example.com/terms',
            },
            [{
              id: 'signed-individual-form',
              media_type: 'application/pdf',
              data: { links: ['https://www.dropbox.com/scl/fi/example/signed-individual-form.pdf?dl=1'] },
            }],
          ));
          const body = response.body as BundleJsonApi;
          const entry = body.data[0] as BundleEntry;

          expect(fetchSpy).toHaveBeenCalledWith(
            'https://www.dropbox.com/scl/fi/example/signed-individual-form.pdf?dl=1',
            { redirect: 'follow' },
          );
          expect(entry.response?.status).toBe('201');
          expect(entry.resource?.meta?.claims).toEqual(expect.objectContaining({
            'org.schema.FamilyRegistration.status': 'new_created',
            [ClaimsOrganizationSchemaorg.alternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
            [ClaimsOrganizationSchemaorg.ownerAlternateName]: SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName,
            [ClaimsOrganizationSchemaorg.ownerEmail]: SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail,
            [ClaimsOrganizationSchemaorg.ownerIdentifierValue]: expect.stringMatching(UUID_V4_PATTERN),
            [ClaimsPersonSchemaorg.identifierValue]: SIGNED_INDIVIDUAL_PDF_EXPECTED.signerSerialNumber,
          }));
        } finally {
          fetchSpy.mockRestore();
        }
      });
  });

  describe('Order controller activation contact', () => {
    it('does not activate or issue a Card for an incomplete pending animal draft', async () => {
      const offerId = 'urn:example:offer:animal-draft';
      const pending = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOfferSchemaorg.identifier]: offerId,
          [ClaimsOrganizationSchemaorg.additionalType]: 'animal',
          [ClaimsOrganizationSchemaorg.alternateName]: '',
          [ClaimsOrganizationSchemaorg.memberAdditionalType]: '',
          [ClaimsOrganizationSchemaorg.memberRole]: 'ONESELF',
          [ClaimsOrganizationSchemaorg.sameAs]: '',
        },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'pending-animal-draft', status: 'pending', sequence: 0 } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(pending as any);

      const response = await manager.process(makeOrderJob(offerId));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('400');
      expect(entry.response?.outcome).toEqual(expect.objectContaining({ issue: expect.arrayContaining([
        expect.objectContaining({ diagnostics: expect.stringMatching(/alternateName, species, card/) }),
      ]) }));
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('issues a phone-only controller seat with issuedToPhone and no invented email', async () => {
      const offerId = 'urn:example:offer:phone-controller';
      const controllerPhone = '+16045550123';
      const subjectDid = 'did:web:beta.petchain.app:card:vetchain:0009615:124020009790246678991';
      const pending = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOfferSchemaorg.identifier]: offerId,
          [ClaimsOfferSchemaorg.eligibleQuantityValue]: 1,
          [ClaimsOrganizationSchemaorg.ownerEmail]: '',
          [ClaimsOrganizationSchemaorg.ownerTelephone]: controllerPhone,
          [ClaimsPersonSchemaorg.email]: '',
          [ClaimsPersonSchemaorg.telephone]: '',
          [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
        },
      });
      const availableSeat: ConfidentialStorageDoc = {
        id: 'phone-seat', status: 'available', sequence: 0,
        content: {
          id: 'phone-seat', tenantId: TENANT_ID, orderId: offerId, userClass: 'individual', type: 'mobile',
          status: 'available', exp: Math.floor(Date.now() / 1000) + 3600,
        } as any,
      };
      mockVaultRepository.query.mockResolvedValue([{ id: 'pending-family', status: 'pending', sequence: 0 } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(pending as any);
      mockVaultRepository.getContainersInSection.mockResolvedValue([availableSeat]);
      mockVaultRepository.put.mockResolvedValue(true);

      await manager.process(makeOrderJob(offerId));

      const persistedLicense = mockVaultRepository.put.mock.calls
        .flatMap((call) => call[1] as ConfidentialStorageDoc[])
        .map((doc) => doc.content as any)
        .find((content) => content?.id === 'phone-seat');
      expect(persistedLicense).toEqual(expect.objectContaining({
        issuedToPhone: controllerPhone,
        authorizedSubjectDid: subjectDid,
        authorizedSubjectAliases: [subjectDid],
      }));
      expect(persistedLicense).not.toHaveProperty('issuedToEmail');
    });
  });

  // -------------------------------------------------------------------------
  // _search — processFamilySearchEntry
  // -------------------------------------------------------------------------

  describe('_search / processFamilySearchEntry', () => {
    it('rejects an authenticated individual that requests another owner directory', async () => {
      const response = await manager.process(makeSearchJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: 'victim@example.org',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
      }, { sub: 'attacker-account', email: 'attacker@example.org', email_verified: true }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('403');
      expect(mockVaultRepository.query).not.toHaveBeenCalled();
    });

    it('allows the authenticated target-tenant RESPRSN controller to review an owner directory', async () => {
      const controllerDid = 'did:web:gateway.example:acme:cds-es:v1:health-care:employee:zController:RESPRSN';
      const job = makeSearchJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: 'reviewed-owner@example.org',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
      }, { sub: controllerDid });
      job.content!.iss = controllerDid;
      mockVaultRepository.query.mockResolvedValue([]);

      const response = await manager.process(job);
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('200');
      expect(mockVaultRepository.query).toHaveBeenCalledTimes(1);
    });

    it('returns active cards and a cardless animal draft owned by an exact indexed email', async () => {
      const ownerEmail = 'controller@example.org';
      mockVaultRepository.query.mockResolvedValue([
        { id: 'own-org', jwe: { ciphertext: '' } } as any,
        { id: 'represented-org', jwe: { ciphertext: '' } } as any,
        { id: 'animal-draft-org', jwe: { ciphertext: '' } } as any,
      ]);
      mockKmsService.unprotectConfidentialData
        .mockResolvedValueOnce(buildExampleFamilyRegistrationContent({
          status: EntityLifecycleStatus.Active,
          claims: {
            [ClaimsOrganizationSchemaorg.ownerEmail]: ownerEmail,
            [ClaimsOrganizationSchemaorg.alternateName]: 'My card',
            [ClaimsOrganizationSchemaorg.sameAs]: 'did:web:unid.online:card:uhc:personal:own',
            'org.schema.Organization.member.role': 'ONESELF',
          },
        }) as any)
        .mockResolvedValueOnce(buildExampleFamilyRegistrationContent({
          status: EntityLifecycleStatus.Active,
          claims: {
            [ClaimsOrganizationSchemaorg.ownerEmail]: ownerEmail,
            [ClaimsOrganizationSchemaorg.alternateName]: 'Relative',
            [ClaimsOrganizationSchemaorg.sameAs]: 'did:web:unid.online:card:uhc:personal:relative',
            'org.schema.Organization.member.role': 'RESPRSN',
          },
        }) as any)
        .mockResolvedValueOnce(buildExampleFamilyRegistrationContent({
          status: EntityLifecycleStatus.Pending,
          claims: {
            [ClaimsOrganizationSchemaorg.ownerEmail]: ownerEmail,
            [ClaimsOrganizationSchemaorg.additionalType]: AnimalIndividualRegistration.SubjectKind,
            [ClaimsOrganizationSchemaorg.alternateName]: '',
            [ClaimsOrganizationSchemaorg.memberAdditionalType]: '',
            [ClaimsOrganizationSchemaorg.sameAs]: '',
            [ClaimsOrganizationSchemaorg.memberRole]: AnimalIndividualRegistration.SelfRole,
          },
        }) as any);

      const response = await manager.process(makeSearchJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: ownerEmail,
        [ClaimsOrganizationSchemaorg.alternateName]: '',
      }));
      const result = ((response.body as BundleJsonApi).data[0] as BundleEntry).resource as any;

      expect(mockVaultRepository.query).toHaveBeenCalledWith(COLLECTION_NAME, {
        sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        where: [{ name: ClaimsOrganizationSchemaorg.ownerEmail, value: ownerEmail }],
      });
      expect(result).toMatchObject({ resourceType: 'Bundle', type: 'searchset' });
      expect(result.entry.map((item: any) => item.resource.id)).toEqual(['own-org', 'represented-org', 'animal-draft-org']);
      expect(result.entry[0].resource.meta.claims).toMatchObject({
        [ClaimsOrganizationSchemaorg.sameAs]: 'did:web:unid.online:card:uhc:personal:own',
      });
      expect(result.entry[2].resource.meta.claims).toMatchObject({
        [ClaimsOrganizationSchemaorg.additionalType]: AnimalIndividualRegistration.SubjectKind,
        [GatewayClaim.FamilyRegistrationStatus]: FamilyRegistrationStatus.DraftSaved,
        [GatewayClaim.FamilyRegistrationMissingFields]: ['alternateName', 'species', 'card'],
      });
    });

    it('resolves an accepted member subject by exact indexed Organization.sameAs only', async () => {
      const subjectDid = 'did:web:unid.online:card:uhc:personal:subject-example';
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
          [ClaimsOrganizationSchemaorg.alternateName]: 'Subject example',
        },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'subject-example-org', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: '',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
        [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(mockVaultRepository.query).toHaveBeenCalledWith(COLLECTION_NAME, {
        sectionId: getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        where: [{ name: ClaimsOrganizationSchemaorg.sameAs, value: subjectDid }],
      });
      expect(entry.resource).toMatchObject({ resourceType: 'Organization', id: 'subject-example-org' });
      expect(entry.resource?.meta?.claims).toMatchObject({
        [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
        [ClaimsOrganizationSchemaorg.alternateName]: 'Subject example',
      });
    });

    it('resolves an exact pre-SMART subject only when an active licence binds it to the protected profile contact', async () => {
      const subjectDid = 'did:web:unid.online:card:uhc:personal:licensed';
      const ownerEmail = 'controller@example.org';
      const job = makeSearchJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: '',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
        [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
      }, { sub: 'verified-owner-account', email: ownerEmail, email_verified: true });
      (job.content as any).meta[REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META] = {
        clientId: 'personal-client-1',
        actorDid: String(job.content?.iss),
        authenticatedSubject: 'verified-owner-account',
        authenticatedEmail: ownerEmail,
      };
      mockVaultRepository.getContainersInSection.mockResolvedValue([{
        id: 'member-seat',
        status: 'active',
        sequence: 1,
        content: {
          id: 'member-seat',
          status: 'active',
          userClass: 'individual',
          issuedToEmail: ownerEmail,
          authorizedSubjectDid: subjectDid,
        },
      }] as any);
      mockVaultRepository.query.mockResolvedValue([{ id: 'licensed-org', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
          [ClaimsOrganizationSchemaorg.alternateName]: 'Licensed subject',
        },
      }) as any);

      const response = await manager.process(job);
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('200');
      expect(entry.resource).toMatchObject({ id: 'licensed-org' });
    });

    it('rejects an exact pre-SMART subject lookup without a contact-bound active licence', async () => {
      const subjectDid = 'did:web:unid.online:card:uhc:personal:not-licensed';
      const ownerEmail = 'controller@example.org';
      const job = makeSearchJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: '',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
        [ClaimsOrganizationSchemaorg.sameAs]: subjectDid,
      }, { sub: 'verified-owner-account', email: ownerEmail, email_verified: true });
      (job.content as any).meta[REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META] = {
        clientId: 'personal-client-1',
        actorDid: String(job.content?.iss),
        authenticatedSubject: 'verified-owner-account',
        authenticatedEmail: ownerEmail,
      };
      mockVaultRepository.getContainersInSection.mockResolvedValue([]);

      const response = await manager.process(job);
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('403');
      expect(entry.response?.outcome?.issue?.[0]?.diagnostics).toContain('active subject licence');
      expect(mockVaultRepository.query).not.toHaveBeenCalled();
    });

    it('not_found: returns not_found when no doc matches owner + alternateName', async () => {
      mockVaultRepository.query.mockResolvedValue([]);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('not_found');
    });

    it('already_exists: returns already_exists from _search when Active record is found', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: {
          [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE,
          [ClaimsOrganizationSchemaorg.alternateName]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.alternateName]),
        },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'active-search-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('already_exists');
    });

    it('resume_required: returns resume_required from _search when Pending record is found', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: {
          [ClaimsOrganizationSchemaorg.ownerTelephone]: EXAMPLE_FAMILY_REGISTRATION_OWNER_TELEPHONE,
          [ClaimsOrganizationSchemaorg.alternateName]: String(BASE_CLAIMS[ClaimsOrganizationSchemaorg.alternateName]),
        },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'pending-search-id', jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makeSearchJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('resume_required');
    });
  });

  describe('_purge / processFamilyPurgeEntry', () => {
    it('purges an owned pending human draft directly by its private identifier', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOrganizationSchemaorg.identifierValue]: HUMAN_DRAFT_IDENTIFIER,
          [ClaimsOrganizationSchemaorg.alternateName]: '',
          [ClaimsOrganizationSchemaorg.memberRole]: INDIVIDUAL_SELF_ROLE,
          [ClaimsOrganizationSchemaorg.sameAs]: '',
          [ClaimsPersonSchemaorg.birthDate]: HUMAN_DRAFT_BIRTH_YEAR,
        },
      });
      mockVaultRepository.get.mockResolvedValue({
        id: HUMAN_DRAFT_IDENTIFIER,
        status: EntityLifecycleStatus.Pending,
        sequence: 0,
      } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.getAllSections.mockResolvedValue([getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL)]);
      mockVaultRepository.delete.mockResolvedValue(true);

      const response = await manager.process(makePurgeJob({
        [ClaimsOrganizationSchemaorg.identifierValue]: HUMAN_DRAFT_IDENTIFIER,
        [ClaimsOrganizationSchemaorg.alternateName]: '',
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('200');
      expect(entry.resource?.meta?.claims?.[GatewayClaim.FamilyRegistrationStatus]).toBe(FamilyRegistrationStatus.DraftDeleted);
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        COLLECTION_NAME,
        HUMAN_DRAFT_IDENTIFIER,
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
    });

    it('purges an owned pending animal draft directly by its private identifier', async () => {
      const draftId = '00000000-0000-4000-8000-000000000099';
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Pending,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOrganizationSchemaorg.identifierValue]: draftId,
          [ClaimsOrganizationSchemaorg.additionalType]: 'animal',
          [ClaimsOrganizationSchemaorg.alternateName]: '',
          [ClaimsOrganizationSchemaorg.memberRole]: 'ONESELF',
          [ClaimsOrganizationSchemaorg.sameAs]: '',
        },
      });
      mockVaultRepository.get.mockResolvedValue({ id: draftId, status: 'pending', sequence: 0 } as any);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.getAllSections.mockResolvedValue([getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL)]);
      mockVaultRepository.delete.mockResolvedValue(true);

      const response = await manager.process(makePurgeJob({
        [ClaimsOrganizationSchemaorg.identifierValue]: draftId,
        [ClaimsOrganizationSchemaorg.additionalType]: 'animal',
        [ClaimsOrganizationSchemaorg.alternateName]: '',
      }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('200');
      expect(entry.resource?.meta?.claims?.[GatewayClaim.FamilyRegistrationStatus]).toBe(FamilyRegistrationStatus.DraftDeleted);
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        COLLECTION_NAME,
        draftId,
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
    });

    it.each([
      ['_disable', makeDisableJob],
      ['_purge', makePurgeJob],
    ])('rejects an authenticated individual that attempts %s for another owner', async (_action, makeJob) => {
      const response = await manager.process(makeJob({
        [ClaimsOrganizationSchemaorg.ownerTelephone]: '',
        [ClaimsOrganizationSchemaorg.ownerEmail]: 'victim@example.org',
      }, { sub: 'attacker-account', email: 'attacker@example.org', email_verified: true }));
      const entry = (response.body as BundleJsonApi).data[0] as BundleEntry;

      expect(entry.response?.status).toBe('403');
      expect(mockVaultRepository.query).not.toHaveBeenCalled();
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
      expect(mockVaultRepository.delete).not.toHaveBeenCalled();
    });

    it('disabled: marks the family registration inactive without touching licenses', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-1', status: 'active', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.put.mockResolvedValue(true);

      const response = await manager.process(makeDisableJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('disabled');
      expect(entry.response?.status).toBe('200');
      const updatedDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedDocs[0].status).toBe(EntityLifecycleStatus.Inactive);
    });

    it('purged: deletes the family record, subject sections, and associated blobs only after disable', async () => {
      const subjectSectionId = getSubjectScopedSectionId(
        EXAMPLE_SUBJECT_DID,
        SUBJECT_SECTION_INDIVIDUAL,
        'document-references',
      );
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Inactive,
        claims: {
          ...BASE_CLAIMS,
          'org.schema.IndividualProduct.serialNumber': 'lic-123',
          [ClaimsOrganizationSchemaorg.identifier]: EXAMPLE_SUBJECT_DID,
          'DocumentReference.attachment#hash': 'zExampleIndividualPdfHash',
        },
      });
      const licenseDoc: ConfidentialStorageDoc = {
        id: 'license-1',
        status: 'issued',
        sequence: 2,
        content: {
          id: 'license-1',
          userClass: 'individual',
          status: 'issued',
          activationCode: 'lic-123',
          issuedToEmail: String(BASE_CLAIMS[ClaimsPersonSchemaorg.email]),
        } as any,
      };

      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-1', status: 'inactive', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.getContainersInSection
        .mockResolvedValueOnce([licenseDoc])
        .mockResolvedValueOnce([{ id: 'subject-doc-1', 'DocumentReference.attachment#hash': 'zExampleSubjectBlobHash' }] as any);
      mockVaultRepository.getAllSections.mockResolvedValue([
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        subjectSectionId,
      ]);
      mockVaultRepository.put.mockResolvedValue(true);
      mockVaultRepository.delete.mockResolvedValue(true);
      (mockStorageAdapter.delete as any) = jest.fn(async () => {});

      const response = await manager.process(makePurgeJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.resource?.meta?.claims?.['org.schema.FamilyRegistration.status']).toBe('purged');
      expect(entry.response?.status).toBe('200');
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const updatedLicenseDocs = mockVaultRepository.put.mock.calls[0][1] as ConfidentialStorageDoc[];
      expect(updatedLicenseDocs[0].status).toBe('available');
      expect((updatedLicenseDocs[0].content as any).activationCode).toBeUndefined();
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        COLLECTION_NAME,
        'subject-doc-1',
        subjectSectionId,
      );
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        COLLECTION_NAME,
        'family-doc-1',
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
      expect((mockStorageAdapter.delete as any)).toHaveBeenCalledWith('zExampleSubjectBlobHash');
    });

    it('purged: uses lifecycle request identifiers to clean subject-scoped sections that are not stored in the family record', async () => {
      const requestSubjectDid = EXAMPLE_SUBJECT_DID;
      const subjectSectionId = getSubjectScopedSectionId(
        requestSubjectDid,
        SUBJECT_SECTION_INDIVIDUAL,
        'communications',
      );
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Inactive,
        claims: {
          ...BASE_CLAIMS,
          [ClaimsOrganizationSchemaorg.identifier]: 'did:web:stored-family-subject.example',
        },
      });

      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-2', status: 'inactive', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);
      mockVaultRepository.getContainersInSection
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'subject-doc-2' }] as any);
      mockVaultRepository.getAllSections.mockResolvedValue([
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
        subjectSectionId,
      ]);
      mockVaultRepository.put.mockResolvedValue(true);
      mockVaultRepository.delete.mockResolvedValue(true);

      const response = await manager.process(makePurgeJob({
        [ClaimsOrganizationSchemaorg.identifier]: requestSubjectDid,
      }));
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.response?.status).toBe('200');
      expect(mockVaultRepository.delete).toHaveBeenCalledWith(
        COLLECTION_NAME,
        'subject-doc-2',
        subjectSectionId,
      );
    });

    it('returns 409 when family registration is still active during purge', async () => {
      const existingContent = buildExampleFamilyRegistrationContent({
        status: EntityLifecycleStatus.Active,
        claims: { ...BASE_CLAIMS },
      });
      mockVaultRepository.query.mockResolvedValue([{ id: 'family-doc-1', status: 'active', sequence: 1, jwe: { ciphertext: '' } } as any]);
      mockKmsService.unprotectConfidentialData.mockResolvedValueOnce(existingContent as any);

      const response = await manager.process(makePurgeJob());
      const body = response.body as BundleJsonApi;
      const entry = body.data[0] as BundleEntry;

      expect(entry.response?.status).toBe('409');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });
  });
});
