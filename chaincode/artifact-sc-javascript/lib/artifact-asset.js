/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { ALLOWED_STATUS } = require("./constants");
const { getTxTimestampSeconds } = require("./history");
const { buildAudit, mergeMetadata, readMetaAttributes } = require("./utils");

function assertStatus(status) {
  if (!ALLOWED_STATUS.has(status)) {
    throw new Error("Invalid status " + status + ". Allowed: declared, validated, superseded, revoked, expired");
  }
}

function buildStoredArtifactAsset(ctx, artifactId, payload, previousAsset) {
  const now = getTxTimestampSeconds(ctx.stub);
  const status = String(payload.status || previousAsset?.meta?.audit?.status || previousAsset?.status || "declared");
  assertStatus(status);

  return {
    artifactId,
    cid: payload.cid || previousAsset?.cid || undefined,
    hash: payload.hash || previousAsset?.hash || undefined,
    hashAlg: payload.hashAlg || previousAsset?.hashAlg || undefined,
    artifactType: payload.artifactType || previousAsset?.artifactType || undefined,
    declaredBy: payload.declaredBy || previousAsset?.declaredBy || undefined,
    declaredByType: payload.declaredByType || previousAsset?.declaredByType || undefined,
    relationships: payload.relationships || previousAsset?.relationships || undefined,
    ownerships: payload.ownerships || previousAsset?.ownerships || undefined,
    status,
    createdAt: previousAsset?.createdAt || now,
    updatedAt: now,
    validatedAt: status === "validated" ? (previousAsset?.validatedAt || now) : previousAsset?.validatedAt || null,
    validationCount: Math.max(Number(previousAsset?.validationCount || 0), Number(payload.validationCount || 0)),
    meta: {
      attributes: mergeMetadata(readMetaAttributes(previousAsset), readMetaAttributes(payload)),
      audit: buildAudit(ctx, previousAsset?.meta?.audit, status, !previousAsset),
    },
  };
}

module.exports = {
  assertStatus,
  buildStoredArtifactAsset,
};
