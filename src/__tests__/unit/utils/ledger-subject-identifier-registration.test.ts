// Flow contract: semantic Subject Bundles derive aliases locally and publish only the configured index-provider DID.
import { describe, expect, it, jest } from '@jest/globals';
import {
  buildSubjectIdentityBundleEntry,
  readSubjectIdentityBundleEntry,
} from 'gdc-common-utils-ts/utils/subject-identity';
import { registerSubjectIdentityBundleOnLedger } from '../../../utils/ledger-subject-identifier-registration';

/**
 * Flow contract: a Subject collection Bundle contains semantic identities.
 * The adapter derives the lookup key from private identity claims and sends
 * only the index-provider DID with the opaque alias to Fabric.
 */
describe('registerSubjectIdentityBundleOnLedger', () => {
  it('registers human and animal aliases against only the index-provider DID', async () => {
    const human = buildSubjectIdentityBundleEntry({
      subjectKind: 'person',
      cardId: 'urn:uhc:card:personal:alice',
      codingSystem: 'NN',
      jurisdiction: 'ES',
      codeValue: '12345678Z',
    });
    const animal = buildSubjectIdentityBundleEntry({
      subjectKind: 'animal',
      cardId: 'urn:vetchain:card:animal:luna',
      codingSystem: 'urn:iso:std:iso:11784-11785',
      jurisdiction: '',
      codeValue: '981020000123456',
    });
    const upsertSubjectIdentifier = jest.fn(async (
      _mspId: string,
      _assetId: string,
      _payload: object,
    ) => ({}));

    const result = await registerSubjectIdentityBundleOnLedger({
      mspId: 'Org1MSP',
      indexProviderDid: 'did:web:index.vetchain.app',
      entries: [human, animal, human],
      manager: { upsertSubjectIdentifier },
    });

    expect(result).toEqual([
      readSubjectIdentityBundleEntry(human).assetId,
      readSubjectIdentityBundleEntry(animal).assetId,
    ]);
    expect(upsertSubjectIdentifier).toHaveBeenCalledTimes(2);
    expect(upsertSubjectIdentifier).toHaveBeenNthCalledWith(1, 'Org1MSP', result[0], {
      indexProviderDid: 'did:web:index.vetchain.app',
    });
    expect(JSON.stringify(upsertSubjectIdentifier.mock.calls)).not.toContain('urn:uhc:card:personal:alice');
    expect(JSON.stringify(upsertSubjectIdentifier.mock.calls)).not.toContain('12345678Z');
    expect(JSON.stringify(upsertSubjectIdentifier.mock.calls)).not.toContain('981020000123456');
  });

  it('rejects a provider value that is not a did:web identifier', async () => {
    await expect(registerSubjectIdentityBundleOnLedger({
      mspId: 'Org1MSP',
      indexProviderDid: 'https://index.vetchain.app',
      entries: [buildSubjectIdentityBundleEntry({
        subjectKind: 'animal',
        cardId: 'urn:vetchain:card:animal:luna',
        codingSystem: 'urn:iso:std:iso:11784-11785',
        jurisdiction: '',
        codeValue: '981020000123456',
      })],
      manager: { upsertSubjectIdentifier: jest.fn(async () => ({})) },
    })).rejects.toThrow('did:web');
  });
});
