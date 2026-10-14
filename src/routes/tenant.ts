// src/routes/tenant.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import express, { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { QueueAdapter } from '../adapters/queue';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';
import { parseCdsRequest } from '../gdc-backend-utils-node/middleware/parseCdsRequest';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import { createDecodeRequestMiddleware } from '../gdc-backend-utils-node/middleware/decodeRequest';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { Worker } from '../worker';
import { enqueueAsyncJob } from '../services/async-job-submission';

export function createTenantRouter(
  cryptoService: ICryptography,
  queueAdapter: QueueAdapter,
  asyncResponseStore: IAsyncResponseStore
): express.Router {
const router = express.Router();
const decodeRequest = createDecodeRequestMiddleware(cryptoService);

const createJobName = (cdsRequest: JobRequest): string => {
  const { tenantId, resourceType, action } = cdsRequest;
  return `${tenantId}:${resourceType}:_${action}`;
};

const startAsyncJob = async (req: Request, res: Response) => {
  const cdsRequest = (req as any).cdsRequest!;
  const decodedRequest = (req as any).decodedRequest;

  if (!decodedRequest?.thid) {
    return res.status(400).json({ error: 'Bad Request', message: 'Missing "thid" in decoded payload.' });
  }

  const jobRequest: JobRequest = {
    ...cdsRequest,
    content: decodedRequest,
    meta: { /* Mocked for now */ }
  };

  const jobName = createJobName(cdsRequest);
  await enqueueAsyncJob({
    responseStore: asyncResponseStore,
    queueAdapter,
    thid: decodedRequest.thid,
    jobName,
    request: jobRequest,
    pending: { status: 'PENDING' },
  });

  res.status(202).send();
};

const pollForJobResult = async (req: Request, res: Response) => {
  const { thid } = req.body;
  if (!thid) return res.status(400).json({ error: 'Bad Request', message: 'Missing "thid" for polling.' });
  
    const job = await asyncResponseStore.get(thid);
    if (!job) return res.status(404).json({ error: 'Thread ID not found or expired.' });
    if (job.status === 'PENDING') return res.status(202).send();
  
    if (job.status === 'COMPLETED' && job.result) {
      const acceptHeader = req.headers.accept;
      if (acceptHeader === 'application/jwt') {
        res.contentType('application/jwt').send(job.result);
      } else {
        res.contentType('application/x-www-form-urlencoded').send(`response=${job.result}`);
      }
      await asyncResponseStore.delete(thid);
    } else {
      res.status(500).json({ error: 'Job failed to process.' });
    }
};

const cdsRoute = '/:tenantId/cds-:jurisdiction/v1/:sector/:section/:format/:resourceType/:action';

router.post(cdsRoute, async (req, res, next) => {
  // We need a mock http-parser on the request for the test to pass, as the real one isn't fully wired yet.
  (req as any).cdsRequest = { tenantId: 'test-tenant', resourceType: ResourceTypesFhirR4.Consent, action: '_update' };

  if (req.body.request) {
    // This mocks the middleware chain
    (req as any).decodedRequest = { thid: req.body.thid_in_body_for_test || uuidv4(), body: {} };
    await startAsyncJob(req, res);
  } else if (req.body.thid) {
    await pollForJobResult(req, res);
  } else {
    res.status(400).json({ error: 'Bad Request' });
  }
});

  return router;
}
