// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/entity.ts

import { DidDocument, DidService } from 'gdc-common-utils-ts/models/did';
import { RecordBase, ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import { EntityLifecycleStatus, NetworkAccessStatus, EntityType } from './enums';


/**
 * Defines the status of an Organization on a specific network.
 */
export interface NetworkActivationStatus {
  /** The name of the network (e.g., 'test', 'test-network', 'production'). */
  networkName: string;
  status: NetworkAccessStatus;
  activationDate?: string;
  /** e.g., URL to legal-participant.vc.json or a blockchain transaction ID */
  verificationEvidence?: string;
}

/**
 * The base configuration for any entity stored in a vault (e.g., Tenant, Family, Employee).
 * It contains properties common to all managed entities.
 */
export interface EntityConfig extends RecordBase {
  type: EntityType;
  /**
   * The lifecycle status of THIS entity record itself (e.g., is the employee active or terminated).
   */
  status: EntityLifecycleStatus;
  claims: ClaimsRecord;
  didDocument?: DidDocument;
  didConfig?: {
    service: DidService[];
  };
  meta: {
    lastUpdated: string;
    /** TODO: It is a bad practice to do not have the metadata defined to avoid confusion */
    [key: string]: any;
  };
}

/**
 * Extends the base EntityConfig with properties specific to organizations
 * (both Tenants and Family Groups) that interact with networks.
 */
export interface OrganizationConfig extends EntityConfig {
  type: EntityType.Organization; // Override type for specificity
  /**
   * The organization's access status for each available network.
   */
  networkStatus: NetworkActivationStatus[];
  /**
   * Holds structured configuration for related but distinct services,
   * like API endpoint definitions or BYOD database connection strings.
   */
  provider?: {
    service?: any;
    db?: any;
    [key: string]: any;
  };
  /**
   * The self-signed Verifiable Credential for the organization (self-description.json).
   * Stored as the final JSON object.
   */
  selfDescriptionVc?: VerifiableCredentialV2;

  /**
   * The Verifiable Credential issued by an external authority (legal-participant.vc.json).
   * For the test network, this is signed by the host. For production,
   * it will be replaced with one signed by the Governing Body/ICA.
   * Stored as the final JSON object.
   */
  governanceVc?: VerifiableCredentialV2;

  /**
   * A Verifiable Presentation, which may be required for certain
   * network interactions in the future (vp.json).
   */
  verifiablePresentation?: any; // Define this type later

  /**
   * Optional legacy signing configuration for VC issuance (e.g., ES256).
   * When unset, the host-level default may apply.
   */
  legacySignAlg?: string;

  /**
   * DER-encoded X.509 certificate (Base64) for legacy signing key exposure.
   */
  legacyX509DerBase64?: string;

  /**
   * Base64-encoded X.509 chain entries (for x5c).
   */
  legacyX509ChainBase64?: string[];
}
