/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { ALLOWED_STATUS } = require("./constants");
const { getTxTimestampSeconds } = require("./history");

function parseJson(input, label) {
  if (!input) throw new Error(`${label} is required`);
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be an object`);
  }
  return parsed;
}

function parseJsonArray(input, label) {
  if (!input) throw new Error(`${label} is required`);
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked, expired`);
  }
}

function resolveKeyId(orgId, payload) {
  if (payload.keyId) return payload.keyId;
  if (payload.kid) return `${orgId}_${payload.kid}`;
  if (payload.thumbprint) return `${orgId}_${payload.thumbprint}`;
  throw new Error("keyId, kid, or thumbprint is required");
}

function buildAudit(ctx, previousAudit, status, isCreate) {
  const txTime = getTxTimestampSeconds(ctx.stub);
  return {
    createdAt: isCreate ? txTime : Number(previousAudit?.createdAt || txTime),
    updatedAt: txTime,
    txId: ctx.stub.getTxID(),
    txTime,
    status,
    version: isCreate ? 1 : (Number(previousAudit?.version) || 1) + 1,
  };
}

module.exports = { assertStatus, buildAudit, parseJson, parseJsonArray, resolveKeyId };
