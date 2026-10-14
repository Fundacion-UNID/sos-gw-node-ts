// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/config.ts

import { Sector } from "gdc-common-utils-ts/models/urlPath";

/**
 * Defines the shape of the application's configuration object.
 * This interface is exported so that different components can use it as a type
 * for dependency injection, without needing to know where the configuration comes from.
 */
export interface IServerConfig {
  securityMode: 'strict' | 'compat' | 'demo';
  networkMode: 'test' | 'local-network' | 'test-network' | 'network';
  fhirLegacy: boolean;
  jsonLegacy: boolean;
  didcommPlainEnabled: boolean;
  didcommPlaintextLegacyMediaTypeEnabled?: boolean;
  demoAllowInsecureBearer: boolean;
  nodeEnv: string;
  port: number;
  maxHeaderSize: number;
  apiHostname: string;
  hostExternalDomain: string;
  apiBaseUrl: string;
  namespace: string;
  ica?: {
    mode?: 'internal' | 'external';
    internalUrl?: string;
    externalUrl?: string;
    jurisdiction?: string;
    didWeb?: string;
    tlsCaPem?: string;
  };
  ledger?: {
    enabled?: boolean;
    mspId?: string;
    channelName?: string;
    chaincodeName?: string;
    schemaUrl?: string;
  };
  sectorsAllowed: Sector[];
  allowedPaymentMethods: string[];
  dbProvider: string;
  storageProvider: string;
  queueProvider: string;
  postgres?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
    ssl?: boolean;
    schema?: string;
    maxPoolSize?: number;
  };
  /** UNID extension configuration for task reminders. */
  tasksCore?: {
    enabled: boolean;
    apiEnabled: boolean;
    workerEnabled: boolean;
    fhirEnabled: boolean;
    csvEnabled: boolean;
    defaultChannels: string[];
    autoCloseMinutes: number;
    confirmationRequiredDefault: boolean;
  };
  /** UNID extension configuration for the UHC telephony adapters. */
  uhcTelephony?: {
    provider: 'twilio' | 'mock';
    smsEnabled: boolean;
    voiceEnabled: boolean;
    verifyEnabled: boolean;
    maxAttempts: number;
    retryIntervalMinutes: number;
    autoRescheduleOnNoResponse: boolean;
    escalationDelayMinutes: number;
    reminderDebugApiEnabled: boolean;
    reminderConsoleLogsEnabled: boolean;
    reminderDaemonEnabled: boolean;
    reminderDaemonPollSeconds: number;
    groupWindowMinutes: number;
    defaultLocale: string;
    defaultTtsVoice?: string;
    twilio?: {
      accountSid?: string;
      authToken?: string;
      apiKeySid?: string;
      apiKeySecret?: string;
      messagingServiceSid?: string;
      voiceFromNumber?: string;
      voiceFlowSid?: string;
      verifyServiceSid?: string;
      webhookSignatureValidation: boolean;
    };
  };
  /**
   * Separate configuration block for the planned research/digital twin store.
   *
   * Key ideas:
   * - This is not the main operational tenant vault.
   * - `enabled=false` means "ignore all research-store wiring for now".
   * - `separateDb=true` means operators must provide dedicated
   *   `RESEARCH_STORE_POSTGRES_*` settings instead of implicitly reusing the
   *   main `POSTGRES_*` connection.
   *
   * The following fields are intentionally explicit because they are easy to
   * misunderstand:
   * - `indexPrefix`:
   *   Human-chosen prefix used by future research-store tables/indexes so they
   *   are easy to recognize and avoid collisions with other schemas or
   *   deployments. Example: `rtwin`.
   * - `defaultLocale`:
   *   Fallback locale for normalized text indexing when an incoming artifact
   *   does not declare one. This does not translate text; it only tells the
   *   indexer which locale to assume for tokenization/search defaults.
   *   Example: `es` or `en`.
   * - `textSearchMode`:
   *   Planned text search strategy for normalized human-readable claims.
   *   `postgres-simple` is the safer initial option. `postgres-tsvector`
   *   implies a more PostgreSQL-native full-text indexing strategy.
   * - `codeIndexMode`:
   *   Planned code-index extraction strategy. The initial supported value,
   *   `normalized-claims-v1`, means "extract deterministic code rows from the
   *   allowlisted canonical claims model", for example `SYSTEM|CODE` values.
   */
  researchStore?: {
    enabled: boolean;
    provider?: 'postgres' | 'supabase' | 'firestore';
    separateDb: boolean;
    indexPrefix?: string;
    defaultLocale?: string;
    textSearchMode?: 'postgres-simple' | 'postgres-tsvector';
    codeIndexMode?: 'normalized-claims-v1';
    postgres?: {
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      password?: string;
      ssl?: boolean;
      schema?: string;
    };
  };
  gcsBucketName?: string;
  supabase?: {
    url?: string;
    serviceRoleKey?: string;
    storageBucket?: string;
    storagePublic?: boolean;
  };
  ipfs?: {
    apiUrl?: string;
    gatewayUrl?: string;
    mfsRoot?: string;
  };
  /** @deprecated Use `kms.provider`. */
  envelope?: {
    provider?: 'memory' | 'local' | 'gcp-kms' | 'hashicorp-transit';
  };
  kekSecret?: string;
  kms?: {
    provider?: 'memory' | 'local' | 'gcp' | 'aws' | 'hashicorp-transit';
    region?: string;
    keyId?: string;
    runtimeKekCiphertext?: string;
    runtimeKekId?: string;
  };
  /** @deprecated Use the provider-neutral `kms` configuration. */
  gcpKms?: {
    keyName?: string;
    runtimeKekCiphertext?: string;
    runtimeKekId?: string;
  };
  hashicorpTransit?: {
    baseUrl?: string;
    mountPath?: string;
    keyName?: string;
    token?: string;
    namespace?: string;
  };
  host: {
    legalName?: string;
    jurisdiction?: string;
    coverageScope?: string;
    idType?: string;
    idValue?: string;
    adminEmail?: string;
    adminUid?: string;
    adminRole?: string;
  };
  mongo: {
    uri?: string;
    dbName: string;
  };
  firebase: {
    projectId?: string;
    clientEmail?: string;
    privateKey?: string;
  };
  googleClientId?: string;
  legacySignAlg?: string;
  legacyX509DerBase64?: string;
  legacyX509ChainBase64?: string[];
  localServiceRoles?: string[];
}
