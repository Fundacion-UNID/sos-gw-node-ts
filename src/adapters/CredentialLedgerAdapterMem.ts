// src/adapters/CredentialLedgerAdapterMem.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { CredentialHistoryEvent, CredentialLedgerContext, CredentialStatusRecord, ICredentialLedgerAdapter } from './ICredentialLedgerAdapter';

/**
 * In-memory ledger adapter for demo/testing environments.
 */
export class CredentialLedgerAdapterMem implements ICredentialLedgerAdapter {
  private statusLedger = new Map<string, CredentialStatusRecord>();
  private historyLedger = new Map<string, CredentialHistoryEvent[]>();

  private static key(network: string, id: string): string {
    return `${network}:${id}`;
  }

  public async getCredentialStatus(id: string, network: string, context?: CredentialLedgerContext): Promise<CredentialStatusRecord | undefined> {
    const record = this.statusLedger.get(CredentialLedgerAdapterMem.key(network, id));
    await new Promise((resolve) => setTimeout(resolve, 25));
    return record;
  }

  public async getCredentialHistory(id: string, network: string, context?: CredentialLedgerContext): Promise<CredentialHistoryEvent[]> {
    const events = this.historyLedger.get(CredentialLedgerAdapterMem.key(network, id)) || [];
    await new Promise((resolve) => setTimeout(resolve, 25));
    return [...events];
  }

  public seedStatus(network: string, record: CredentialStatusRecord): void {
    this.statusLedger.set(CredentialLedgerAdapterMem.key(network, record.id), record);
  }

  public appendHistory(network: string, event: CredentialHistoryEvent): void {
    const key = CredentialLedgerAdapterMem.key(network, event.id);
    const existing = this.historyLedger.get(key) || [];
    this.historyLedger.set(key, [...existing, event]);
  }
}
