// src/__tests__/integration/credentialLedger.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { invokeExpress } from './helpers/invokeExpress';
import { CredentialLedgerAdapterMem } from '../../adapters/CredentialLedgerAdapterMem';
import { CredentialLedgerResolver } from '../../adapters/credential-ledger-resolver';
import { BlockchainAdapterMem } from '../../adapters/BlockchainAdapterMem';
import { startServer, resetServerConfig } from '../../server';

describe('Credential ledger endpoints (demo, mem)', () => {
  it('keeps the active test runtime off Fabric when only higher modes map to Fabric', async () => {
    const keys = [
      'NETWORK_MODE',
      'LEDGER_ENABLED',
      'LEDGER_PROVIDER_DEFAULT',
      'LEDGER_PROVIDER_MAP',
      'CONSENT_ACCESS_LEDGER_CHAINCODE',
    ] as const;
    const originalValues = new Map(keys.map((key) => [key, process.env[key]]));

    Object.assign(process.env, {
      NETWORK_MODE: 'test',
      LEDGER_ENABLED: 'true',
      LEDGER_PROVIDER_DEFAULT: 'mem',
      LEDGER_PROVIDER_MAP: 'test=mem,test-network=fabric,network=fabric',
    });
    delete process.env.CONSENT_ACCESS_LEDGER_CHAINCODE;
    resetServerConfig();

    const { blockchainAdapter, queueAdapter } = await startServer({ listen: false });
    try {
      expect(blockchainAdapter).toBeInstanceOf(BlockchainAdapterMem);
    } finally {
      queueAdapter.stop();
      for (const key of keys) {
        const value = originalValues.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      resetServerConfig();
    }
  });

  it('should return sync and async status/history from the ledger', async () => {
    process.env.NODE_ENV = 'demo';
    process.env.DB_PROVIDER = 'mem';
    process.env.STORAGE_PROVIDER = 'mem';
    process.env.QUEUE_PROVIDER = 'mem';
    process.env.SECTORS_ALLOWED = 'health-care';

    process.env.ORG_HOST_LEGAL_NAME = 'Gateway Host Services';
    process.env.ORG_HOST_JURISDICTION = 'ES';
    process.env.ORG_HOST_ID_TYPE = 'TAX';
    process.env.ORG_HOST_ID_VALUE = 'A0011223344';
    process.env.ORG_HOST_ADMIN_EMAIL = 'admin@host.com';
    process.env.ORG_HOST_ADMIN_UID = 'host-admin-001';
    process.env.ORG_HOST_ADMIN_ROLE = 'ISCO-08|1111';
    process.env.ORG_HOST_TERMS_URL = 'https://example.org/terms.pdf';

    resetServerConfig();

    const network = 'test';
    const { app, queueAdapter, credentialLedgerAdapter } = await startServer({ listen: false });
    const ledgerResolver = credentialLedgerAdapter as CredentialLedgerResolver;
    const ledger = ledgerResolver.getProviderForNetwork(network) as CredentialLedgerAdapterMem;

    const credentialId = 'urn:uuid:vc-test-001';
    const now = Math.floor(Date.now() / 1000);

    ledger.seedStatus(network, {
      id: credentialId,
      status: 'active',
      issuedAt: now,
      updatedAt: now,
      issuer: 'did:web:host.example.org',
      subject: 'did:web:tenant.example.org',
    });
    ledger.appendHistory(network, {
      id: credentialId,
      status: 'active',
      timestamp: now,
      actor: 'did:web:ica.example.org',
      txId: 'tx-001',
    });

    try {
    const statusResponse = await invokeExpress(app, {
      method: 'GET',
      url: `/host/cds-ES/v1/health-care/identity/ledger/credential/_status?id=${encodeURIComponent(credentialId)}`,
    });
      expect(statusResponse.status).toBe(200);
      const statusJson = JSON.parse(statusResponse.text);
      expect(statusJson.status).toBe('active');

    const historyResponse = await invokeExpress(app, {
      method: 'GET',
      url: `/host/cds-ES/v1/health-care/identity/ledger/credential/_history?id=${encodeURIComponent(credentialId)}`,
    });
      expect(historyResponse.status).toBe(200);
      const historyJson = JSON.parse(historyResponse.text);
      expect(historyJson.events.length).toBe(1);

      const asyncStatus = await invokeExpress(app, {
        method: 'POST',
      url: `/host/cds-ES/v1/health-care/identity/ledger/credential/_status`,
        headers: { 'content-type': 'application/json' },
        body: { id: credentialId },
      });
      expect(asyncStatus.status).toBe(202);
      const statusLocation = asyncStatus.headers.location;
      expect(statusLocation).toContain('/identity/');

      let pollStatus;
      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        pollStatus = await invokeExpress(app, { method: 'GET', url: statusLocation });
        if (pollStatus.status === 200) break;
      }
      expect(pollStatus?.status).toBe(200);

      const asyncHistory = await invokeExpress(app, {
        method: 'POST',
      url: `/host/cds-ES/v1/health-care/identity/ledger/credential/_history`,
        headers: { 'content-type': 'application/json' },
        body: { id: credentialId },
      });
      expect(asyncHistory.status).toBe(202);
      const historyLocation = asyncHistory.headers.location;
      expect(historyLocation).toContain('/identity/');

      let pollHistory;
      for (let i = 0; i < 5; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        pollHistory = await invokeExpress(app, { method: 'GET', url: historyLocation });
        if (pollHistory.status === 200) break;
      }
      expect(pollHistory?.status).toBe(200);
    } finally {
      queueAdapter.stop();
    }
  });
});
