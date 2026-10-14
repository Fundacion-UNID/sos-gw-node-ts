// src/adapters/credential-ledger-resolver.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { CredentialLedgerContext, ICredentialLedgerAdapter } from './ICredentialLedgerAdapter';

export type LedgerProviderName = 'mem' | 'fabric' | 'pontusx' | 'multi';

export function parseLedgerProviderMap(input?: string): Record<string, string> {
  if (!input) return {};
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [network, provider] = entry.split('=').map((value) => value.trim());
      if (network && provider) acc[network] = provider;
      return acc;
    }, {});
}

type LedgerProviderEnvironment = Record<string, string | undefined>;

/**
 * Resolves the ledger provider for the process's active network mode.
 *
 * Entries for other modes are deliberately ignored. A runtime in `test` must
 * not acquire Fabric side effects merely because its configuration also
 * describes how a future `test-network` or `network` deployment will behave.
 */
export function resolveConfiguredLedgerProvider(
  env: LedgerProviderEnvironment = process.env,
): string {
  const networkMode = String(env.NETWORK_MODE || '').trim().toLowerCase();
  const providerMap = parseLedgerProviderMap(env.LEDGER_PROVIDER_MAP);
  return String(
    providerMap[networkMode]
    || env.LEDGER_PROVIDER_DEFAULT
    || 'mem',
  ).trim().toLowerCase();
}

/**
 * Returns whether the active runtime should compose Fabric write adapters.
 *
 * `test` is the in-memory compatibility runtime and is always isolated from
 * Fabric. For the other modes, an explicit provider route is authoritative;
 * legacy enablement flags are considered only when no provider route exists.
 */
export function shouldUseFabricLedger(
  env: LedgerProviderEnvironment = process.env,
): boolean {
  const networkMode = String(env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'test') return false;
  if (networkMode === 'local-network') return true;

  const providerMap = parseLedgerProviderMap(env.LEDGER_PROVIDER_MAP);
  const hasExplicitProvider = Boolean(
    providerMap[networkMode]
    || String(env.LEDGER_PROVIDER_DEFAULT || '').trim(),
  );
  if (hasExplicitProvider) {
    const provider = resolveConfiguredLedgerProvider(env);
    return provider === 'fabric' || provider === 'multi';
  }

  const ledgerEnabled = String(env.LEDGER_ENABLED || '').trim().toLowerCase() === 'true';
  const explicitConsentChaincode = String(env.CONSENT_ACCESS_LEDGER_CHAINCODE || '').trim();
  return ledgerEnabled || explicitConsentChaincode.length > 0;
}

export class CredentialLedgerResolver implements ICredentialLedgerAdapter {
  private defaultProvider: string;
  private providerMap: Record<string, string>;
  private providers: Record<string, ICredentialLedgerAdapter>;

  constructor(options: {
    defaultProvider: string;
    providerMap: Record<string, string>;
    providers: Record<string, ICredentialLedgerAdapter>;
  }) {
    this.defaultProvider = options.defaultProvider;
    this.providerMap = options.providerMap;
    this.providers = options.providers;
  }

  public resolveProviderName(network: string): string {
    return this.providerMap[network] || this.defaultProvider;
  }

  public getProviderForNetwork(network: string): ICredentialLedgerAdapter | undefined {
    return this.providers[this.resolveProviderName(network)];
  }

  public async getCredentialStatus(id: string, network: string, context?: CredentialLedgerContext) {
    const provider = this.getProviderForNetwork(network);
    if (!provider) {
      throw new Error(`No ledger provider configured for network "${network}".`);
    }
    return provider.getCredentialStatus(id, network, context);
  }

  public async getCredentialHistory(id: string, network: string, context?: CredentialLedgerContext) {
    const provider = this.getProviderForNetwork(network);
    if (!provider) {
      throw new Error(`No ledger provider configured for network "${network}".`);
    }
    return provider.getCredentialHistory(id, network, context);
  }
}
