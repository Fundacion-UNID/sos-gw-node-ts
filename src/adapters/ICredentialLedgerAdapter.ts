// src/adapters/ICredentialLedgerAdapter.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export type CredentialLedgerStatus = 'active' | 'suspended' | 'revoked' | 'expired';

export interface CredentialStatusRecord {
  id: string;
  status: CredentialLedgerStatus;
  issuedAt?: number;
  updatedAt: number;
  suspendedAt?: number | null;
  revokedAt?: number | null;
  expiresAt?: number | null;
  issuer?: string;
  subject?: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialHistoryEvent {
  id: string;
  status: CredentialLedgerStatus;
  timestamp: number;
  txId?: string;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface CredentialLedgerContext {
  channelName?: string;
}

/**
 * Minimal ledger adapter for credential status and history lookups.
 * This keeps Fabric-specific logic out of the routing layer.
 */
export interface ICredentialLedgerAdapter {
  getCredentialStatus(id: string, network: string, context?: CredentialLedgerContext): Promise<CredentialStatusRecord | undefined>;
  getCredentialHistory(id: string, network: string, context?: CredentialLedgerContext): Promise<CredentialHistoryEvent[]>;
}
