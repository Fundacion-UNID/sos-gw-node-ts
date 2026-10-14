/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Canonical asset label persisted by the consent access smart contract.
 */
const CONSENT_ACCESS_ASSET_TYPE = "ConsentAccessBundle";

/**
 * Primary-document entry types accepted by the contract.
 *
 * `ConsentAccessRule` is the preferred blockchain projection type. Plain
 * `Consent` is accepted for compatibility with callers that still emit the
 * original FHIR resource label.
 */
const ALLOWED_TOP_LEVEL_TYPES = new Set(["ConsentAccessRule", "Consent"]);

/**
 * Asset lifecycle values intentionally supported by this contract.
 */
const ALLOWED_STATUS = new Set(["active", "revoked"]);

/**
 * Claims that are allowed to survive blockchain persistence.
 */
const ALLOWED_CLAIM_KEYS = Object.freeze([
  "@context",
  "Consent.action",
  "Consent.actor-role",
  "Consent.event-basedon",
  "Consent.source-reference",
]);

/**
 * Shared claim names used by the contract and tests.
 */
const CONSENT_ACCESS_CLAIMS = Object.freeze({
  Context: "@context",
  Action: "Consent.action",
  ActorRole: "Consent.actor-role",
  EventBasedOn: "Consent.event-basedon",
  SourceReference: "Consent.source-reference",
});

/**
 * Default JSON-LD context emitted when callers omit it.
 */
const DEFAULT_FHIR_CLAIMS_CONTEXT = "org.hl7.fhir.api";

/**
 * Resource type expected in the blockchain projection.
 */
const DEFAULT_RESOURCE_TYPE = "Consent";

/**
 * Shared multibase rule used by the contract.
 */
const CONTENT_ADDRESSED_REFERENCE_PATTERN = /^z[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Prefix used when plain references are hashed before persistence.
 */
const HASH_PREFIX = "sha3-384:";

module.exports = {
  ALLOWED_CLAIM_KEYS,
  ALLOWED_STATUS,
  ALLOWED_TOP_LEVEL_TYPES,
  CONSENT_ACCESS_ASSET_TYPE,
  CONSENT_ACCESS_CLAIMS,
  CONTENT_ADDRESSED_REFERENCE_PATTERN,
  DEFAULT_FHIR_CLAIMS_CONTEXT,
  DEFAULT_RESOURCE_TYPE,
  HASH_PREFIX,
};
