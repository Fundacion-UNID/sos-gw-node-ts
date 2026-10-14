/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { ALLOWED_STATUS } = require("./constants");
const { getTxTimestampSeconds } = require("./history");
const OPAQUE_LINK_PATTERN = /^(?:z[1-9A-HJ-NP-Za-km-z]+|b[a-z2-7]+)$/;

function parseJson(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed;
}

function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked, expired`);
  }
}

function assertOptionalOpaqueLink(value, field) {
  if (value !== undefined && value !== null && value !== ""
    && !OPAQUE_LINK_PATTERN.test(String(value))) {
    throw new Error(`${field} must be an opaque multibase or CID value`);
  }
}

function readMetaAttributes(assetOrPayload) {
  const metaAttributes = assetOrPayload?.meta?.attributes;
  if (metaAttributes && typeof metaAttributes === "object" && !Array.isArray(metaAttributes)) {
    return metaAttributes;
  }
  const legacyMetadata = assetOrPayload?.metadata;
  if (legacyMetadata && typeof legacyMetadata === "object" && !Array.isArray(legacyMetadata)) {
    return legacyMetadata;
  }
  return {};
}

function buildAudit(ctx, previousAudit, status, isCreate) {
  const txTime = getTxTimestampSeconds(ctx.stub);
  const txId = ctx.stub.getTxID();
  return {
    createdAt: isCreate ? txTime : Number(previousAudit?.createdAt || txTime),
    updatedAt: txTime,
    txId,
    txTime,
    status,
    version: isCreate ? 1 : (Number(previousAudit?.version) || 1) + 1,
  };
}

module.exports = {
  assertOptionalOpaqueLink,
  assertStatus,
  buildAudit,
  parseJson,
  readMetaAttributes,
};
