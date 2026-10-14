// src/routes/ledger.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { IAsyncResponseStore, StoredJob } from '../adapters/async-response-store.mem';
import { CredentialLedgerContext, ICredentialLedgerAdapter } from '../adapters/ICredentialLedgerAdapter';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import type { ILedgerTenantRegistry } from '../managers/ILedgerTenantRegistry';
import { getTenantVaultId } from '../utils/tenant';
import { resolveHostRegistrySector } from '../utils/services';
import { resolveIdentityChannel } from '../utils/ledger';

type AsyncResult = { status: number; body: unknown };

function getIdFromRequest(input: { query?: any; body?: any }): string | undefined {
  const queryId = input.query?.id;
  if (typeof queryId === 'string' && queryId.trim()) return queryId.trim();
  const bodyId = input.body?.id;
  if (typeof bodyId === 'string' && bodyId.trim()) return bodyId.trim();
  return undefined;
}

function resolveChannelName(query: Record<string, any>, jurisdiction?: string): string {
  const directChannel = typeof query.channel === 'string' ? query.channel.trim() : '';
  if (directChannel) return directChannel;
  return resolveIdentityChannel(jurisdiction);
}

function buildLedgerContext(query: Record<string, any>, jurisdiction?: string): CredentialLedgerContext {
  return { channelName: resolveChannelName(query, jurisdiction) };
}

function buildAsyncLocation(basePath: string, thid: string): string {
  return `${basePath}-response?thid=${encodeURIComponent(thid)}`;
}

async function setAsyncPending(store: IAsyncResponseStore, thid: string): Promise<void> {
  await store.set(thid, { status: 'PENDING', contentType: 'application/json' });
}

async function setAsyncResult(store: IAsyncResponseStore, thid: string, status: number, body: unknown): Promise<void> {
  const job: StoredJob = {
    status: 'COMPLETED',
    result: { status, body } satisfies AsyncResult,
    contentType: 'application/json',
  };
  await store.set(thid, job);
}

async function handleAsyncPoll(store: IAsyncResponseStore, req: any, res: any): Promise<void> {
  const thid = (req.method === 'POST' ? req.body?.thid : req.query?.thid) as string | undefined;
  if (!thid) {
    const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing or invalid "thid" parameter.');
    res.status(400).json(outcome);
    return;
  }

  const job = await store.get(thid);
  if (!job) {
    const outcome = createOperationOutcome(IssueLevel.Error, IssueType.NotFound);
    res.status(404).json(outcome);
    return;
  }

  if (job.status === 'PENDING') {
    res.set('Retry-After', '5');
    res.status(202).json({ thid, status: 'PENDING' });
    return;
  }

  const result = job.result as AsyncResult | undefined;
  if (!result) {
    const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Exception, 'Async job completed without a result.');
    res.status(500).json(outcome);
    await store.delete(thid);
    return;
  }

  res.status(result.status).json(result.body);
  await store.delete(thid);
}

export function createCredentialLedgerRouter(
  ledgerAdapter: ICredentialLedgerAdapter,
  asyncResponseStore: IAsyncResponseStore,
  tenantsCacheManager: ILedgerTenantRegistry,
  networkMode?: 'test' | 'local-network' | 'test-network' | 'network'
): Router {
  const router = Router();

  const ledgerBasePath = '/:tenantId/cds-:jurisdiction/v1/:sector/identity/ledger/credential';

  const resolveTenantContext = async (req: any) => {
    const tenantId = String(req.params.tenantId || '');
    const sector = String(req.params.sector || '');
    const vaultId = tenantId === 'host' ? 'host' : getTenantVaultId(sector, tenantId);
    const tenantExists = await tenantsCacheManager.tenantExists(vaultId);
    if (!tenantExists) return { vaultId, jurisdiction: req.params.jurisdiction, tenantExists };
    const jurisdiction = await tenantsCacheManager.getTenantJurisdiction(vaultId) || req.params.jurisdiction;
    return { vaultId, jurisdiction, tenantExists };
  };

  const resolveNetwork = () => resolveHostRegistrySector({ nodeEnv: process.env.NODE_ENV, networkMode });

  router.get(`${ledgerBasePath}/_status`, async (req, res) => {
    const id = getIdFromRequest({ query: req.query });
    if (!id) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing credential id.');
      return res.status(400).json(outcome);
    }
    const { jurisdiction, tenantExists } = await resolveTenantContext(req);
    if (!tenantExists && req.params.tenantId !== 'host') {
      return res.status(404).json(createOperationOutcome(IssueLevel.Error, IssueType.NotFound, 'Tenant not found.'));
    }
    const statusRecord = await ledgerAdapter.getCredentialStatus(
      id,
      resolveNetwork(),
      buildLedgerContext(req.query, jurisdiction)
    );
    if (!statusRecord) {
      const outcome = createOperationOutcome(IssueLevel.Information, IssueType.NotFound, 'Credential not found on ledger.');
      return res.status(404).json(outcome);
    }
    return res.json(statusRecord);
  });

  router.get(`${ledgerBasePath}/_history`, async (req, res) => {
    const id = getIdFromRequest({ query: req.query });
    if (!id) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing credential id.');
      return res.status(400).json(outcome);
    }
    const { jurisdiction, tenantExists } = await resolveTenantContext(req);
    if (!tenantExists && req.params.tenantId !== 'host') {
      return res.status(404).json(createOperationOutcome(IssueLevel.Error, IssueType.NotFound, 'Tenant not found.'));
    }
    const events = await ledgerAdapter.getCredentialHistory(
      id,
      resolveNetwork(),
      buildLedgerContext(req.query, jurisdiction)
    );
    if (!events.length) {
      const outcome = createOperationOutcome(IssueLevel.Information, IssueType.NotFound, 'Credential history not found on ledger.');
      return res.status(404).json(outcome);
    }
    return res.json({ id, events });
  });

  router.post(`${ledgerBasePath}/_status`, async (req, res) => {
    const id = getIdFromRequest({ body: req.body });
    if (!id) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing credential id.');
      return res.status(400).json(outcome);
    }

    const { jurisdiction, tenantExists } = await resolveTenantContext(req);
    if (!tenantExists && req.params.tenantId !== 'host') {
      return res.status(404).json(createOperationOutcome(IssueLevel.Error, IssueType.NotFound, 'Tenant not found.'));
    }
    const thid = randomUUID();
    const basePath = `${ledgerBasePath}/_status`;
    await setAsyncPending(asyncResponseStore, thid);
    res.set('Location', buildAsyncLocation(basePath, thid));
    res.set('Retry-After', '5');
    res.status(202).json({ thid, status: 'PENDING' });

    const ledgerContext = buildLedgerContext(req.query, jurisdiction);
    setImmediate(async () => {
      try {
        const statusRecord = await ledgerAdapter.getCredentialStatus(id, resolveNetwork(), ledgerContext);
        if (!statusRecord) {
          const outcome = createOperationOutcome(IssueLevel.Information, IssueType.NotFound, 'Credential not found on ledger.');
          await setAsyncResult(asyncResponseStore, thid, 404, outcome);
          return;
        }
        await setAsyncResult(asyncResponseStore, thid, 200, statusRecord);
      } catch (error: any) {
        const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Exception, `Ledger lookup failed: ${error?.message || 'unknown error'}`);
        await setAsyncResult(asyncResponseStore, thid, 500, outcome);
      }
    });
  });

  router.post(`${ledgerBasePath}/_history`, async (req, res) => {
    const id = getIdFromRequest({ body: req.body });
    if (!id) {
      const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Required, 'Missing credential id.');
      return res.status(400).json(outcome);
    }

    const { jurisdiction, tenantExists } = await resolveTenantContext(req);
    if (!tenantExists && req.params.tenantId !== 'host') {
      return res.status(404).json(createOperationOutcome(IssueLevel.Error, IssueType.NotFound, 'Tenant not found.'));
    }
    const thid = randomUUID();
    const basePath = `${ledgerBasePath}/_history`;
    await setAsyncPending(asyncResponseStore, thid);
    res.set('Location', buildAsyncLocation(basePath, thid));
    res.set('Retry-After', '5');
    res.status(202).json({ thid, status: 'PENDING' });

    const ledgerContext = buildLedgerContext(req.query, jurisdiction);
    setImmediate(async () => {
      try {
        const events = await ledgerAdapter.getCredentialHistory(id, resolveNetwork(), ledgerContext);
        if (!events.length) {
          const outcome = createOperationOutcome(IssueLevel.Information, IssueType.NotFound, 'Credential history not found on ledger.');
          await setAsyncResult(asyncResponseStore, thid, 404, outcome);
          return;
        }
        await setAsyncResult(asyncResponseStore, thid, 200, { id, events });
      } catch (error: any) {
        const outcome = createOperationOutcome(IssueLevel.Error, IssueType.Exception, `Ledger lookup failed: ${error?.message || 'unknown error'}`);
        await setAsyncResult(asyncResponseStore, thid, 500, outcome);
      }
    });
  });

  router.get(`${ledgerBasePath}/_status-response`, async (req, res) => {
    await handleAsyncPoll(asyncResponseStore, req, res);
  });

  router.post(`${ledgerBasePath}/_status-response`, async (req, res) => {
    await handleAsyncPoll(asyncResponseStore, req, res);
  });

  router.get(`${ledgerBasePath}/_history-response`, async (req, res) => {
    await handleAsyncPoll(asyncResponseStore, req, res);
  });

  router.post(`${ledgerBasePath}/_history-response`, async (req, res) => {
    await handleAsyncPoll(asyncResponseStore, req, res);
  });

  return router;
}
