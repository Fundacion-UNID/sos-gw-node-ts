/**
 * Generic Fabric channel-name primitives.
 *
 * Product adapters select the channel family and subject domain. Core only
 * validates the stable region suffix and construction rules.
 */
export const LedgerRegions = Object.freeze({
  EU: 'eu',
  NA: 'na',
  ASIA: 'asia',
  AFRICA: 'africa',
  PACIFIC: 'pacific',
  LATAM: 'latam',
} as const);

export type LedgerRegion = typeof LedgerRegions[keyof typeof LedgerRegions];

export const GLOBAL_HUMAN_IDENTITY_CHANNEL = 'identity-global' as const;
export const EU_ORGANIZATION_IDENTITY_CHANNEL = 'identity-eu' as const;

const CHANNEL_FAMILY_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Builds a channel name with the jurisdictional region in the final segment.
 */
export function buildRegionalLedgerChannel(
  channelFamily: string,
  region: LedgerRegion,
): string {
  const family = String(channelFamily || '').trim().toLowerCase();
  if (!CHANNEL_FAMILY_PATTERN.test(family)) {
    throw new Error('Invalid Fabric channel family');
  }
  if (!Object.values(LedgerRegions).includes(region)) {
    throw new Error('Invalid Fabric ledger region');
  }
  return family + '-' + region;
}
