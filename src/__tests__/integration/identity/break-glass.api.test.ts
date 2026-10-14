import express from 'express';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { QueueAdapter } from '../../../adapters/queue';
import { AsyncResponseStoreMem } from '../../../adapters/async-response-store.mem';
import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { AdapterCryptoSdkNode } from '../../../gdc-backend-utils-node/adapters/node/crypto';
import { createApiRouter } from '../../../routes/api';
import { invokeExpress } from '../helpers/invokeExpress';
import { mockKmsService } from '../../mocks/kms.mock';

describe('break-glass SMART route contract (integration)', () => {
  it('preserves the exceptional-access request when enqueueing the SMART token job', async () => {
    const previousSecurityMode = process.env.SECURITY_MODE;
    const previousInsecureBearer = process.env.DEMO_ALLOW_INSECURE_BEARER;
    process.env.SECURITY_MODE = 'demo';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';

    const queueAdapter: jest.Mocked<QueueAdapter> = { addJob: jest.fn().mockResolvedValue(undefined) };
    const services = [{
      id: '#identity:openid',
      type: 'OpenIdService',
      serviceEndpoint: 'smart',
      actions: ['token'],
      selector: { section: 'identity', format: 'openid' },
    }];
    const tenants = {
      tenantExists: jest.fn().mockResolvedValue(true),
      findTenantVaultIdByIdentifierValue: jest.fn().mockResolvedValue(undefined),
      getDidServiceConfig: jest.fn().mockResolvedValue(services),
      getTenant: jest.fn().mockResolvedValue({ authorizationStatus: 'active', didConfig: { service: services } }),
      getCollectionName: jest.fn().mockResolvedValue('tenant-collection'),
      getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:gw.example' }),
    } as any;
    const app = express();
    app.use(express.json());
    app.use(createApiRouter(
      queueAdapter,
      tenants,
      mockKmsService,
      new AsyncResponseStoreMem(),
      new VaultMemRepository(),
      new CryptographyService(new AdapterCryptoSdkNode()),
      'http://localhost:3001',
    ));

    try {
      const breakGlass = {
        incidentId: 'incident-123',
        subjectKind: 'animal',
        reasonCode: 'animal-emergency',
        justification: 'Urgent veterinary access is required.',
      } as const;
      const response = await invokeExpress(app, {
        method: 'POST',
        url: '/clinic/cds-ES/v1/animal-care/identity/openid/smart/token',
        headers: { 'content-type': 'application/json' },
        body: {
          thid: 'break-glass-route-001',
          iss: 'did:web:clinic.example:employee:vet:ISCO-08|2250',
          aud: 'did:web:gw.example',
          body: {
            sub: 'did:web:clinic.example:employee:vet:ISCO-08|2250',
            scope: 'organization/Composition.rs?subject=did:web:vetchain.example:card:vetchain:72409:0961510852611267',
            purpose: 'EMERGENCY',
            break_glass: breakGlass,
          },
        },
      });

      expect(response.status).toBe(202);
      expect(queueAdapter.addJob).toHaveBeenCalledTimes(1);
      const queued = queueAdapter.addJob.mock.calls[0][1] as JobRequest;
      expect(queued.content?.body?.break_glass).toEqual(breakGlass);
      expect(queued.sector).toBe('animal-care');
    } finally {
      if (previousSecurityMode === undefined) delete process.env.SECURITY_MODE;
      else process.env.SECURITY_MODE = previousSecurityMode;
      if (previousInsecureBearer === undefined) delete process.env.DEMO_ALLOW_INSECURE_BEARER;
      else process.env.DEMO_ALLOW_INSECURE_BEARER = previousInsecureBearer;
    }
  });
});
