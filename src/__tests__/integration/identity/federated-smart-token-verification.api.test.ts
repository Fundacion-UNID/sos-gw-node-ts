// Flow contract: an EHR registered with one custodian authenticates its verification request, receives only a signed RFC 9701 result, and never submits this OAuth exchange through the generic DIDComm job route.

import express from 'express';
import { createApiRouter } from '../../../routes/api';
import { invokeExpress } from '../helpers/invokeExpress';
import type { FederatedSmartVerificationManager } from '../../../managers/FederatedSmartVerificationManager';

describe('federated SMART token verification API', () => {
  it('passes the standard form fields to the custodian verifier and returns its signed JWT', async () => {
    const compactResponse = 'header.payload.signature';
    const verifier = {
      verify: jest.fn().mockResolvedValue({ active: true, compactResponse }),
    } as unknown as jest.Mocked<FederatedSmartVerificationManager>;
    const queueAdapter = { addJob: jest.fn() } as any;
    const tenantRegistry = {
      tenantExists: jest.fn(),
      findTenantVaultIdByIdentifierValue: jest.fn(),
    } as any;
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(createApiRouter(
      queueAdapter,
      tenantRegistry,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      'https://custodian.example',
      undefined,
      undefined,
      undefined,
      verifier,
    ));

    const url = '/hospital/cds-ES/v1/health-care/identity/openid/smart/token/_verify';
    const response = await invokeExpress(app, {
      method: 'POST',
      url,
      headers: {
        host: 'custodian.example',
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/token-introspection+jwt',
      },
      body: {
        token: 'foreign.index.token',
        token_type_hint: 'access_token',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: 'ehr.client.assertion',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/token-introspection+jwt');
    expect(response.text).toBe(compactResponse);
    expect(verifier.verify).toHaveBeenCalledWith({
      tenantId: 'hospital',
      jurisdiction: 'ES',
      sector: 'health-care',
      token: 'foreign.index.token',
      tokenTypeHint: 'access_token',
      clientAssertionType: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      clientAssertion: 'ehr.client.assertion',
      requestUrl: `http://custodian.example${url}`,
    });
    expect(queueAdapter.addJob).not.toHaveBeenCalled();
  });
});
