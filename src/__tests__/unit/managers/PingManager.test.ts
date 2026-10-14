// File: src/__tests__/unit/managers/PingManager.test.ts

import { PingManager } from '../../../managers/PingManager';
import { TenantsCacheManager } from '../../../managers/TenantsCacheManager';
import { BundleEntryResponse, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getBundleResponseTypeForAction } from '../../../utils/bundle';

describe('PingManager', () => {
  let pingManager: PingManager;
  let mockTenantsCacheManager: jest.Mocked<TenantsCacheManager>;

  beforeEach(() => {
    // Mock the TenantsCacheManager and its dependencies
    mockTenantsCacheManager = {
      getTenantDid: jest.fn(),
    } as any;

    pingManager = new PingManager(mockTenantsCacheManager);
  });

  it('should process a ping job and echo the original entry with a success response', async () => {
    // Arrange: Set up the mock to return a DID for the 'host' tenant
    mockTenantsCacheManager.getTenantDid.mockResolvedValue('did:web:host.example.com');

    // Arrange: Create a mock job request simulating the path:
    // /host/cds-xx/v1/test/ping/standard/resource/_batch
    const mockJob: JobRequest = {
      id: 'mock-job-id',
      status: 'DRAFT' as any,
      sequence: 0,
      createdAtTimestamp: Date.now(),
      // --- URL Path Parameters ---
      tenantId: 'host',
      jurisdiction: 'xx',
      sector: 'test',
      section: 'ping',
      format: 'standard',
      resourceType: 'resource',
      action: '_batch',

      // --- Decoded Payload ---
      content: {
        jti: 'mock-jti',
        thid: 'test-request-ping-123',
        aud: 'did:web:recipient.example.com',
        iss: 'did:web:requester.example.com',
        type: 'json',
        body: {
          data: [{
            type: 'ping-form-v1.0',
            meta: { claims: { ping: 'Hello World!' } },
          }],
        },
      },
    };

    // Act: Process the job
    const responsePayload = await pingManager.process(mockJob);

    // Assert: Check the structure and content of the response payload
    expect(responsePayload).toBeDefined();
    expect(responsePayload.thid).toBe('test-request-ping-123');
    expect(responsePayload.aud).toBe('did:web:requester.example.com');
    
    const responseBody = responsePayload.body as BundleJsonApi;
    expect(responseBody.type).toBe(getBundleResponseTypeForAction('_batch'));

    const requestEntry = mockJob.content!.body.data[0];
    const responseEntry = responseBody.data[0] as BundleEntryResponse;

    // The response entry should be the original request entry, with a response block appended
    expect(responseEntry.type).toBe(requestEntry.type);
    expect(responseEntry.meta).toEqual(requestEntry.meta);
    expect(responseEntry.response).toBeDefined();
    expect(responseEntry.response.status).toBe('200');
  });
});
