// src/adapters/CredentialLedgerAdapterMulti.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import {
  CredentialHistoryEvent,
  CredentialLedgerContext,
  CredentialStatusRecord,
  ICredentialLedgerAdapter,
} from './ICredentialLedgerAdapter';

/**
 * Multi-ledger adapter for future fan-out use.
 * Currently returns the first available status and merges history by timestamp.
 */
export class CredentialLedgerAdapterMulti implements ICredentialLedgerAdapter {
  private adapters: ICredentialLedgerAdapter[];

  constructor(adapters: ICredentialLedgerAdapter[]) {
    this.adapters = adapters;
  }

  public async getCredentialStatus(id: string, network: string, context?: CredentialLedgerContext): Promise<CredentialStatusRecord | undefined> {
    for (const adapter of this.adapters) {
      const result = await adapter.getCredentialStatus(id, network, context);
      if (result) return result;
    }
    return undefined;
  }

  public async getCredentialHistory(id: string, network: string, context?: CredentialLedgerContext): Promise<CredentialHistoryEvent[]> {
    const events: CredentialHistoryEvent[] = [];
    for (const adapter of this.adapters) {
      const adapterEvents = await adapter.getCredentialHistory(id, network, context);
      events.push(...adapterEvents);
    }
    const seen = new Set<string>();
    const deduped = events.filter((event) => {
      const key = `${event.id}:${event.timestamp}:${event.status}:${event.txId || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    deduped.sort((a, b) => a.timestamp - b.timestamp);
    return deduped;
  }
}
