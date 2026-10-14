import {
  GLOBAL_HUMAN_IDENTITY_CHANNEL,
  buildRegionalLedgerChannel,
  type LedgerRegion,
} from '../../blockchain/fabric/v3/ledger-channel-name';
import {
  LedgerNetworkDomains,
  type SubjectLedgerTarget,
} from '../ledger-target';

export type HumanLedgerPurpose =
  | 'identity'
  | 'personal-device-key'
  | 'professional'
  | 'clinical'
  | 'provider-index';

/**
 * Resolves the approved human subject context.
 *
 * Authentication and governance choose the purpose and region before calling
 * this function. Request payload values are not an authorization source.
 */
export function resolveLedgerTargetHuman(
  purpose: HumanLedgerPurpose,
  region: LedgerRegion,
): SubjectLedgerTarget {
  if (purpose === 'identity' || purpose === 'personal-device-key') {
    return {
      networkDomain: LedgerNetworkDomains.GdcHumanHealth,
      channelName: GLOBAL_HUMAN_IDENTITY_CHANNEL,
    };
  }

  return {
    networkDomain: LedgerNetworkDomains.GdcHumanHealth,
    channelName: buildRegionalLedgerChannel('health-care', region),
    region,
  };
}

