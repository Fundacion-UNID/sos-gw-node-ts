import { describe, expect, it } from '@jest/globals';
import { DefaultTrustRegistryAdapter } from '../../../adapters/trust-registry.adapter';

describe('DefaultTrustRegistryAdapter', () => {
  it('returns relaxed policy in test mode', async () => {
    const adapter = new DefaultTrustRegistryAdapter();
    const result = await adapter.verifyActivationTrust({
      networkMode: 'test',
      organizationDid: 'did:web:org.example',
    });

    expect(result.revocationChecked).toBe(false);
    expect(result.issuerKeyStatusChecked).toBe(false);
    expect(result.subjectKeyStatusChecked).toBe(false);
    expect(result.onChainChecked).toBe(false);
  });

  it('returns strict policy in network mode', async () => {
    const adapter = new DefaultTrustRegistryAdapter();
    const result = await adapter.verifyActivationTrust({
      networkMode: 'network',
      organizationDid: 'did:web:org.example',
      representativeDid: 'did:web:rep.example',
    });

    expect(result.revocationChecked).toBe(true);
    expect(result.issuerKeyStatusChecked).toBe(true);
    expect(result.subjectKeyStatusChecked).toBe(true);
    expect(result.onChainChecked).toBe(true);
  });
});
