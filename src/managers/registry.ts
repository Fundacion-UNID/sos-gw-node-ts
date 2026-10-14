// src/managers/registry.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { TenantsCacheManager } from './TenantsCacheManager';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';

/**
 * Defines the standard contract for any manager that processes a job.
 */
export interface IJobProcessor {
  /**
   * The main processing method for a manager.
   * @param job The complete, authenticated, and authorized job request.
   * @returns A promise that resolves to the JARM-compliant response payload.
   */
  process(job: JobRequest): Promise<IDecodedDidcommPayload>;
}

export interface ISubscriptionProcessor extends IJobProcessor {
  captureEvents(job: JobRequest, result?: IDecodedDidcommPayload): Promise<void>;
}

/**
 * A centralized registry of all manager instances in the application.
 * This is used for dependency injection into the worker.
 * Note: Not all managers may process jobs (e.g., TenantMemManager might be synchronous).
 */
export interface ManagerRegistry {
  hostingManager: IJobProcessor;
  tenantManager: TenantsCacheManager;
  taskManager?: IJobProcessor;
  identityTokenManager?: IJobProcessor;
  observationManager?: IJobProcessor;
  medicationStatementManager?: IJobProcessor;
  appointmentManager?: IJobProcessor;
  locationManager?: IJobProcessor;
  scheduleManager?: IJobProcessor;
  slotManager?: IJobProcessor;
  appointmentResponseManager?: IJobProcessor;
  encounterManager?: IJobProcessor;
  serviceRequestManager?: IJobProcessor;
  careTaskManager?: IJobProcessor;
  communicationRequestManager?: IJobProcessor;
  healthcareServiceManager?: IJobProcessor;
  organizationDirectoryManager?: IJobProcessor;
  placeManager?: IJobProcessor;
  serviceManager?: IJobProcessor;
  productManager?: IJobProcessor;
  catalogManager?: IJobProcessor;
  datasetManager?: IJobProcessor;
  catalogRecordManager?: IJobProcessor;
  distributionManager?: IJobProcessor;
  dataServiceManager?: IJobProcessor;
  provenanceManager?: IJobProcessor;
  researchStudyManager?: IJobProcessor;
  researchStudyConsentManager?: IJobProcessor;
  groupManager?: IJobProcessor;
  relatedPersonManager?: IJobProcessor;
  familyManager?: IJobProcessor;
  employeeManager?: IJobProcessor;
  individualManager?: IJobProcessor;
  consentManager?: IJobProcessor;
  compositionManager?: IJobProcessor;
  twinCompositionManager?: IJobProcessor;
  documentReferenceManager?: IJobProcessor;
  communicationManager?: IJobProcessor;
  subscriptionManager?: ISubscriptionProcessor;
  deviceRegistrationManager?: IJobProcessor;
  licenseManager?: IJobProcessor;
  openIdAuthManager?: IJobProcessor;
  icaManager?: IJobProcessor;
  messagingManager?: IJobProcessor;
  subjectIdentityManager?: IJobProcessor;
  // listManager?: IJobProcessor;
}
