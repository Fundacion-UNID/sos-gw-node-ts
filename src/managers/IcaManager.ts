// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/managers/IcaManager.ts
import { GatewayInternalResourceTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { GatewayResponseEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import https from 'https';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { BundleJsonApi, BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { createOperationOutcome } from '../utils/outcome';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { bufferToPem } from '../utils/pki';
import { getEnvSectionId } from '../utils/section-env';

type EnrollRequestBody = {
  csr?: string;
  organization?: any;
  evidence?: any[];
  metadata?: Record<string, any>;
};

type EnrollResponse = {
  status: 'approved' | 'pending' | 'rejected';
  certificate?: string;
  chain?: string[];
  caName?: string;
  message?: string;
};

type MtlsSecret = {
  certPem?: string;
  keyPem?: string;
  caPem?: string;
};

function readPem(envValue?: string, envFile?: string): string | undefined {
  if (envFile) {
    try {
      return fs.readFileSync(envFile, 'utf8');
    } catch {
      return undefined;
    }
  }
  return envValue;
}

export class IcaManager {
  private vaultRepository?: IVaultRepository;
  private kmsService?: IKmsService;

  constructor(vaultRepository?: IVaultRepository, kmsService?: IKmsService) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
  }

  private async loadMtlsFromVault(): Promise<MtlsSecret | undefined> {
    if (!this.vaultRepository || !this.kmsService) return undefined;
    const doc = await this.vaultRepository.get<ConfidentialStorageDoc>('host', 'ica-mtls', getEnvSectionId('pki'));
    if (!doc) return undefined;
    const decrypted = await this.kmsService.unprotectConfidentialData<any>(doc, 'host');
    return decrypted?.content as MtlsSecret | undefined;
  }

  private async deriveMtlsFromLegacyKeys(): Promise<MtlsSecret | undefined> {
    if (!this.vaultRepository || !this.kmsService) return undefined;
    const hostDoc = await this.vaultRepository.get<ConfidentialStorageDoc>('host', 'host', getEnvSectionId('tenants'));
    if (!hostDoc) return undefined;
    const decrypted = await this.kmsService.unprotectConfidentialData<any>(hostDoc, 'host');
    const legacyDer = decrypted?.content?.legacyX509DerBase64 as string | undefined;
    if (!legacyDer) return undefined;
    const keyPem = await this.kmsService.getLegacyPrivateKeyPem?.('host');
    if (!keyPem) return undefined;
    const certPem = bufferToPem(Buffer.from(legacyDer, 'base64'), 'CERTIFICATE');
    return { certPem, keyPem };
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const issuerDid = job.content?.iss || 'did:web:ica.local';

    try {
      const body = (job.content?.body || {}) as EnrollRequestBody;
      const csr = body.csr;
      if (!csr) {
        throw new ManagerError('Missing CSR in request body.', IssueType.Required);
      }

      const autoApprove = String(process.env.ICA_AUTO_APPROVE || '').toLowerCase() === 'true';
      const enrollUrl = process.env.ICA_FABRIC_CA_ENROLL_URL;
      const enrollAuth = process.env.ICA_FABRIC_CA_AUTH;
      const caName = process.env.ICA_FABRIC_CA_NAME;
      const profile = process.env.ICA_FABRIC_CA_PROFILE;
      const label = process.env.ICA_FABRIC_CA_LABEL;

      let responsePayload: EnrollResponse = { status: 'pending' };

      const isDemo = String(process.env.NODE_ENV || '').toLowerCase() === 'demo';
      if (autoApprove && !enrollUrl && !isDemo) {
        throw new ManagerError('ICA_FABRIC_CA_ENROLL_URL is required when ICA_AUTO_APPROVE=true.', IssueType.Required);
      }

      if (autoApprove && enrollUrl) {
        const mtlsFromVault = await this.loadMtlsFromVault();
        const mtlsFromLegacy = mtlsFromVault ? undefined : await this.deriveMtlsFromLegacyKeys();
        const mtlsCert = mtlsFromVault?.certPem
          || mtlsFromLegacy?.certPem
          || readPem(process.env.ICA_MTLS_CERT_PEM, process.env.ICA_MTLS_CERT_FILE);
        const mtlsKey = mtlsFromVault?.keyPem
          || mtlsFromLegacy?.keyPem
          || readPem(process.env.ICA_MTLS_KEY_PEM, process.env.ICA_MTLS_KEY_FILE);
        const mtlsCa = mtlsFromVault?.caPem || readPem(process.env.ICA_MTLS_CA_PEM, process.env.ICA_MTLS_CA_FILE);
        const agent = (mtlsCert && mtlsKey)
          ? new https.Agent({ cert: mtlsCert, key: mtlsKey, ca: mtlsCa || undefined })
          : undefined;

        const enrollBody: Record<string, any> = { certificate_request: csr };
        if (caName) enrollBody.caName = caName;
        if (profile) enrollBody.profile = profile;
        if (label) enrollBody.label = label;

        const res = await fetch(enrollUrl, {
          method: HttpRequestMethods.Post,
          headers: {
            'content-type': 'application/json',
            ...(enrollAuth ? { authorization: enrollAuth } : {}),
          },
          ...(agent ? { agent } : {}),
          body: JSON.stringify(enrollBody),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new ManagerError(`Fabric-CA enroll failed: ${res.status} ${text}`, IssueType.Exception);
        }
        const enrollResult = await res.json();
        responsePayload = {
          status: 'approved',
          certificate: enrollResult?.result?.Cert || enrollResult?.cert || enrollResult?.certificate,
          chain: enrollResult?.result?.Chain || enrollResult?.chain,
          caName: enrollResult?.result?.CAName || enrollResult?.caName || caName,
        };
      } else if (autoApprove && isDemo) {
        responsePayload = {
          status: 'approved',
          message: 'Demo mode: ICA auto-approved without Fabric-CA.',
        };
      }

      const entry: BundleEntry = {
        type: GatewayResponseEntryTypes.IcaEnroll,
        response: { status: responsePayload.status === 'approved' ? '201' : '202' },
        resource: {
          resourceType: GatewayInternalResourceTypes.IcaEnrollmentResult,
          ...responsePayload,
        },
      };

      const responseBundle: BundleJsonApi = {
        data: [entry],
        resourceType: ResourceTypesFhirR4.Bundle,
        type: getBundleResponseTypeForAction(job.action),
        total: 1,
      };

      return {
        jti: uuidv4(),
        type: 'ica-enroll-response',
        thid: job.content?.thid as string,
        iss: issuerDid,
        aud: job.content?.iss as string,
        exp: Math.floor(Date.now() / 1000) + 300,
        body: responseBundle,
      };
    } catch (error: any) {
      const errorEntry: ErrorEntry = {
        type: GatewayResponseEntryTypes.IcaEnroll,
        response: {
          status: error?.status || '500',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            error?.code || IssueType.Exception,
            error?.message || 'ICA enroll failed',
          ),
        },
      };
      const responseBundle: BundleJsonApi = {
        data: [errorEntry],
        resourceType: ResourceTypesFhirR4.Bundle,
        type: getBundleResponseTypeForAction(job.action),
        total: 1,
      };
      return {
        jti: uuidv4(),
        type: 'ica-enroll-response',
        thid: job.content?.thid as string,
        iss: issuerDid,
        aud: job.content?.iss as string,
        exp: Math.floor(Date.now() / 1000) + 300,
        body: responseBundle,
      };
    }
  }
}
