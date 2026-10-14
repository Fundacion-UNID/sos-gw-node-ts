/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { getTxTimestampSeconds } = require("./history");
const { buildAudit, readMetaAttributes } = require("./utils");

/**
 * Projects a relationship asset containing a `keyId` reference, never a copy
 * of the referenced public key.
 *
 * Unknown payload fields are intentionally discarded. In particular,
 * `publicKeyJwk`, `thumbprint`, `alg`, `use` and key expiry/status belong to
 * `cryptographickey-sc`; duplicating them here would create conflicting sources
 * of truth during rotation or revocation.
 */
function buildStoredSubjectKeyBindingAsset(ctx, bindingId, payload, previousAsset) {
  const now = getTxTimestampSeconds(ctx.stub);
  const status = String(payload.status || previousAsset?.meta?.audit?.status || previousAsset?.status || "active");
  return {
    bindingId,
    subjectType: payload.subjectType || previousAsset?.subjectType,
    subjectId: payload.subjectId || previousAsset?.subjectId,
    parentOrgId: payload.parentOrgId || previousAsset?.parentOrgId || undefined,
    professionalAssignmentLink: payload.professionalAssignmentLink
      || previousAsset?.professionalAssignmentLink || undefined,
    employeeLink: payload.employeeLink || previousAsset?.employeeLink || undefined,
    organizationLink: payload.organizationLink || previousAsset?.organizationLink || undefined,
    keyId: payload.keyId || previousAsset?.keyId,
    relationship: payload.relationship || previousAsset?.relationship || undefined,
    status,
    createdAt: previousAsset?.createdAt || now,
    updatedAt: now,
    suspendedAt: status === "suspended" ? now : (status === "active" ? null : previousAsset?.suspendedAt || null),
    revokedAt: status === "revoked" ? now : (status === "active" ? null : previousAsset?.revokedAt || null),
    expiresAt: payload.expiresAt ?? previousAsset?.expiresAt ?? null,
    reason: payload.reason || previousAsset?.reason || null,
    meta: {
      attributes: {
        ...readMetaAttributes(previousAsset),
        ...readMetaAttributes(payload),
      },
      audit: buildAudit(ctx, previousAsset?.meta?.audit, status, !previousAsset),
    },
  };
}

module.exports = {
  buildStoredSubjectKeyBindingAsset,
};
