// Flow contract: licence inventory is created by Offer -> Order; License/_add
// is unsupported in every network mode and never persists a seat.
// src/__tests__/managers/LicenseManager.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { randomUUID } from 'crypto';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { LicenseManager } from '../../managers/LicenseManager';
import { DeviceLicense, DeviceRestrictions } from 'gdc-common-utils-ts/models/device-license';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { getEnvSectionId } from '../../utils/section-env';
import { EXAMPLE_SECTOR } from 'gdc-common-utils-ts/examples/shared';

// --- Mocks ---

const mockVaultRepository: jest.Mocked<IVaultRepository> = {
  createNewVault: jest.fn(),
  vaultExists: jest.fn(),
  getVaultConfig: jest.fn(),
  createNewSection: jest.fn(),
  updateSection: jest.fn(),
  getAllSections: jest.fn(),
  sectionExists: jest.fn(),
  getContainersListInSection: jest.fn(),
  getContainersInSection: jest.fn(),
  listContainersInSection: jest.fn(),
  put: jest.fn(),
  get: jest.fn(),
  getHistory: jest.fn(),
  query: jest.fn(),
  delete: jest.fn(),
  purge: jest.fn(),
};

// --- Helper ---

interface MockLicenseJobOptions {
  targetTenantId: string;
  quantity: number;
  orderId: string;
  userClass: 'employee' | 'individual';
  type: 'mobile' | 'web';
  userCategory?: string;
  deviceRestrictions?: DeviceRestrictions;
}

/**
 * Helper function to create a mock JobRequest for license generation.
 */
const createMockLicenseJob = (options: MockLicenseJobOptions): JobRequest => {
  const jobContent: IDecodedDidcommPayload = {
    jti: randomUUID(),
    aud: 'did:web:host.example.com',
    iss: 'did:web:stripe-webhook-handler',
    thid: `evt_${randomUUID()}`, // Simulating a Stripe event ID
    type: 'internal/license-generation',
    body: {
      targetTenantId: options.targetTenantId,
      quantity: options.quantity,
      orderId: options.orderId,
      userClass: options.userClass,
      type: options.type,
      plan: 'premium_annual',
      renewalCycle: '12m',
      reactivationEnabled: true,
      userCategory: options.userCategory,
      deviceRestrictions: options.deviceRestrictions,
    },
  };

  return {
    id: randomUUID(),
    status: JobStatus.DRAFT,
    sequence: 0,
    createdAtTimestamp: Date.now(),
    tenantId: 'host', // The job is initiated by the system/host
    sector: EXAMPLE_SECTOR,
    section: 'system',
    format: 'org.schema',
    resourceType: 'License',
    action: 'create',
    content: jobContent,
  };
};

// --- Tests ---

describe('LicenseManager', () => {
  let manager: LicenseManager;
  const FIXED_SYSTEM_TIME = new Date('2024-01-01T00:00:00Z').getTime();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_SYSTEM_TIME);
    manager = new LicenseManager(mockVaultRepository);
  });
  
  afterEach(() => {
    delete process.env.NETWORK_MODE;
    delete process.env.DEPLOYMENT_ENV;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(manager).toBeDefined();
  });

  describe('process', () => {
    const TEST_TENANT_ID = 'acme';
    const TEST_VAULT_ID = `${EXAMPLE_SECTOR}_acme`;

    it('should create licenses and put them in the target vault', async () => {
      // Arrange
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 5, orderId: 'inv_123', userClass: 'employee', type: 'mobile', userCategory: 'doctor' });

      // Act
      await manager.process(job);

      // Assert
      expect(mockVaultRepository.put).toHaveBeenCalledTimes(1);
      const [vaultId, documents, collection] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
      expect(vaultId).toBe(TEST_VAULT_ID);
      expect(collection).toBe(getEnvSectionId('device-licenses'));
      expect(documents).toHaveLength(5);
    });

    it('should correctly save the tenantId on the license', async () => {
      // Arrange
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 1, orderId: 'inv_123', userClass: 'individual', type: 'web' });
  
      // Act
      await manager.process(job);
  
      // Assert
      const [_, documents] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
      const license = (documents[0] as ConfidentialStorageDoc).content as DeviceLicense;
      expect(license.tenantId).toBe(TEST_TENANT_ID);
    });

    it('should create an employee license with a userCategory', async () => {
      // Arrange
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 1, orderId: 'inv_789', userClass: 'employee', type: 'mobile', userCategory: 'medicalStaff' });

      // Act
      await manager.process(job);

      // Assert
      const [, documents] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
      const license = (documents[0] as ConfidentialStorageDoc).content as DeviceLicense;

      expect(license.userClass).toBe('employee');
      expect(license.userCategory).toBe('medicalStaff');
    });

    it('should not assign a userCategory to a customer license', async () => {
      // Arrange
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 1, orderId: 'inv_789', userClass: 'individual', type: 'web', userCategory: 'medicalStaff' });

      // Act
      await manager.process(job);

      // Assert
      const [, documents] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
      const license = (documents[0] as ConfidentialStorageDoc).content as DeviceLicense;

      expect(license.userClass).toBe('individual');
      expect(license.userCategory).toBeUndefined();
    });

    it('should save device restrictions when provided', async () => {
      // Arrange
      const restrictions = { manufacturer: 'Apple', model: 'iPhone14,.*' };
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 1, orderId: 'inv_789', userClass: 'employee', type: 'mobile', userCategory: 'admin', deviceRestrictions: restrictions });

      // Act
      await manager.process(job);

      // Assert
      const [, documents] = (mockVaultRepository.put as jest.Mock).mock.calls[0];
      const license = (documents[0] as ConfidentialStorageDoc).content as DeviceLicense;
      expect(license.deviceRestrictions).toEqual(restrictions);
    });

    it('should throw an error if an employee license is missing a userCategory', async () => {
      // Arrange
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 1, orderId: 'inv_123', userClass: 'employee', type: 'mobile' }); // No userCategory provided
      
      // Act & Assert
      await expect(manager.process(job)).rejects.toThrow("A non-empty 'userCategory' is required for employee licenses.");
    });

    it('should throw an error if quantity is not a positive number', async () => {
      // Arrange
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 0, orderId: 'inv_123', userClass: 'employee', type: 'mobile', userCategory: 'test' });
      
      // Act & Assert
      await expect(manager.process(job)).rejects.toThrow('License quantity must be a positive number.');
    });

    it('rejects license persistence when the job has no authoritative sector', async () => {
      const job = createMockLicenseJob({ targetTenantId: TEST_TENANT_ID, quantity: 1, orderId: 'inv_123', userClass: 'individual', type: 'web' });
      delete job.sector;

      await expect(manager.process(job)).rejects.toThrow('sector is required to resolve the tenant vault.');
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it.each(['test', 'local-network', 'test-network'])(
      'rejects the professional _add shortcut in %s', async (networkMode) => {
      process.env.NETWORK_MODE = networkMode;
      process.env.DEPLOYMENT_ENV = networkMode === 'test-network' ? 'staging' : 'dev';
      mockVaultRepository.vaultExists.mockResolvedValue(true);
      mockVaultRepository.getContainersInSection.mockResolvedValue([]);
      const job = {
        id: 'job-add-professional-seats',
        tenantId: TEST_TENANT_ID,
        jurisdiction: 'ES',
        sector: 'health-care',
        section: 'identity',
        format: 'org.schema',
        resourceType: 'License',
        action: '_add',
        content: {
          thid: 'thread-add-professional-seats',
          body: {
            data: [{
              type: 'ProfessionalLicensePurchase-v1.0',
              meta: { claims: {
                '@context': 'org.schema',
                'org.schema.Offer.eligibleQuantity.value': 2,
                'org.schema.Offer.price': 0,
                'org.schema.Offer.priceCurrency': 'EUR',
                'org.schema.IndividualProduct.category': 'professional',
                'org.schema.IndividualProduct.additionalType': 'web',
              } },
            }],
          },
        },
      } as JobRequest;

      await expect(manager.process(job)).rejects.toThrow(
        "Unsupported License action '_add'. Licence inventory is created through Offer -> Order.",
      );
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('rejects zero-cost employee seats outside test-network', async () => {
      process.env.NETWORK_MODE = 'network';
      mockVaultRepository.vaultExists.mockResolvedValue(true);
      const job = {
        id: 'job-reject-free-professional-seats',
        tenantId: TEST_TENANT_ID,
        jurisdiction: 'ES',
        sector: 'health-care',
        section: 'identity',
        format: 'org.schema',
        resourceType: 'License',
        action: '_add',
        content: {
          thid: 'thread-reject-free-professional-seats',
          body: { data: [{ meta: { claims: {
            '@context': 'org.schema',
            'org.schema.Offer.eligibleQuantity.value': 1,
            'org.schema.Offer.price': 0,
            'org.schema.IndividualProduct.category': 'professional',
          } } }] },
        },
      } as JobRequest;

      await expect(manager.process(job)).rejects.toThrow(
        "Unsupported License action '_add'. Licence inventory is created through Offer -> Order.",
      );
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });

    it('rejects zero-cost employee seats in production even if test-network is selected', async () => {
      process.env.NETWORK_MODE = 'test-network';
      process.env.DEPLOYMENT_ENV = 'prod';
      mockVaultRepository.vaultExists.mockResolvedValue(true);
      const job = {
        id: 'job-reject-production-free-professional-seats', tenantId: TEST_TENANT_ID,
        jurisdiction: 'ES', sector: 'health-care', section: 'identity', format: 'org.schema',
        resourceType: 'License', action: '_add', content: { thid: 'thread-reject-production', body: {
          data: [{ meta: { claims: {
            '@context': 'org.schema',
            'org.schema.Offer.eligibleQuantity.value': 1,
            'org.schema.Offer.price': 0,
            'org.schema.IndividualProduct.category': 'professional',
          } } }],
        } },
      } as JobRequest;

      await expect(manager.process(job)).rejects.toThrow(
        "Unsupported License action '_add'. Licence inventory is created through Offer -> Order.",
      );
      expect(mockVaultRepository.put).not.toHaveBeenCalled();
    });
  });
});
