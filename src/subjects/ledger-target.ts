import type { LedgerRegion } from '../blockchain/fabric/v3/ledger-channel-name';

export const LedgerNetworkDomains = Object.freeze({
  GdcHumanHealth: 'gdc-human-health',
  VetChainPets: 'vetchain-pets',
} as const);

export type LedgerNetworkDomain =
  typeof LedgerNetworkDomains[keyof typeof LedgerNetworkDomains];

export type SubjectLedgerTarget = Readonly<{
  networkDomain: LedgerNetworkDomain;
  channelName: string;
  region?: LedgerRegion;
}>;

