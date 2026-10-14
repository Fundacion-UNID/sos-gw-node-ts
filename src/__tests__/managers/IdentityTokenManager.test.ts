// Flow contract: a verified professional may exchange either an invitation code or one exact portable employee URN; the gateway still validates the active licence before DCR.
import { IdentityTokenManager } from '../../managers/IdentityTokenManager';
import { IdentityAuthRequestFields } from 'gdc-common-utils-ts/constants/identity-auth';

const VERIFIED_PROFESSIONAL_EMAIL = 'doctor.doe@example.org';
const PORTABLE_EMPLOYEE_URN = 'urn:cds-ca-bc:v1:organization:bn:Example-123:member:zJJPb9sJCAcnFLu8tVHGF4c:2211';

const buildJob = (tenantId: string) => ({
  tenantId,
  jurisdiction: 'ca-bc',
  sector: 'onehealth-research',
  action: '_exchange',
  content: {
    thid: 'exchange-1',
    jti: 'request-1',
    iss: 'did:web:portal.example',
    aud: 'did:web:gateway.example',
    body: {
      subject_token: 'activation-1',
      client_instance_id: 'browser-1',
    },
    meta: { bearer: { token: 'Bearer firebase-id-token' } },
  },
} as any);

/**
 * Device exchange requires a trusted OIDC id_token for account/contact
 * binding. A controller VP is a separate role proof and is never a fallback.
 */
describe('IdentityTokenManager personal activation tenant binding', () => {
  const createManager = (payload: Record<string, unknown>) => {
    const verifyIdToken = jest.fn(async () => ({ valid: true, payload }));
    const resolveEmployeeActivationCode = jest.fn(async () => 'resolved-activation-code');
    const verifyAndConsumeActivationCode = jest.fn(async () => ({ valid: true, license: {} }));
    const createInitialAccessToken = jest.fn(async () => 'initial-access-token');
    const manager = new IdentityTokenManager(
      { verifyIdToken, resolveEmployeeActivationCode, verifyAndConsumeActivationCode } as any,
      { createInitialAccessToken } as any,
    );
    return { manager, resolveEmployeeActivationCode, verifyAndConsumeActivationCode, createInitialAccessToken };
  };

  it('uses the authoritative routed tenant when a verified personal Firebase token has no tenant_id', async () => {
    const { manager, verifyAndConsumeActivationCode, createInitialAccessToken } = createManager({
      sub: 'firebase-user-1',
      phone_number: '+16045550123',
    });

    await expect(manager.process(buildJob('animal-tenant-1'))).resolves.toMatchObject({
      body: { initial_access_token: 'initial-access-token' },
    });
    expect(verifyAndConsumeActivationCode).toHaveBeenCalledWith(
      'activation-1',
      'animal-tenant-1',
      'onehealth-research',
      expect.objectContaining({ subject: 'firebase-user-1', phone: '+16045550123' }),
      'browser-1',
    );
    expect(createInitialAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'animal-tenant-1' }),
      60,
    );
  });

  it('resolves the existing employee licence from the portable URN before issuing the DCR initial access token', async () => {
    const { manager, resolveEmployeeActivationCode, verifyAndConsumeActivationCode } = createManager({
      sub: 'firebase-professional-1',
      email: VERIFIED_PROFESSIONAL_EMAIL,
      email_verified: true,
    });
    const job = buildJob('animal-tenant-1');
    delete job.content.body[IdentityAuthRequestFields.SubjectToken];
    job.content.body[IdentityAuthRequestFields.EmployeeAuthorizationUrn] = PORTABLE_EMPLOYEE_URN;

    await expect(manager.process(job)).resolves.toMatchObject({
      body: { initial_access_token: 'initial-access-token' },
    });
    expect(resolveEmployeeActivationCode).toHaveBeenCalledWith(
      PORTABLE_EMPLOYEE_URN,
      'animal-tenant-1',
      'ca-bc',
      'onehealth-research',
      expect.objectContaining({
        subject: 'firebase-professional-1',
        email: VERIFIED_PROFESSIONAL_EMAIL,
        emailVerified: true,
      }),
    );
    expect(verifyAndConsumeActivationCode).toHaveBeenCalledWith(
      'resolved-activation-code',
      'animal-tenant-1',
      'onehealth-research',
      expect.any(Object),
      'browser-1',
    );
  });

  it('rejects an explicit tenant_id that differs from the routed tenant', async () => {
    const { manager, verifyAndConsumeActivationCode } = createManager({
      sub: 'firebase-user-1',
      tenant_id: 'different-tenant',
      phone_number: '+16045550123',
    });

    await expect(manager.process(buildJob('animal-tenant-1')))
      .rejects.toThrow('tenant_id claim does not match the routed tenant.');
    expect(verifyAndConsumeActivationCode).not.toHaveBeenCalled();
  });

  it('does not fall back to controller VP verification for device token exchange', async () => {
    const verifyIdToken = jest.fn(async () => {
      throw new Error('OIDC id_token rejected');
    });
    const verifyBearerToken = jest.fn(async () => ({ payload: { sub: 'controller' } }));
    const manager = new IdentityTokenManager(
      { verifyIdToken, verifyBearerToken } as any,
      { createInitialAccessToken: jest.fn() } as any,
    );
    const job = buildJob('animal-tenant-1');
    job.content.meta.bearer.token = 'Bearer signed-controller-vp';

    await expect(manager.process(job)).rejects.toThrow('OIDC id_token rejected');
    expect(verifyIdToken).toHaveBeenCalledWith('signed-controller-vp');
    expect(verifyBearerToken).not.toHaveBeenCalled();
  });
});
