/*
 * SPDX-License-Identifier: Apache-2.0
 */
"use strict";

const { Contract } = require("fabric-contract-api");

const MULTIBASE_URN_PATTERN = /^urn:multibase:z[1-9A-HJ-NP-Za-km-z]+$/;
const INDEX_PROVIDER_DID_PATTERN = /^did:web:[A-Za-z0-9._%-]+(?::[A-Za-z0-9._%-]+)*$/;

function timestampSeconds(stub) {
  const seconds = stub.getTxTimestamp().seconds;
  return typeof seconds === "object" && typeof seconds.toNumber === "function"
    ? seconds.toNumber()
    : Number(seconds);
}

function validate(assetId, payloadJson) {
  if (!MULTIBASE_URN_PATTERN.test(String(assetId || ""))) {
    throw new Error("assetId must be an urn:multibase value");
  }
  const payload = JSON.parse(String(payloadJson || "{}"));
  if (Object.keys(payload).length !== 1) {
    throw new Error("subject identifier payload must contain only indexProviderDid");
  }
  const indexProviderDid = String(payload.indexProviderDid || "").trim();
  if (!INDEX_PROVIDER_DID_PATTERN.test(indexProviderDid)) {
    throw new Error("indexProviderDid must be a did:web identifier");
  }
  return { indexProviderDid };
}

async function readOptional(ctx, assetId) {
  const stored = await ctx.stub.getState(assetId);
  return stored?.length ? JSON.parse(stored.toString("utf8")) : undefined;
}

class SubjectIdentifierContract extends Contract {
  async UpsertSubjectIdentifier(ctx, assetId, payloadJson) {
    const normalized = validate(assetId, payloadJson);
    const existing = await readOptional(ctx, assetId);
    if (existing && existing.indexProviderDid !== normalized.indexProviderDid) {
      throw new Error("SubjectIdentifierProviderConflict");
    }
    if (existing) return existing;

    const now = timestampSeconds(ctx.stub);
    const asset = {
      assetId,
      indexProviderDid: normalized.indexProviderDid,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await ctx.stub.putState(assetId, Buffer.from(JSON.stringify(asset)));
    return asset;
  }

  async upsertSubjectIdentifier(ctx, assetId, payloadJson) {
    return this.UpsertSubjectIdentifier(ctx, assetId, payloadJson);
  }

  async ReadSubjectIdentifier(ctx, assetId) {
    const asset = await readOptional(ctx, assetId);
    if (!asset) throw new Error(`SubjectIdentifier ${assetId} does not exist`);
    return asset;
  }

  async readSubjectIdentifier(ctx, assetId) {
    return this.ReadSubjectIdentifier(ctx, assetId);
  }

  /**
   * Removes the current public resolution for one already-derived asset id.
   * The raw private identifier is never accepted as a transaction argument.
   */
  async DeleteSubjectIdentifier(ctx, assetId, indexProviderDid) {
    if (!MULTIBASE_URN_PATTERN.test(String(assetId || ""))) {
      throw new Error("assetId must be an urn:multibase value");
    }
    const existing = await readOptional(ctx, assetId);
    if (!existing) throw new Error(`SubjectIdentifier ${assetId} does not exist`);
    if (existing.indexProviderDid !== String(indexProviderDid || "").trim()) {
      throw new Error("SubjectIdentifierProviderConflict");
    }
    await ctx.stub.deleteState(assetId);
    return { assetId, deleted: true };
  }

  async deleteSubjectIdentifier(ctx, assetId, indexProviderDid) {
    return this.DeleteSubjectIdentifier(ctx, assetId, indexProviderDid);
  }
}

module.exports.SubjectIdentifierContract = SubjectIdentifierContract;
module.exports.contracts = [SubjectIdentifierContract];
