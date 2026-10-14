// Flow contract: one active emergency Consent may authorize several independently expiring animal-care SMART tokens.
import { buildUnsignedProfessionalIdentityVpJwt } from 'gdc-common-utils-ts/utils/professional-smart';
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';

describe('OpenIdAuthManager break-glass SMART integration', () => {
  it('issues a short animal emergency token only after the authorizer records the exception', async () => {
    const actorDid = 'did:web:clinic.example:employee:vet@example.org:ISCO-08|2250';
    const subjectDid = 'did:web:vetchain.example:card:vetchain:72409:0961510852611267';
    const vpToken = buildUnsignedProfessionalIdentityVpJwt({ clientId: actorDid, actorDid, role: 'ISCO-08|2250' });
    const authorize = jest.fn().mockResolvedValue({
      emergencyConsentId: 'emergency-consent-123',
      consentExpiresAt: '2026-08-27T12:00:00.000Z',
      authorizationId: 'authorization-123',
      issuedAt: '2026-08-26T12:00:00.000Z',
      expiresAt: '2026-08-26T12:10:00.000Z',
      lifetimeSeconds: 600,
      auditAssetId: 'break-glass:authorization-123',
      notificationId: 'notification-123',
    });
    const now = Math.floor(Date.parse('2026-08-26T12:00:00.000Z') / 1000);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    try {
      const manager = new OpenIdAuthManager(
        {
          getPublicVerificationKey: jest.fn().mockResolvedValue({ kid: 'tenant-key', alg: 'ES384' }),
          signWithManagedKey: jest.fn().mockResolvedValue({ signatures: [{ signature: 'signature' }] }),
          createCompactJws: jest.fn().mockImplementation(async (payload: object) => (
            `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`
          )),
        } as any,
        {
          tenantExists: jest.fn().mockResolvedValue(true),
          getDidDocument: jest.fn().mockResolvedValue({ id: 'did:web:gw.example' }),
        } as any,
        { getContainersInSection: jest.fn().mockResolvedValue([]) } as any,
        {
          verifyVpToken: jest.fn().mockResolvedValue({
            acr: 'urn:antifraud:acr:openid4vp:employee',
            amr: ['openid4vp', 'vc'],
            vpHash: 'hash',
            ledgerVerified: true,
          }),
        } as any,
        { authorize },
      );

      const response = await manager.process({
        tenantId: '704457076',
        jurisdiction: 'CA-BC',
        sector: 'animal-care',
        section: 'identity',
        format: 'openid',
        resourceType: 'smart',
        action: 'token',
        id: '',
        sequence: 0,
        status: 'DRAFT',
        createdAtTimestamp: Date.now(),
        content: {
          thid: 'emergency-token-123',
          iss: actorDid,
          aud: 'did:web:gw.example',
          body: {
            sub: actorDid,
            scope: `organization/Composition.rs?subject=${subjectDid}&section=allergies,medications`,
            purpose: 'EMERGENCY',
            expires_in: 1200,
            vp_token: vpToken,
            acr_values: 'urn:antifraud:acr:openid4vp:employee',
            break_glass: {
              incidentId: 'incident-123',
              subjectKind: 'animal',
              reasonCode: 'animal-emergency',
              justification: 'Immediate veterinary access is needed to avoid serious harm.',
            },
          },
        },
      } as any);

      expect(authorize).toHaveBeenCalledWith(expect.objectContaining({
        routeSector: 'animal-care',
        subjectDid,
        professionalRole: 'ISCO-08|2250',
      }));
      expect(response.body).toMatchObject({
        emergency: true,
        emergency_consent_id: 'emergency-consent-123',
        emergency_consent_expires_at: '2026-08-27T12:00:00.000Z',
        break_glass_authorization_id: 'authorization-123',
        expires_in: 600,
      });
      const payload = JSON.parse(Buffer.from(String(response.body.access_token).split('.')[1], 'base64url').toString('utf8'));
      expect(payload).toMatchObject({
        emergency: true,
        emergency_consent_id: 'emergency-consent-123',
        break_glass_authorization_id: 'authorization-123',
        break_glass_incident_id: 'incident-123',
      });
    } finally {
      nowSpy.mockRestore();
    }
  });
});
