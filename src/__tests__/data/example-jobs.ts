// src/__tests__/data/example-jobs.ts

import { v4 as uuidv4 } from 'uuid';
import { JobRequest, JobStatus } from 'gdc-common-utils-ts/models/confidential-job';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DEVICE_REGISTRATION_REQUEST, ORGANIZATION_ORDER_REQUEST, ORGANIZATION_REGISTRATION_REQUEST } from './example-payloads';

/**
 * A full, canonical JobRequest object for a Device Registration job.
 * This is the object that the worker process receives.
 */
export const DCR_REGISTRATION_JOB: JobRequest = {
  id: uuidv4(),
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  content: DEVICE_REGISTRATION_REQUEST,
  sector: Sector.TEST,
  section: 'identity',
  format: 'openid',
  resourceType: 'Device',
  action: '_dcr',
  tenantId: 'test-tenant',
};

/**
 * Canonical JobRequest for a Tenant Organization registration, mirroring the
 * example payloads documented in the API Integrators Guide.
 */
export const ORGANIZATION_REGISTRATION_JOB: JobRequest = {
  id: uuidv4(),
  status: JobStatus.DRAFT,
  sequence: 0,
  createdAtTimestamp: Date.now(),
  content: ORGANIZATION_REGISTRATION_REQUEST,
  sector: Sector.TEST,
  section: 'registry',
  format: 'org.schema',
  action: '_batch',
  resourceType: 'Organization',
  tenantId: 'host',
};

/**
 * Canonical JobRequest for a Tenant Organization order confirmation, mirroring the
 * example payloads documented in the API Integrators Guide.
 */
export const ORGANIZATION_ORDER_JOB: JobRequest = {
    ...ORGANIZATION_REGISTRATION_JOB,
    resourceType: 'Order',
    content: ORGANIZATION_ORDER_REQUEST,
    requestUrl: '/host/cds-es/v1/test/registry/org.schema/Order/_batch',
};
