/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
const { getTxTimestampSeconds } = require("./history");
const { assertStatus, buildAudit } = require("./utils");
function getEvidenceHashes(evidence) {
  if (!evidence) return {};
  const entries = Array.isArray(evidence) ? evidence : [evidence];
  let docHash;
  let signedHash;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const digests = Array.isArray(entry.digest) ? entry.digest : entry.digests ? [entry.digests] : [];
    for (const digest of digests) {
      if (!digest || typeof digest !== "object") continue;
      const raw = digest.hashValue || digest.value || digest.digest;
      const value = raw === undefined || raw === null || raw === "" || raw === false || raw === 0 ? undefined : String(raw);
      if (digest.type === "DocumentHash") docHash = value;
      if (digest.type === "SignedDocumentHash") signedHash = value;
    }
  }
  return { docHash, signedHash };
}
function buildStoredOrganizationAsset(ctx, orgId, payload, previous) {
  const now = getTxTimestampSeconds(ctx.stub);
  const status = payload.status || previous?.meta?.audit?.status || "active";
  assertStatus(status);
  return {
    orgId,
    vc: payload.vc || previous?.vc,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    meta: { audit: buildAudit(ctx, previous?.meta?.audit, status, !previous) },
  };
}
module.exports = { buildStoredOrganizationAsset, getEvidenceHashes };
