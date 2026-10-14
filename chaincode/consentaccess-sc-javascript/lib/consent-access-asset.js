/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const {
  ALLOWED_CLAIM_KEYS,
  ALLOWED_STATUS,
  ALLOWED_TOP_LEVEL_TYPES,
  CONSENT_ACCESS_ASSET_TYPE,
  CONSENT_ACCESS_CLAIMS,
  DEFAULT_FHIR_CLAIMS_CONTEXT,
  DEFAULT_RESOURCE_TYPE,
} = require("./constants");
const {
  buildStoredPrimaryDocumentAsset,
  sanitizePrimaryDocument,
  sanitizePrimaryDocumentEntry,
  sanitizeReference,
} = require("./primary-document-asset");

/**
 * Validates that the asset lifecycle status belongs to the explicit allowlist.
 *
 * @param {string} status
 * @returns {void}
 */
function assertAllowedStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid status ${status}. Allowed: active, revoked`);
  }
}

/**
 * Keeps only the consent claims that are allowed to survive blockchain
 * persistence.
 *
 * This function is the consent-specific part. The rest of the primary-document
 * sanitization flow is intentionally generic and lives in
 * `primary-document-asset.js`.
 *
 * @param {Record<string, unknown>|unknown} claims
 * @returns {Record<string, unknown>}
 */
function sanitizeClaims(claims) {
  const input = claims && typeof claims === "object" ? claims : {};
  const sanitized = {};

  for (const key of ALLOWED_CLAIM_KEYS) {
    const rawValue = input[key];
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      continue;
    }
    if (key === CONSENT_ACCESS_CLAIMS.EventBasedOn || key === CONSENT_ACCESS_CLAIMS.SourceReference) {
      const sanitizedReference = sanitizeReference(rawValue);
      if (sanitizedReference) {
        sanitized[key] = sanitizedReference;
      }
      continue;
    }
    sanitized[key] = rawValue;
  }

  if (!sanitized[CONSENT_ACCESS_CLAIMS.Context]) {
    sanitized[CONSENT_ACCESS_CLAIMS.Context] = DEFAULT_FHIR_CLAIMS_CONTEXT;
  }
  if (!sanitized[CONSENT_ACCESS_CLAIMS.Action]) {
    throw new Error(`${CONSENT_ACCESS_CLAIMS.Action} is required`);
  }

  return sanitized;
}

/**
 * Shared configuration for the generic primary-document helpers.
 *
 * Declaring it once makes the contract easier to read and makes the boundary
 * between generic logic and consent-specific logic explicit.
 */
const CONSENT_ACCESS_PRIMARY_DOCUMENT_CONFIG = Object.freeze({
  assetType: CONSENT_ACCESS_ASSET_TYPE,
  allowedTopLevelTypes: ALLOWED_TOP_LEVEL_TYPES,
  assertAllowedStatus,
  defaultResourceType: DEFAULT_RESOURCE_TYPE,
  sanitizeClaims,
});

/**
 * Sanitizes one consent access primary-document entry.
 *
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown>}
 */
function sanitizeConsentAccessEntry(entry) {
  return sanitizePrimaryDocumentEntry(entry, CONSENT_ACCESS_PRIMARY_DOCUMENT_CONFIG);
}

/**
 * Sanitizes one consent access primary document with mandatory `data[]`.
 *
 * @param {Record<string, unknown>} payload
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizeConsentAccessPrimaryDocument(payload) {
  return sanitizePrimaryDocument(payload, CONSENT_ACCESS_PRIMARY_DOCUMENT_CONFIG);
}

/**
 * Builds the final consent access asset that the smart contract persists.
 *
 * @param {import("fabric-contract-api").Context} ctx
 * @param {string} assetId
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>|undefined} previousAsset
 * @returns {Record<string, unknown>}
 */
function buildStoredAsset(ctx, assetId, payload, previousAsset) {
  return buildStoredPrimaryDocumentAsset(
    ctx,
    assetId,
    payload,
    previousAsset,
    CONSENT_ACCESS_PRIMARY_DOCUMENT_CONFIG,
  );
}

module.exports = {
  assertAllowedStatus,
  buildStoredAsset,
  sanitizeConsentAccessEntry,
  sanitizeConsentAccessPrimaryDocument,
  sanitizeClaims,
  sanitizeReference,
};
