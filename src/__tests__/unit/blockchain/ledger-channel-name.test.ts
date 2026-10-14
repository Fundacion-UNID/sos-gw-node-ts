/**
 * Flow contract: Core constructs only canonical region-final channel names;
 * product adapters remain responsible for selecting a permitted family.
 */
import {
  EU_ORGANIZATION_IDENTITY_CHANNEL,
  GLOBAL_HUMAN_IDENTITY_CHANNEL,
  LedgerRegions,
  buildRegionalLedgerChannel,
} from '../../../blockchain/fabric/v3/ledger-channel-name';

describe('ledger channel name', () => {
  it('keeps the global human identity channel non-regional', () => {
    expect(GLOBAL_HUMAN_IDENTITY_CHANNEL).toBe('identity-global');
    expect(EU_ORGANIZATION_IDENTITY_CHANNEL).toBe('identity-eu');
  });

  it.each(Object.values(LedgerRegions))('places region %s last', (region) => {
    expect(buildRegionalLedgerChannel('health-care', region)).toBe('health-care-' + region);
  });

  it('rejects an invalid family or region', () => {
    expect(() => buildRegionalLedgerChannel('Health Care', LedgerRegions.EU)).toThrow(
      'Invalid Fabric channel family',
    );
    expect(() => buildRegionalLedgerChannel('health-care', 'es' as never)).toThrow(
      'Invalid Fabric ledger region',
    );
  });
});
