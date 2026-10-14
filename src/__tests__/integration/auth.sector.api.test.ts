import { describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import {
  EXAMPLE_DEMO_PORTAL_ID_TOKEN,
  EXAMPLE_ACCOUNT_OWNER_ID,
  EXAMPLE_EMPLOYEE_ACTIVATION_CODE,
  EXAMPLE_SECTOR,
  EXAMPLE_TENANT_IDENTIFIER,
} from 'gdc-common-utils-ts/examples/shared';
import { createAuthRouter } from '../../routes/auth';
import { invokeExpress } from './helpers/invokeExpress';

function buildApp(payload: Record<string, unknown>) {
  const verifyIdToken = jest.fn(async () => ({ payload }));
  const verifyAndConsumeActivationCode = jest.fn(async () => undefined);
  const createInitialAccessToken = jest.fn(async () => EXAMPLE_DEMO_PORTAL_ID_TOKEN);
  const app = express();
  app.use(express.json());
  app.use('/auth', createAuthRouter(
    { verifyIdToken, verifyAndConsumeActivationCode } as any,
    { createInitialAccessToken } as any,
  ));
  return { app, verifyAndConsumeActivationCode };
}

/**
 * Legacy token exchange must resolve the same explicit sector used by the
 * activation-code vault. It must never substitute a product-local sector.
 */
describe('auth token exchange sector contract', () => {
  it('fails closed when the verified id token has no sector', async () => {
    const { app, verifyAndConsumeActivationCode } = buildApp({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      tenant_id: EXAMPLE_TENANT_IDENTIFIER,
    });

    const response = await invokeExpress(app, {
      method: 'POST',
      url: '/auth/token',
      headers: { authorization: `Bearer ${EXAMPLE_DEMO_PORTAL_ID_TOKEN}`, 'content-type': 'application/json' },
      body: { subject_token: EXAMPLE_EMPLOYEE_ACTIVATION_CODE },
    });

    expect(response.status).not.toBe(200);
    expect(verifyAndConsumeActivationCode).not.toHaveBeenCalled();
  });

  it('consumes the activation code in the verified token sector', async () => {
    const { app, verifyAndConsumeActivationCode } = buildApp({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      tenant_id: EXAMPLE_TENANT_IDENTIFIER,
      sector: EXAMPLE_SECTOR,
    });

    const response = await invokeExpress(app, {
      method: 'POST',
      url: '/auth/token',
      headers: { authorization: `Bearer ${EXAMPLE_DEMO_PORTAL_ID_TOKEN}`, 'content-type': 'application/json' },
      body: { subject_token: EXAMPLE_EMPLOYEE_ACTIVATION_CODE },
    });

    expect(response.status).toBe(200);
    expect(verifyAndConsumeActivationCode as any).toHaveBeenCalledWith(
      EXAMPLE_EMPLOYEE_ACTIVATION_CODE,
      EXAMPLE_TENANT_IDENTIFIER,
      EXAMPLE_SECTOR,
    );
  });
});
