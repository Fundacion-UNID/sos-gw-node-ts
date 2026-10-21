// Flow contract: SOS runtime exports only canonical APIs; removed aliases and throwing stubs cannot return through later merges.
import { readFileSync } from 'node:fs';

describe('deprecated SOS runtime surface', () => {
  it('does not export dead provider, verification-status or DID service aliases', () => {
    const envelopeFactory = readFileSync('src/services/envelope-adapter-factory.ts', 'utf8');
    const gatewayTypes = readFileSync('src/shared/gateway-response-types.ts', 'utf8');
    const didBackend = readFileSync('src/utils/did-backend.ts', 'utf8');

    expect(envelopeFactory).not.toContain('resolveEnvelopeProvider');
    expect(gatewayTypes).not.toContain('GatewayVerificationStatus =');
    expect(didBackend).not.toContain('createDidServiceIdBase');
  });
});
