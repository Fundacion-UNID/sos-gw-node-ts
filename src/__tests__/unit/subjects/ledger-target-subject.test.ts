/**
 * Flow contract: the temporary dual-subject GW keeps human and pet routing in
 * separate adapters so either product can remove the other adapter later.
 * Multi-species veterinary professionals are registered once in the regional
 * identity channel and referenced from species-specific animal channels.
 */
import { LedgerRegions } from '../../../blockchain/fabric/v3/ledger-channel-name';
import { resolveLedgerTargetAnimal } from '../../../subjects/animal/ledger-target-animal';
import { resolveLedgerTargetHuman } from '../../../subjects/human/ledger-target-human';
import { LedgerNetworkDomains } from '../../../subjects/ledger-target';

describe('subject ledger target adapters', () => {
  it('routes global human identity separately from regional human clinical state', () => {
    expect(resolveLedgerTargetHuman('identity', LedgerRegions.EU)).toEqual({
      networkDomain: LedgerNetworkDomains.GdcHumanHealth,
      channelName: 'identity-global',
    });
    expect(resolveLedgerTargetHuman('provider-index', LedgerRegions.PACIFIC)).toEqual({
      networkDomain: LedgerNetworkDomains.GdcHumanHealth,
      channelName: 'health-care-pacific',
      region: 'pacific',
    });
  });

  it.each([
    'identity',
    'ownership',
    'clinical',
    'provider-index',
    'petd',
  ] as const)('keeps pet purpose %s in the regional VetChain channel', (purpose) => {
    expect(resolveLedgerTargetAnimal(purpose, LedgerRegions.LATAM)).toEqual({
      networkDomain: LedgerNetworkDomains.VetChainPets,
      channelName: 'animal-pet-latam',
      region: 'latam',
    });
  });

  it.each(['professional', 'device-key'] as const)(
    'routes veterinary %s state to one jurisdictional identity channel',
    (purpose) => {
      expect(resolveLedgerTargetAnimal(purpose, LedgerRegions.LATAM)).toEqual({
        networkDomain: LedgerNetworkDomains.VetChainPets,
        channelName: 'identity-latam',
        region: 'latam',
      });
    },
  );
});
