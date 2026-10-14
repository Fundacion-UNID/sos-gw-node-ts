// Flow contract: preserve SOSChain break-glass OpenID authorization and make the test green only with the complete real behavior.
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';
import { buildUnsignedProfessionalIdentityVpJwt } from 'gdc-common-utils-ts/utils/professional-smart';
import { mockKmsService as sharedKmsServiceMock } from '../../mocks/kms.mock';

describe('SOSChain break-glass SMART integration', () => {
  it('issues a short emergency token only after the extension authorizer records the exception', async () => {
    const actorDid = 'did:web:provider.example:employee:doctor@example.org:ISCO-08|2211';
    const subjectDid = 'did:web:soschain-gw.unid.online:individual:123';
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({ clientId: actorDid, actorDid, role: 'ISCO-08|2211' });
    const authorize = jest.fn().mockResolvedValue({
      authorizationId: 'authorization-123', issuedAt: '2026-08-26T12:00:00.000Z',
      expiresAt: '2026-08-26T12:10:00.000Z', lifetimeSeconds: 600,
      auditAssetId: 'soschain-break-glass:authorization-123', notificationId: 'notification-123',
    });
    const now = Math.floor(Date.parse('2026-08-26T12:00:00.000Z') / 1000);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    try {
      const manager = new OpenIdAuthManager(
        {
          getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-key', alg: 'ES384' }),
          signWithManagedKey: jest.fn().mockResolvedValue({ signatures: [{ signature: 'signature' }] }),
          createCompactJws: jest.fn(sharedKmsServiceMock.createCompactJws.getMockImplementation()),
        } as any,
        { tenantExists: jest.fn().mockResolvedValue(true), getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:soschain-gw.unid.online' }) } as any,
        { getContainersInSection: jest.fn().mockResolvedValue([]) } as any,
        { verifyVpToken: jest.fn().mockResolvedValue({ acr: 'urn:antifraud:acr:openid4vp:employee', amr: ['openid4vp', 'vc'], vpHash: 'hash', ledgerVerified: true }) } as any,
        { authorize },
      );

      const response = await manager.process({
        tenantId: 'municipal-service', jurisdiction: 'ES', sector: 'health-care', section: 'identity', format: 'openid',
        resourceType: 'smart', action: 'token', id: '', sequence: 0, status: 'DRAFT', createdAtTimestamp: Date.now(),
        content: { thid: 'emergency-token-123', iss: actorDid, aud: 'did:web:soschain-gw.unid.online', body: {
          sub: actorDid,
          scope: `organization/Composition.rs?subject=${subjectDid}&section=allergies,medications`,
          purpose: 'EMERGENCY', expires_in: 1200, vp_token: vpToken,
          acr_values: 'urn:antifraud:acr:openid4vp:employee',
          break_glass: { incidentId: 'incident-123', subjectKind: 'human', reasonCode: 'life-threatening', justification: 'Immediate access is needed to avoid serious harm.' },
        } },
      } as any);

      expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ routeSector: 'health-care', subjectDid, professionalRole: 'ISCO-08|2211' }));
      expect(response.body).toMatchObject({ emergency: true, break_glass_authorization_id: 'authorization-123', expires_in: 600 });
      const payload = JSON.parse(Buffer.from(String(response.body.access_token).split('.')[1], 'base64url').toString('utf8'));
      expect(payload).toMatchObject({ emergency: true, break_glass_authorization_id: 'authorization-123', break_glass_incident_id: 'incident-123' });
    } finally {
      nowSpy.mockRestore();
    }
  });
});
