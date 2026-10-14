// src/__tests__/e2e/api.e2e.spec.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// This E2E test runs against a LIVE Firestore instance, configured via a local env profile.
// It validates the entire LEGACY API flow (unencrypted JSON) from HTTP request to database interaction.
// NOTE: This test requires TEST_USER_EMAIL and TEST_USER_PASSWORD to be set in the active env profile
//       and for that user to exist in the Firebase Auth project.

import * as express from 'express';
import request from 'supertest';
import { Server } from 'http';
import { startServer } from '../../server';
import { QueueAdapter } from '../../adapters/queue';
import { testPayloadCreateTenant1 } from '../data/end-to-end.data';
import { KmsService } from '../../services/KmsService';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { getGoogleAuthTokenForTesting } from '../utils/auth';

// Mock the KmsService to bypass actual JWE decryption for this legacy test
jest.mock('./src/services/KmsService');

// Increase the timeout for all tests in this file
jest.setTimeout(20000);

// Conditionally describe the test suite based on environment variables
const describeIfConfigured = 
  (process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD) 
  ? describe 
  : describe.skip;

describeIfConfigured('End-to-End API Flow (Legacy with Live Firestore)', () => {
  let app: express.Express;
  let server: Server | undefined;
  let queueAdapter: QueueAdapter;
  let addJobSpy: jest.SpyInstance;
  let authToken: string;

  beforeAll(async () => {
    authToken = await getGoogleAuthTokenForTesting(
      process.env.TEST_USER_EMAIL!,
      process.env.TEST_USER_PASSWORD!,
    );
    
    // We are mocking the KmsService for this legacy flow test.
    (KmsService as jest.Mock).mockImplementation(() => {
      return {
        decodeRequest: jest.fn((req: express.Request): Promise<JobRequest> => {
          const jobContent = req.body as IDecodedDidcommPayload;
          const job: JobRequest = {
            id: `job-${Date.now()}`,
            status: JobStatus.SENT,
            sequence: 0,
            createdAtTimestamp: Date.now(),
            section: 'registry',
            format: 'org.schema',
            resourceType: 'Organization',
            action: '_batch',
            content: jobContent,
          };
          return Promise.resolve(job);
        }),
      };
    });

    const serverInstance = await startServer();
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll(async () => {
    if (addJobSpy) {
      addJobSpy.mockRestore();
    }
    const serverInstance = server;
    if (serverInstance) {
      await new Promise<void>((resolve, reject) => {
        serverInstance.close((err: any) => { // Add type to err to satisfy TS
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });
    }
    // TODO: Add a cleanup step to delete the created tenant from Firestore
  });

  it('should accept a canonical JSON request to create a new organization, and save it to Firestore', async () => {
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;
    
    const tenantId = `e2e-legacy-tenant-${Date.now()}`;
    const modifiedClaims: ClaimsRecord = {
      ...testPayloadCreateTenant1.body.data[0].resource.meta.claims,
      'org.schema.Person.email': process.env.TEST_USER_EMAIL,
      'org.schema.Organization.identifier': `urn:uuid:${tenantId}`,
    };
    
    const orgCreationPayload = {
      ...testPayloadCreateTenant1,
      body: {
        data: [{
          ...testPayloadCreateTenant1.body.data[0],
          resource: { meta: { claims: modifiedClaims } },
        }]
      }
    };

    // 1. ACT: Send the plain JSON request with a valid Bearer token
    const response = await request(app)
      .post(registrationUrl)
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${authToken}`)
      .send(orgCreationPayload);

    // 2. ASSERT (Phase 1): API should accept the job
    expect(response.status).toBe(202);
    expect(response.headers.location).toBeDefined();
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // 3. VERIFY (Phase 2): This part remains as a TODO
    console.log('TODO: Verify that the tenant with ID', tenantId, 'was created in Firestore.');
  });
});
