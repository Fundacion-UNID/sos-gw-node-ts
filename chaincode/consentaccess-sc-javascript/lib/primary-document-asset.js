/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { createHash } = require("crypto");

const { CONTENT_ADDRESSED_REFERENCE_PATTERN, HASH_PREFIX } = require("./constants");
const { getTxTimestampSeconds } = require("./history");

/**
 * Sanitizes one reference before it is allowed into the persisted asset.
 *
 * Shared rule:
 * - `z...` references pass through
 * - blank or falsy values disappear
 * - everything else is hashed with SHA3-384
 *
 * @param {unknown} value
 * @returns {string|undefined}
 */
function sanitizeReference(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return undefined;
  if (CONTENT_ADDRESSED_REFERENCE_PATTERN.test(normalized)) return normalized;
  return `${HASH_PREFIX}${createHash("sha3-384").update(normalized, "utf8").digest("hex")}`;
}

/**
 * Validates and sanitizes one primary-document entry.
 *
 * @param {Record<string, unknown>} entry
 * @param {object} config
 * @param {Set<string>} config.allowedTopLevelTypes
 * @param {string} config.defaultResourceType
 * @param {(claims: Record<string, unknown>|unknown) => Record<string, unknown>} config.sanitizeClaims
 * @returns {Record<string, unknown>}
 */
function sanitizePrimaryDocumentEntry(entry, config) {
  if (!entry || typeof entry !== "object") {
    throw new Error("Each data entry must be an object");
  }
  if (!entry.id) {
    throw new Error("Each data entry must have an id");
  }
  if (!entry.type) {
    throw new Error(`Entry ${entry.id} must have a type`);
  }
  if (!config.allowedTopLevelTypes.has(String(entry.type))) {
    throw new Error(`Entry ${entry.id} has unsupported type ${entry.type}`);
  }

  const resource = entry.resource;
  if (!resource || typeof resource !== "object") {
    throw new Error(`Entry ${entry.id} must have a resource object`);
  }

  return {
    id: String(entry.id),
    type: String(entry.type),
    resource: {
      resourceType: resource.resourceType || config.defaultResourceType,
      meta: {
        claims: config.sanitizeClaims(resource.meta && resource.meta.claims),
      },
    },
  };
}

/**
 * Sanitizes one JSON:API-like primary document with mandatory `data[]`.
 *
 * @param {Record<string, unknown>} payload
 * @param {object} config
 * @param {Set<string>} config.allowedTopLevelTypes
 * @param {string} config.defaultResourceType
 * @param {(claims: Record<string, unknown>|unknown) => Record<string, unknown>} config.sanitizeClaims
 * @returns {Array<Record<string, unknown>>}
 */
function sanitizePrimaryDocument(payload, config) {
  if (!payload || typeof payload !== "object") {
    throw new Error("payload must be an object");
  }
  if (!Array.isArray(payload.data) || payload.data.length === 0) {
    throw new Error("payload.data must be a non-empty array");
  }
  return payload.data.map((entry) => sanitizePrimaryDocumentEntry(entry, config));
}

/**
 * Creates deterministic audit metadata for the current write operation.
 *
 * @param {import("fabric-contract-api").Context} ctx
 * @param {Record<string, unknown>} existingAudit
 * @param {string} status
 * @param {boolean} isCreate
 * @returns {Record<string, unknown>}
 */
function buildAudit(ctx, existingAudit, status, isCreate) {
  const txTime = getTxTimestampSeconds(ctx.stub);
  const txId = ctx.stub.getTxID();

  return {
    createdAt: isCreate ? txTime : existingAudit.createdAt,
    updatedAt: txTime,
    txId,
    txTime,
    status,
    version: isCreate ? 1 : (Number(existingAudit.version) || 1) + 1,
  };
}

/**
 * Builds a blockchain asset that persists one sanitized primary document plus
 * on-chain audit metadata.
 *
 * @param {import("fabric-contract-api").Context} ctx
 * @param {string} assetId
 * @param {Record<string, unknown>} payload
 * @param {Record<string, unknown>|undefined} previousAsset
 * @param {object} config
 * @param {string} config.assetType
 * @param {(status: string) => void} config.assertAllowedStatus
 * @param {Set<string>} config.allowedTopLevelTypes
 * @param {string} config.defaultResourceType
 * @param {(claims: Record<string, unknown>|unknown) => Record<string, unknown>} config.sanitizeClaims
 * @returns {Record<string, unknown>}
 */
function buildStoredPrimaryDocumentAsset(ctx, assetId, payload, previousAsset, config) {
  const status = String(payload.status || previousAsset?.meta?.audit?.status || "active");
  config.assertAllowedStatus(status);

  return {
    id: assetId,
    type: config.assetType,
    data: sanitizePrimaryDocument(payload, config),
    meta: {
      audit: buildAudit(ctx, previousAsset?.meta?.audit || {}, status, !previousAsset),
    },
  };
}

module.exports = {
  buildAudit,
  buildStoredPrimaryDocumentAsset,
  sanitizePrimaryDocument,
  sanitizePrimaryDocumentEntry,
  sanitizeReference,
};
