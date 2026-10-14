// Flow contract: preserve SOSChain break-glass authorization and make the test green only with the complete real behavior.
import {
  evaluateSoschainBreakGlassPolicy,
  SoschainBreakGlassService,
} from '../../../extensions/soschain/break-glass';

const humanRequest = {
  routeSector: 'health-care',
  subjectKind: 'human' as const,
  professionalRole: 'ISCO-08|2211',
  requestedScope: 'organization/Composition.rs?subject=did:web:gw.example:individual:123&section=allergies,medications',
  reasonCode: 'life-threatening' as const,
};

describe('SOSChain break-glass sector and profession policy', () => {
  it('allows a verified physician to request read-only human emergency access through health-care', () => {
    expect(evaluateSoschainBreakGlassPolicy(humanRequest)).toEqual({ allowed: true, maxLifetimeSeconds: 900 });
  });

  it.each(['health-research', 'onehealth-research', 'animal-care', 'animal-research'])(
    'never allows a human break-glass request through %s',
    (routeSector) => {
      expect(evaluateSoschainBreakGlassPolicy({ ...humanRequest, routeSector })).toMatchObject({ allowed: false });
    },
  );

  it('does not infer emergency authority from nursing or employment alone', () => {
    expect(evaluateSoschainBreakGlassPolicy({ ...humanRequest, professionalRole: 'ISCO-08|2221' })).toMatchObject({
      allowed: false,
      reason: 'professional_role_not_authorized',
    });
  });

  it('allows veterinarians only for animal subjects through animal-care', () => {
    const animal = {
      ...humanRequest,
      routeSector: 'animal-care',
      subjectKind: 'animal' as const,
      professionalRole: 'ISCO-08|2250',
      reasonCode: 'animal-emergency' as const,
    };
    expect(evaluateSoschainBreakGlassPolicy(animal)).toMatchObject({ allowed: true });
    expect(evaluateSoschainBreakGlassPolicy({ ...animal, routeSector: 'health-care' })).toMatchObject({ allowed: false });
  });

  it('rejects write scopes even for an otherwise authorized physician', () => {
    expect(evaluateSoschainBreakGlassPolicy({
      ...humanRequest,
      requestedScope: 'organization/Composition.cruds?subject=did:web:gw.example:individual:123&section=*',
    })).toMatchObject({ allowed: false, reason: 'read_only_scope_required' });
  });
});

describe('SOSChain break-glass audit and controller notice', () => {
  it('writes coded hash-only ledger events and requires notification acknowledgement', async () => {
    const previousDataChannel = process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    process.env.LEDGER_DATA_CHANNEL_DEFAULT = 'health-care-eu';
    const registerArtifactBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx' });
    const notify = jest.fn().mockResolvedValue({ notificationId: 'notice-123' });
    const records = new Map<string, any>();
    const service = new SoschainBreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle } as any,
      {
        get: jest.fn(async (_vault: string, id: string) => records.get(id)),
        put: jest.fn(async (_vault: string, values: any[]) => {
          values.forEach((value) => records.set(value.id, value));
          return true;
        }),
      } as any,
      { notify },
      () => new Date('2026-08-26T12:00:00.000Z'),
    );
    try {
      const result = await service.authorize({
        tenantId: 'municipal-service', jurisdiction: 'ES', routeSector: 'health-care',
        actorDid: 'did:web:provider.example:employee:doctor:ISCO-08|2211',
        actorOrganizationDid: 'did:web:provider.example:organization:tax:example',
        requestingClientId: 'did:key:professional-device',
        tokenAudience: 'did:web:soschain.example',
        professionalRole: 'ISCO-08|2211',
        subjectDid: 'did:web:soschain.example:individual:123',
        requestedScope: humanRequest.requestedScope,
        request: { incidentId: 'incident-123', subjectKind: 'human', reasonCode: 'life-threatening', justification: 'Immediate access is needed to avoid serious harm.' },
        professionalCredentialVerified: true, ledgerVerified: true, requestedLifetimeSeconds: 1200,
      });

      expect(result.lifetimeSeconds).toBe(900);
      expect(result.emergencyConsentId).toBeTruthy();
      expect(notify).toHaveBeenCalledTimes(1);
      expect(registerArtifactBundle).toHaveBeenCalledTimes(3);
      const firstPayload = registerArtifactBundle.mock.calls[0][0].payload;
      expect(firstPayload).toMatchObject({
        type: 'BreakGlassEmergencyConsent', routeSector: 'health-care', subjectKind: 'human',
        reasonCode: 'life-threatening', controllerNotification: 'pending',
      });
      expect(JSON.stringify(firstPayload)).not.toContain('Immediate access');
      expect(JSON.stringify(firstPayload)).not.toContain('did:web:soschain.example:individual:123');
    } finally {
      if (previousDataChannel === undefined) delete process.env.LEDGER_DATA_CHANNEL_DEFAULT;
      else process.env.LEDGER_DATA_CHANNEL_DEFAULT = previousDataChannel;
    }
  });
});
