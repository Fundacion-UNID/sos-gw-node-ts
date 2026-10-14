/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { getTxTimestampSeconds } = require("./history");
const { assertStatus, buildAudit } = require("./utils");

function buildStoredCryptographicKeyAsset(ctx, keyId, orgId, payload, previousAsset) {
  const now = getTxTimestampSeconds(ctx.stub);
  const status = payload.status || previousAsset?.status || "active";
  assertStatus(status);
  const value = (name) => payload[name] ?? previousAsset?.[name];
  return {
    keyId,
    orgId,
    kid: value("kid"),
    thumbprint: value("thumbprint"),
    kty: value("kty"),
    crv: value("crv"),
    alg: value("alg"),
    use: value("use"),
    purpose: value("purpose"),
    origin: value("origin"),
    status,
    createdAt: previousAsset?.createdAt || now,
    updatedAt: now,
    suspendedAt: status === "suspended" ? now : (status === "active" ? null : previousAsset?.suspendedAt ?? null),
    revokedAt: status === "revoked" ? now : (status === "active" ? null : previousAsset?.revokedAt ?? null),
    expiresAt: value("expiresAt") ?? null,
    meta: {
      attributes: {
        ...(previousAsset?.meta?.attributes || {}),
        ...(payload?.meta?.attributes || {}),
      },
      audit: buildAudit(ctx, previousAsset?.meta?.audit, status, !previousAsset),
    },
  };
}

module.exports = { buildStoredCryptographicKeyAsset };
