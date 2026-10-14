/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
const { ALLOWED_STATUS } = require("./constants");
const { getTxTimestampSeconds } = require("./history");
function parseJson(input, label) {
  if (!input) throw new Error(`${label} is required`);
  const value = JSON.parse(input);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}
function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) throw new Error(`Invalid status ${status}. Allowed: active, suspended, revoked`);
}
function buildAudit(ctx, previous, status, create) {
  const now = getTxTimestampSeconds(ctx.stub);
  return {
    createdAt: create ? now : Number(previous?.createdAt || now),
    updatedAt: now,
    txId: ctx.stub.getTxID(),
    txTime: now,
    status,
    version: create ? 1 : (Number(previous?.version) || 1) + 1,
  };
}
module.exports = { assertStatus, buildAudit, parseJson };
