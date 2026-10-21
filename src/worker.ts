// src/worker.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { IJobProcessor, ManagerRegistry } from './managers/registry';
import { createErrorBundle } from './utils/bundle';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { parseJobName } from './utils/naming';
import { composeHostDidWebId } from './utils/did-backend';
import { IKmsService } from './gdc-backend-utils-node/models/IKmsService';
import { getTenantVaultId } from './utils/tenant';
import { JWK } from 'gdc-common-utils-ts/models/jwk';
import { SUBJECT_SECTION_INDIVIDUAL } from './constants/domain';
import { resolveUnidWorkerManager } from './extensions/unid/worker-routing';
import { logOperationOutcomeErrors } from './observability/operation-outcome-logging';

/**
 * The Worker is the heart of the background processing logic.
 * It is a dedicated layer that acts as a Job Router and Response Encryptor,
 * decoupling the Queue Adapter from the business logic managers.
 */
export class Worker {
  private managers: ManagerRegistry;
  private apiBaseUrl: string;
  private kmsService: IKmsService;

  constructor(managers: ManagerRegistry, apiBaseUrl: string, kmsService: IKmsService) {
    this.managers = managers;
    this.apiBaseUrl = apiBaseUrl;
    this.kmsService = kmsService;
  }

  /**
   * Processes a job, gets the plaintext response from the appropriate manager,
   * and then encrypts it before returning the final artifact.
   * @returns The final, encrypted JWE response as a string.
   */
  public async process(jobName: string, job: JobRequest): Promise<string> {
    const jobInfo = parseJobName(jobName);
    try {
      if (!jobInfo) {
        throw new Error(`Invalid job name format: '${jobName}'`);
      }
      if (!job.tenantId || !job.sector) {
        throw new Error('Job is missing required tenantId or sector.');
      }
      this.assertCanonicalClaimsPlacement(job);

      const { resourceType } = jobInfo;
      // The queue name is authoritative: preserve the public ResearchSubject
      // route even though its search index is an internal Composition.
      job.resourceType = resourceType;
      let manager: IJobProcessor | undefined;

      // 1. Route to the appropriate manager based on the parsed job name
      switch (resourceType) {
        case 'Subject':
          manager = job.action === '$summary'
            ? this.managers.compositionManager
            : this.managers.subjectIdentityManager;
          break;
        case 'Patient':
          manager = job.action === '$summary'
            ? this.managers.compositionManager
            : job.action === '$match'
              ? this.managers.subjectIdentityManager
              : undefined;
          break;
        case 'ResearchSubject':
          manager = job.action === '_purge' && job.section === SUBJECT_SECTION_INDIVIDUAL
            ? this.managers.compositionManager
            : job.action === '_search' && job.section === 'digitaltwin'
            ? this.managers.twinCompositionManager || this.managers.compositionManager
            : job.action === '$summary'
            ? (job.section === 'digitaltwin'
              ? this.managers.twinCompositionManager || this.managers.compositionManager
              : this.managers.compositionManager)
            : undefined;
          break;
        case 'ResearchStudy':
          manager = this.managers.researchStudyManager;
          break;
        case 'Group':
          manager = this.managers.groupManager;
          break;
        case 'Organization':
          // Organization is overloaded:
          // - `registry/*/Organization` => host onboarding
          // - `individual/*/Organization` => family onboarding (household modeled as Organization)
          // - `organization/org.schema/Organization` => public department directory
          manager = job.section === SUBJECT_SECTION_INDIVIDUAL
            ? this.managers.familyManager
            : job.section === 'organization' && job.format === 'org.schema'
              ? this.managers.organizationDirectoryManager
              : this.managers.hostingManager;
          break;
        case 'Order':
          // Orders follow the same routing as their corresponding onboarding flow.
          manager = job.section === SUBJECT_SECTION_INDIVIDUAL ? this.managers.familyManager : this.managers.hostingManager;
          break;
        case 'Offer':
          manager = job.section === SUBJECT_SECTION_INDIVIDUAL ? this.managers.familyManager : this.managers.hostingManager;
          break;
        case 'Action':
          manager = job.section === SUBJECT_SECTION_INDIVIDUAL ? this.managers.familyManager : undefined;
          break;
        case 'Practitioner':
        case 'Employee':
          manager = this.managers.employeeManager;
          break;
        case 'Customer':
          manager = this.managers.individualManager;
          break;
        case 'Person':
          manager = job.action === '$hashed-claims-issue'
            ? this.managers.subjectIdentityManager
            : this.managers.individualManager;
          break;
        case 'Animal':
          manager = job.action === '$hashed-claims-issue'
            ? this.managers.subjectIdentityManager
            : undefined;
          break;
        case 'Composition':
          manager = job.section === 'digitaltwin'
            ? this.managers.twinCompositionManager || this.managers.compositionManager
            : this.managers.compositionManager;
          break;
        case 'Bundle':
          manager = this.managers.compositionManager;
          break;
        case 'DocumentReference':
          manager = job.section === SUBJECT_SECTION_INDIVIDUAL && job.format === 'pdf' && job.action === '_create'
            ? this.managers.familyManager
            : job.section === 'organization' && job.format === 'org.hl7.fhir.r5'
              ? this.managers.organizationDocumentReferenceManager
              : this.managers.documentReferenceManager;
          break;
        case 'Document':
          manager = job.section === 'did' && job.format === 'document'
            ? this.managers.hostingManager
            : this.managers.documentReferenceManager;
          break;
        case 'Consent':
          manager = job.section === 'organization' && job.format === 'org.hl7.fhir.r5'
            ? this.managers.researchStudyConsentManager
            : this.managers.consentManager;
          break;
        case 'Communication':
          manager = this.managers.communicationManager;
          break;
        case 'Subscription':
        case 'SubscriptionTopic':
          manager = this.managers.subscriptionManager;
          break;
        case 'Observation':
          manager = this.managers.observationManager;
          break;
        case 'MedicationStatement':
          manager = this.managers.medicationStatementManager;
          break;
        case 'Appointment':
          manager = this.managers.appointmentManager;
          break;
        case 'Location':
          manager = this.managers.locationManager;
          break;
        case 'Schedule':
          manager = this.managers.scheduleManager;
          break;
        case 'Slot':
          manager = this.managers.slotManager;
          break;
        case 'AppointmentResponse':
          manager = this.managers.appointmentResponseManager;
          break;
        case 'Encounter':
          manager = this.managers.encounterManager;
          break;
        case 'ServiceRequest':
          manager = this.managers.serviceRequestManager;
          break;
        case 'Task':
          manager = job.section === 'organization' && job.format === 'org.hl7.fhir.r5'
            ? this.managers.careTaskManager
            : this.managers.taskManager;
          break;
        case 'CommunicationRequest':
          manager = this.managers.communicationRequestManager;
          break;
        case 'HealthcareService':
          manager = this.managers.healthcareServiceManager;
          break;
        case 'Place':
          manager = this.managers.placeManager;
          break;
        case 'Service':
          manager = this.managers.serviceManager;
          break;
        case 'Product':
          manager = this.managers.productManager;
          break;
        case 'Catalog':
          manager = this.managers.catalogManager;
          break;
        case 'Dataset':
          manager = this.managers.datasetManager;
          break;
        case 'CatalogRecord':
          manager = this.managers.catalogRecordManager;
          break;
        case 'Distribution':
          manager = this.managers.distributionManager;
          break;
        case 'DataService':
          manager = this.managers.dataServiceManager;
          break;
        case 'Provenance':
          manager = this.managers.provenanceManager;
          break;
        case 'RelatedPerson':
          manager = this.managers.relatedPersonManager;
          break;
        case 'Smart':
        case 'smart':
          manager = this.managers.openIdAuthManager;
          break;
        case 'Device':
          manager = this.managers.deviceRegistrationManager;
          break;
        case 'Token':
          manager = this.managers.identityTokenManager;
          break;
        case 'License':
          manager = this.managers.licenseManager;
          break;
        case 'csr':
          manager = this.managers.icaManager;
          break;
        case 'didcomm-plaintext':
        case 'didcomm-signed':
        case 'didcomm-encrypted':
          manager = this.managers.messagingManager;
          break;
        default:
          manager = resolveUnidWorkerManager(resourceType, this.managers);
          if (!manager) {
            throw new Error(`No manager configured for resourceType '${resourceType}'`);
          }
      }

      if (!manager) {
        throw new Error(`Manager for '${resourceType}' is registered but not initialized.`);
      }

      // 2. Delegate to the manager to get the plaintext response.
      const payloadResponse = await manager.process(job);
      if (resourceType !== 'Subscription' && resourceType !== 'SubscriptionTopic') {
        await this.managers.subscriptionManager?.captureEvents(job, payloadResponse);
      }
      logOperationOutcomeErrors(payloadResponse, {
        source: 'worker_response',
        thid: job.content?.thid,
        jobName,
        resourceType,
        action: jobInfo.action,
      });

      // --- ARCHITECTURE KEEPER: UNIFIED RESPONSE ENCODING ---
      // The Worker MUST ALWAYS use `IKmsService.encodeResponse` to prepare the job result.
      // This guarantees that the AsyncResponseStore contains a consistent data type (a JWE string)
      // for the Polling Handler to process, eliminating an entire class of potential errors.
      // The `protectConfidentialData` method is strictly for long-term "at-rest" storage
      // in the main vault, not for in-transit responses like this.

      // We determine the intended recipient of the encrypted response based on the original request flow.
      const senderVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);
      let recipientJwks: JWK[];
      let responseSenderVaultId: string = senderVaultId;
      
      const isSecureFlow = String(job.contentType || '').startsWith('application/x-www-form-urlencoded');
      if (isSecureFlow && job.content?.meta?.jwe?.header?.jwk) {
        // --- FLOW A: FAPI / SECURE FLOW ---
        // The original request was a JWE and included the sender's public key (`jwk`).
        // We use that key to encrypt the response directly for them.
        recipientJwks = [job.content.meta.jwe.header.jwk];

      } else {
        // --- FLOW B: LEGACY / PLAINTEXT FLOW ---
        // The original request was unencrypted (e.g., application/json). We must still
        // encrypt the response for secure storage in the AsyncResponseStore.
        // The recipient is determined by the nature of the job.
        let recipientVaultId: string;
        if (jobInfo.resourceType === 'Organization' && job.tenantId === 'host') {
          // Special case (legacy plaintext onboarding):
          // Encrypt-to-host so the polling handler can always decrypt, even before the new tenant's keys exist.
          recipientVaultId = 'host';
          responseSenderVaultId = 'host';
        } else {
          // Default Case: An existing tenant is processing a job. Encrypt for the tenant itself.
          recipientVaultId = senderVaultId;
        }

        const encryptionKey = await this.kmsService.getPublicEncryptionKey(recipientVaultId);
        if (!encryptionKey) {
          throw new Error(`Could not retrieve public encryption key for recipient vault '${recipientVaultId}'`);
        }
        recipientJwks = [encryptionKey as JWK];
      }

      return this.kmsService.encodeResponse(payloadResponse, recipientJwks, responseSenderVaultId);
      
    } catch (error: any) {
      const errorBundle = createErrorBundle(error.message, jobInfo?.action, job.content?.body?.data?.[0]?.type);
      logOperationOutcomeErrors(errorBundle, {
        source: 'worker_exception',
        thid: job.content?.thid,
        jobName,
        resourceType: jobInfo?.resourceType,
        action: jobInfo?.action,
      });
      const errorResponse = {
        thid: job.content?.thid || 'unknown-thid',
        iss: composeHostDidWebId(this.apiBaseUrl),
        aud: job.content?.iss || 'unknown-aud',
        exp: Math.floor(Date.now() / 1000) + 300,
        body: errorBundle,
      };

      // Also attempt to encrypt error responses, ensuring the Polling Handler always
      // gets a consistent data type if possible.
      const recipientKey = job.content?.meta?.jwe?.header?.jwk;
      if (recipientKey) {
        try {
          // The issuer of a catastrophic error is always the host.
          return await this.kmsService.encodeResponse(errorResponse, [recipientKey], 'host');
        } catch {
          return JSON.stringify(errorResponse);
        }
      } else {
        // In the legacy flow, we can't be sure who to encrypt for in an error case,
        // so we must return a plaintext JSON string. The polling handler MUST handle this.
        return JSON.stringify(errorResponse);
      }
    }
  }

  /**
   * Enforces the single claims-first ingress contract.
   *
   * Business claims belong exclusively to
   * `body.data[i].resource.meta.claims` (or the equivalent Bundle `entry`).
   * Entry metadata is transport-envelope metadata and is never migrated into
   * the resource. Rejecting the obsolete placement prevents managers from
   * interpreting an unsigned or ambiguously scoped second claims source.
   */
  private assertCanonicalClaimsPlacement(job: JobRequest): void {
    const body: any = job.content?.body;
    if (!body || typeof body !== 'object') return;

    const candidates: any[] = [];
    if (Array.isArray(body.data)) candidates.push(...body.data);
    if (Array.isArray(body.entry)) candidates.push(...body.entry);
    if (candidates.length === 0) return;

    for (const item of candidates) {
      if (!item || typeof item !== 'object') continue;

      const entryClaims = item?.meta?.claims;
      const hasEntryClaims = !!entryClaims && typeof entryClaims === 'object';
      if (hasEntryClaims) {
        throw new Error('Claims must be supplied only in entry.resource.meta.claims.');
      }
    }
  }
}
