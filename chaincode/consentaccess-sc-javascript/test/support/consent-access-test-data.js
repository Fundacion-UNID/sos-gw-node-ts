/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { createHash } = require("crypto");
const {
  CONSENT_ACCESS_ASSET_TYPE,
  CONSENT_ACCESS_CLAIMS,
  DEFAULT_FHIR_CLAIMS_CONTEXT,
  DEFAULT_RESOURCE_TYPE,
  HASH_PREFIX,
} = require("../../lib/constants");

/**
 * Shared identifiers reused across all contract scenarios.
 */
const TEST_IDENTIFIERS = Object.freeze({
  AssetId: "zConsentAccessBundle001",
  RuleId: "zConsentRule001",
  ExistingTransactionId: "TX-OLD",
  NewTransactionId: "TX-001",
  AliasTransactionId: "TX-002",
  UpdateTransactionId: "TX-NEW",
  StatusTransitionTransactionId: "TX-300",
  VersionFallbackTransactionId: "TX-350",
  UpsertTransactionId: "TX-500",
  PreviousUpsertTransactionId: "TX-PREV",
});

/**
 * Shared timestamps used in deterministic audit assertions.
 */
const TEST_TIMESTAMPS = Object.freeze({
  Create: 1713378604,
  CreateAlias: 1713378605,
  Update: 200,
  StatusTransition: 300,
  VersionFallback: 350,
  UpsertChanged: 500,
  PreviousCreatedAt: 100,
  PreviousUpdatedAt: 100,
  PreviousWithoutVersionCreatedAt: 150,
  PreviousWithoutVersionUpdatedAt: 150,
  NoOpPreviousCreatedAt: 10,
  NoOpPreviousUpdatedAt: 20,
});

/**
 * Canonical references reused in claim sanitization scenarios.
 */
const TEST_REFERENCES = Object.freeze({
  ContentAddressed: "zQmWvM9dQmWvM9dQmWvM9dQmWvM9dQmWvM9dQmWvM9dQmWv",
  Url: "https://example.org/evidence/consent.pdf",
  Empty: "   ",
  NumericZero: 0,
});

/**
 * Claim values used by the default example rule.
 */
const TEST_RULE_VALUES = Object.freeze({
  DefaultAction: "LOINC|48765-2",
  AlternativeAction: "LOINC|10160-0",
  BlankReferenceAction: "LOINC|11450-4",
  ZeroReferenceAction: "LOINC|30954-2",
  ActorRole: "ISCO-08|2211",
  HiddenIdentifier: "urn:uuid:should-not-be-stored",
  HiddenIdentifierSecondary: "urn:uuid:hidden",
  UnsupportedEntryType: "BadType",
  RevokedStatus: "revoked",
  InvalidStatus: "expired",
});

/**
 * Deterministically hashes a plain reference exactly like the contract.
 *
 * @param {string} value
 * @returns {string}
 */
function hashReference(value) {
  return `${HASH_PREFIX}${createHash("sha3-384").update(value, "utf8").digest("hex")}`;
}

/**
 * Builds one claims object that mirrors the preferred frontend/backend input.
 *
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, unknown>}
 */
function buildRuleClaims(overrides = {}) {
  return {
    [CONSENT_ACCESS_CLAIMS.Context]: DEFAULT_FHIR_CLAIMS_CONTEXT,
    [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.DefaultAction,
    [CONSENT_ACCESS_CLAIMS.ActorRole]: TEST_RULE_VALUES.ActorRole,
    [CONSENT_ACCESS_CLAIMS.EventBasedOn]: TEST_REFERENCES.ContentAddressed,
    [CONSENT_ACCESS_CLAIMS.SourceReference]: TEST_REFERENCES.Url,
    "Consent.identifier": TEST_RULE_VALUES.HiddenIdentifier,
    ...overrides,
  };
}

/**
 * Builds one primary-document entry.
 *
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, unknown>}
 */
function buildRuleEntry(overrides = {}) {
  return {
    id: TEST_IDENTIFIERS.RuleId,
    type: "ConsentAccessRule",
    resource: {
      resourceType: DEFAULT_RESOURCE_TYPE,
      meta: {
        claims: buildRuleClaims(),
      },
    },
    ...overrides,
  };
}

/**
 * Builds one input payload with mandatory `data[]`.
 *
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, unknown>}
 */
function buildPrimaryDocumentPayload(overrides = {}) {
  return {
    data: [buildRuleEntry()],
    ...overrides,
  };
}

/**
 * Builds an expected audit object for assertions.
 *
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, unknown>}
 */
function buildExpectedAudit(overrides = {}) {
  return {
    createdAt: TEST_TIMESTAMPS.Create,
    updatedAt: TEST_TIMESTAMPS.Create,
    txId: TEST_IDENTIFIERS.NewTransactionId,
    txTime: TEST_TIMESTAMPS.Create,
    status: "active",
    version: 1,
    ...overrides,
  };
}

/**
 * Builds the persisted blockchain asset that the contract should write.
 *
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, unknown>}
 */
function buildStoredConsentAccessAsset(overrides = {}) {
  return {
    id: TEST_IDENTIFIERS.AssetId,
    type: CONSENT_ACCESS_ASSET_TYPE,
    data: [
      {
        id: TEST_IDENTIFIERS.RuleId,
        type: "ConsentAccessRule",
        resource: {
          resourceType: DEFAULT_RESOURCE_TYPE,
          meta: {
            claims: {
              [CONSENT_ACCESS_CLAIMS.Context]: DEFAULT_FHIR_CLAIMS_CONTEXT,
              [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.DefaultAction,
              [CONSENT_ACCESS_CLAIMS.ActorRole]: TEST_RULE_VALUES.ActorRole,
              [CONSENT_ACCESS_CLAIMS.EventBasedOn]: TEST_REFERENCES.ContentAddressed,
              [CONSENT_ACCESS_CLAIMS.SourceReference]: hashReference(TEST_REFERENCES.Url),
            },
          },
        },
      },
    ],
    meta: {
      audit: buildExpectedAudit(),
    },
    ...overrides,
  };
}

module.exports = {
  buildExpectedAudit,
  buildPrimaryDocumentPayload,
  buildRuleClaims,
  buildRuleEntry,
  buildStoredConsentAccessAsset,
  hashReference,
  TEST_IDENTIFIERS,
  TEST_REFERENCES,
  TEST_RULE_VALUES,
  TEST_TIMESTAMPS,
};
