// Flow contract: the GW derives the opaque alias privately and Fabric receives only that alias plus the configured provider DID.
import { describe, expect, it, jest } from '@jest/globals';
import {
  buildSubjectIdentityLedgerPort,
  buildSubjectIdentityLedgerPortFromEnv,
  resolveSubjectIdentityProviderFromEnv,
} from '../../../utils/subject-identity-ledger-port';

/**
 * Audit boundary: runtime wiring may send only an opaque lookup id. The
 * adapter contributes the public provider DID; no card or coding value belongs
 * in this port.
 */
describe('buildSubjectIdentityLedgerPort', () => {
  it('maps Subject writes and erasure to the Fabric wrapper', async () => {
    const manager = {
      upsertSubjectIdentifier: jest.fn(async (_mspId: string, _assetId: string, _payload: unknown) => ({})),
      deleteSubjectIdentifier: jest.fn(async (_mspId: string, _assetId: string, _providerDid: string) => ({})),
    };
    const port = buildSubjectIdentityLedgerPort({
      mspId: 'Org1MSP', indexProviderDid: 'did:web:index.example.org', manager,
    });

    await port.upsert({ assetId: 'urn:multibase:zOpaque' });
    await port.delete({ assetId: 'urn:multibase:zOpaque' });

    expect(manager.upsertSubjectIdentifier).toHaveBeenCalledWith('Org1MSP', 'urn:multibase:zOpaque', {
      indexProviderDid: 'did:web:index.example.org',
    });
    expect(manager.deleteSubjectIdentifier).toHaveBeenCalledWith(
      'Org1MSP', 'urn:multibase:zOpaque', 'did:web:index.example.org',
    );
  });

  it('fails closed when enabled runtime identity is incomplete', () => {
    expect(() => buildSubjectIdentityLedgerPort({
      mspId: '', indexProviderDid: 'did:web:index.example.org', manager: {} as any,
    })).toThrow(/MSP/);
  });

  it('rejects a provider domain or business number because the pointer must be did:web', () => {
    expect(() => buildSubjectIdentityLedgerPort({
      mspId: 'VetChainMSP', indexProviderDid: 'beta-gw.vetchain.app', manager: {} as any,
    })).toThrow(/did:web/);
    expect(() => buildSubjectIdentityLedgerPort({
      mspId: 'VetChainMSP', indexProviderDid: '704457076', manager: {} as any,
    })).toThrow(/did:web/);
  });

  it('uses only the VetChain provider DID variable', () => {
    const previous = { ...process.env };
    try {
      Object.assign(process.env, {
        SUBJECT_IDENTIFIER_LEDGER_ENABLED: 'true',
        LEDGER_MSP_ID: 'VetChainMSP',
        VET_INDEX_PROVIDER_DID: 'did:web:index.vetchain.app',
        UHC_PROVIDER_ID: '12345-6789',
        UHC_PROVIDER_DOMAIN: 'legacy.example.org',
      });

      expect(resolveSubjectIdentityProviderFromEnv()).toEqual({
        indexProviderDid: 'did:web:index.vetchain.app',
      });
      expect(buildSubjectIdentityLedgerPortFromEnv()).toBeDefined();
    } finally {
      process.env = previous;
    }
  });
});
