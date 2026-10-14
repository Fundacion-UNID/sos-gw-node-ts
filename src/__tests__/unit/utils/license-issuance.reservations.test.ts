import { describe, expect, it, jest } from '@jest/globals';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import {
  issueActivationCodeFromPool,
  reserveTechnicalControllerSeat,
} from '../../../utils/license-issuance';

/**
 * Flow contract: the two initial professional seats are reservations, not the
 * first two free employee licences.
 *
 * Step 1 reserves the verified representative seat.
 * Step 2 reserves a contact-free technical-controller seat.
 * Step 3 later `_issue` binds that exact second seat to the controller and
 * does not consume a third seat.
 */
describe('initial professional seat reservations', () => {
  it('keeps both initial seats unavailable and reuses the second for controller binding', async () => {
    const documents = new Map<string, ConfidentialStorageDoc>([
      ['representative-seat', {
        id: 'representative-seat',
        status: 'issued',
        sequence: 1,
        content: {
          id: 'representative-seat', tenantId: 'tenant-1', orderId: 'initial-order',
          userClass: 'employee', userCategory: 'default', type: 'mobile', status: 'issued',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
          issuedToEmail: 'representative@example.test', issuedToRole: 'ISCO-08|1120',
        },
      } as ConfidentialStorageDoc],
      ['controller-seat', {
        id: 'controller-seat',
        status: 'available',
        sequence: 0,
        content: {
          id: 'controller-seat', tenantId: 'tenant-1', orderId: 'initial-order',
          userClass: 'employee', userCategory: 'default', type: 'mobile', status: 'available',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
        },
      } as ConfidentialStorageDoc],
    ]);
    const repository = {
      getContainersInSection: jest.fn(async () => Array.from(documents.values())),
      put: jest.fn(async (_vault: string, updates: ConfidentialStorageDoc[]) => {
        updates.forEach((document) => documents.set(document.id, structuredClone(document)));
        return true;
      }),
    } as any;

    // Step 1-2. The second seat becomes an issued, contact-free reservation.
    await reserveTechnicalControllerSeat({
      vaultRepository: repository,
      tenantVaultId: 'sector_tenant-1',
      representativeLicenseId: 'representative-seat',
    });
    expect(Array.from(documents.values()).filter((document) => document.status === 'available')).toHaveLength(0);
    expect(documents.get('controller-seat')?.content).toMatchObject({
      status: 'issued',
      issuedToRole: 'RESPRSN',
    });
    expect((documents.get('controller-seat')?.content as any).issuedToEmail).toBeUndefined();

    // Step 3. The service-controller binding consumes that reservation rather
    // than adding or borrowing an employee licence.
    const result = await issueActivationCodeFromPool({
      vaultRepository: repository,
      tenantVaultId: 'sector_tenant-1',
      userClass: 'employee',
      type: 'mobile',
      email: 'controller@example.test',
      role: 'RESPRSN',
    });
    expect(result.licenseId).toBe('controller-seat');
    expect(documents.size).toBe(2);
    expect(documents.get('controller-seat')?.content).toMatchObject({
      status: 'issued',
      issuedToEmail: 'controller@example.test',
      issuedToRole: 'RESPRSN',
    });
  });

  it('does not take or replace a historical professional second seat', async () => {
    const documents = [
      {
        id: 'representative-seat', status: 'active', sequence: 1,
        content: {
          id: 'representative-seat', tenantId: 'tenant-1', orderId: 'historical-order',
          userClass: 'employee', userCategory: 'default', type: 'mobile', status: 'active',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
          issuedToEmail: 'representative@example.test', issuedToRole: 'ISCO-08|1120',
        },
      },
      {
        id: 'professional-seat', status: 'active', sequence: 1,
        content: {
          id: 'professional-seat', tenantId: 'tenant-1', orderId: 'historical-order',
          userClass: 'employee', userCategory: 'default', type: 'mobile', status: 'active',
          plan: 'default', renewalCycle: '12m', reactivationEnabled: false,
          issuedToEmail: 'professional@example.test', issuedToRole: 'ISCO-08|2211',
        },
      },
    ] as ConfidentialStorageDoc[];
    const repository = {
      getContainersInSection: jest.fn(async () => documents),
      put: jest.fn(),
    } as any;

    await expect(reserveTechnicalControllerSeat({
      vaultRepository: repository,
      tenantVaultId: 'sector_tenant-1',
      representativeLicenseId: 'representative-seat',
    })).rejects.toThrow('No available initial seat remains');
    expect(repository.put).not.toHaveBeenCalled();
    expect(documents).toHaveLength(2);

    await expect(issueActivationCodeFromPool({
      vaultRepository: repository,
      tenantVaultId: 'sector_tenant-1',
      userClass: 'employee',
      type: 'mobile',
      email: 'technical-controller@example.test',
      role: 'RESPRSN',
    })).rejects.toThrow("No reusable or available license found for userClass='employee'");
    expect(repository.put).not.toHaveBeenCalled();
    expect(documents).toHaveLength(2);
  });
});
