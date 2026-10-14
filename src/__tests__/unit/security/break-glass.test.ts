// Flow contract: persist one emergency Consent, notify the animal controller securely, and issue independently audited short SMART tokens.
import { BreakGlassService, evaluateBreakGlassPolicy } from '../../../security/break-glass';

const humanRequest = {
  routeSector: 'health-care',
  subjectKind: 'human' as const,
  professionalRole: 'ISCO-08|2211',
  requestedScope: 'organization/Composition.rs?subject=did:web:gw.example:individual:123&section=allergies,medications',
  reasonCode: 'life-threatening' as const,
};

describe('break-glass sector and profession policy', () => {
  it('allows a verified physician to request read-only human emergency access through health-care', () => {
    expect(evaluateBreakGlassPolicy(humanRequest)).toEqual({ allowed: true, maxLifetimeSeconds: 900 });
  });

  it.each(['health-research', 'onehealth-research', 'animal-care', 'animal-research'])(
    'never allows a human break-glass request through %s',
    (routeSector) => expect(evaluateBreakGlassPolicy({ ...humanRequest, routeSector })).toMatchObject({ allowed: false }),
  );

  it('does not infer emergency authority from nursing or employment alone', () => {
    expect(evaluateBreakGlassPolicy({ ...humanRequest, professionalRole: 'ISCO-08|2221' })).toMatchObject({
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
    expect(evaluateBreakGlassPolicy(animal)).toMatchObject({ allowed: true });
    expect(evaluateBreakGlassPolicy({ ...animal, routeSector: 'health-care' })).toMatchObject({ allowed: false });
  });

  it('rejects write scopes even for an otherwise authorized physician', () => {
    expect(evaluateBreakGlassPolicy({
      ...humanRequest,
      requestedScope: 'organization/Composition.cruds?subject=did:web:gw.example:individual:123&section=*',
    })).toMatchObject({ allowed: false, reason: 'read_only_scope_required' });
  });
});

describe('break-glass audit and controller notice', () => {
  it('persists and reuses one 24-hour emergency Consent while issuing 15-minute token authorizations', async () => {
    const previousDataChannel = process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    process.env.LEDGER_DATA_CHANNEL_DEFAULT = 'animal-pet-na';
    const registerArtifactBundle = jest.fn().mockResolvedValue({ accepted: 1, txId: 'tx' });
    const notify = jest.fn().mockResolvedValue({ notificationId: 'notice-123' });
    const records = new Map<string, any>();
    const vaultRepository = {
      get: jest.fn(async (_vault: string, id: string) => records.get(id)),
      put: jest.fn(async (_vault: string, values: any[]) => { values.forEach((value) => records.set(value.id, value)); return true; }),
    } as any;
    let now = new Date('2026-08-26T12:00:00.000Z');
    const service = new BreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
      vaultRepository,
      { notify },
      () => now,
      { consentLifetimeSeconds: 86_400 },
    );
    const input = {
      tenantId: '704457076', jurisdiction: 'CA-BC', routeSector: 'animal-care',
      actorDid: 'did:web:clinic.example:employee:vet@example.org:ISCO-08|2250',
      actorOrganizationDid: 'did:web:clinic.example:organization:bn:704457076',
      requestingClientId: 'did:key:clinic-b-workstation', tokenAudience: 'did:web:beta-gw.vetchain.app',
      professionalRole: 'ISCO-08|2250',
      subjectDid: 'did:web:vetchain.example:card:vetchain:72409:0961510852611267',
      requestedScope: 'organization/Composition.rs?subject=did:web:vetchain.example:card:vetchain:72409:0961510852611267&section=allergies,medications',
      request: {
        incidentId: 'incident-123',
        subjectKind: 'animal',
        reasonCode: 'animal-emergency',
        justification: 'Immediate veterinary access is needed to avoid serious harm.',
      },
      professionalCredentialVerified: true, ledgerVerified: true, requestedLifetimeSeconds: 1200,
    } as const;
    const result = await service.authorize(input);

    expect(result.lifetimeSeconds).toBe(900);
    expect(result.consentExpiresAt).toBe('2026-08-27T12:00:00.000Z');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      requesterOrganizationDid: input.actorOrganizationDid,
      jurisdiction: 'CA-BC',
      professionalActorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      communication: expect.objectContaining({ sender: { reference: input.actorOrganizationDid } }),
    }));
    expect(JSON.stringify(notify.mock.calls[0][0])).not.toContain(input.actorDid);
    expect(notify.mock.calls[0][0]).not.toHaveProperty('justification');
    expect([...records.values()][0]).toMatchObject({
      'Consent.purpose': 'ETREAT', 'Consent.period-end': '2026-08-27T12:00:00.000Z',
    });
    expect(registerArtifactBundle).toHaveBeenCalledTimes(3);
    expect(registerArtifactBundle.mock.calls.every(([params]) => !('chaincode' in params))).toBe(true);
    expect(registerArtifactBundle.mock.calls.every(([params]) => params.channel === 'animal-pet-na')).toBe(true);
    expect(registerArtifactBundle.mock.calls.every(([params]) => (
      params.payload.artifactId === params.assetId
      && params.payload.hashAlg === 'sha256'
      && /^[a-f0-9]{64}$/.test(String(params.payload.hash))
    ))).toBe(true);
    const firstPayload = registerArtifactBundle.mock.calls[0][0].payload;
    expect(firstPayload).toMatchObject({
      type: 'BreakGlassEmergencyConsent',
      consentClaimsHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      requesterOrganizationDid: input.actorOrganizationDid,
      jurisdiction: 'CA-BC',
      controllerNotification: 'pending',
    });
    now = new Date('2026-08-26T13:00:00.000Z');
    const renewed = await service.authorize(input);
    expect(renewed.emergencyConsentId).toBe(result.emergencyConsentId);
    expect(renewed.authorizationId).not.toBe(result.authorizationId);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(registerArtifactBundle).toHaveBeenCalledTimes(4);
    if (previousDataChannel === undefined) delete process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    else process.env.LEDGER_DATA_CHANNEL_DEFAULT = previousDataChannel;
  });

  it('rejects a declared animal kind for a human DID before writing audit data', async () => {
    const registerArtifactBundle = jest.fn();
    const service = new BreakGlassService(
      { discoverDidsByHashes: jest.fn(), registerArtifactBundle },
      { get: jest.fn(), put: jest.fn() } as any,
      { notify: jest.fn() },
    );
    await expect(service.authorize({
      tenantId: 'vet', jurisdiction: 'ES', routeSector: 'animal-care',
      actorDid: 'did:web:provider.example:employee:vet:ISCO-08|2250', professionalRole: 'ISCO-08|2250',
      actorOrganizationDid: 'did:web:provider.example:organization:bn:704457076',
      requestingClientId: 'did:key:workstation', tokenAudience: 'did:web:gw.example',
      subjectDid: 'did:web:gw.example:individual:123',
      requestedScope: 'organization/Composition.rs?subject=did:web:gw.example:individual:123',
      request: { incidentId: 'incident-123', subjectKind: 'animal', reasonCode: 'animal-emergency', justification: 'Immediate veterinary emergency access.' },
      professionalCredentialVerified: true, ledgerVerified: true, requestedLifetimeSeconds: 300,
    })).rejects.toThrow('subject_kind_mismatch');
    expect(registerArtifactBundle).not.toHaveBeenCalled();
  });
});
