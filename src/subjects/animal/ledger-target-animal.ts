import {
  buildRegionalLedgerChannel,
  type LedgerRegion,
} from '../../blockchain/fabric/v3/ledger-channel-name';
import {
  LedgerNetworkDomains,
  type SubjectLedgerTarget,
} from '../ledger-target';

export type AnimalLedgerPurpose =
  | 'identity'
  | 'ownership'
  | 'professional'
  | 'clinical'
  | 'provider-index'
  | 'petd'
  | 'device-key';

/**
 * Resolves animal and veterinary-professional state to VetChain Pets.
 *
 * A veterinarian is registered once in the regional professional identity
 * channel and is referenced by each authorized species channel. The adapter
 * only chooses the owning ledger; organization admission and actor-role
 * authorization remain mandatory before this resolver is called.
 */
export function resolveLedgerTargetAnimal(
  purpose: AnimalLedgerPurpose,
  region: LedgerRegion,
): SubjectLedgerTarget {
  if (purpose === 'professional' || purpose === 'device-key') {
    return {
      networkDomain: LedgerNetworkDomains.VetChainPets,
      channelName: buildRegionalLedgerChannel('identity', region),
      region,
    };
  }

  return {
    networkDomain: LedgerNetworkDomains.VetChainPets,
    channelName: buildRegionalLedgerChannel('animal-pet', region),
    region,
  };
}
