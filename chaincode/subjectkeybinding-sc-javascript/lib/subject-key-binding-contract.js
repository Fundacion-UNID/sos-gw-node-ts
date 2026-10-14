/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");
const {
  KEY_BINDING_INDEX,
  SUBJECT_BINDING_INDEX,
  SUBJECT_KEY_BINDING_ASSET_LABEL,
} = require("./constants");
const existsAsset = require("./exists");
const { buildHistory } = require("./history");
const readAsset = require("./read");
const { buildStoredSubjectKeyBindingAsset } = require("./subject-key-binding-asset");
const { assertOptionalOpaqueLink, assertStatus, parseJson } = require("./utils");
const writeJsonAsset = require("./write");

/**
 * Writes lookup-only composite keys for a subject-to-key relationship.
 *
 * The canonical public-key record and its lifecycle remain in
 * `cryptographickey-sc`. These indexes contain no JWK or thumbprint and never
 * change the status of the referenced key.
 */
async function writeIndexes(ctx, subjectType, subjectId, keyId, bindingId) {
  const subjectIndexKey = ctx.stub.createCompositeKey(SUBJECT_BINDING_INDEX, [subjectType, subjectId, bindingId]);
  const keyIndexKey = ctx.stub.createCompositeKey(KEY_BINDING_INDEX, [keyId, bindingId]);
  await ctx.stub.putState(subjectIndexKey, Buffer.from(""));
  await ctx.stub.putState(keyIndexKey, Buffer.from(""));
}

function assertProfessionalLinks(payload, previous) {
  for (const field of ["professionalAssignmentLink", "employeeLink", "organizationLink"]) {
    assertOptionalOpaqueLink(payload[field], field);
    if (previous?.[field] && payload[field] && previous[field] !== payload[field]) {
      throw new Error(`${field} cannot change for an existing subject-key binding`);
    }
  }
}

/**
 * Derived many-to-many index between subjects and cryptographic-key IDs.
 *
 * Why this contract exists separately from `cryptographickey-sc`:
 *
 * - `cryptographickey-sc` owns facts intrinsic to one public key, including
 *   its thumbprint, algorithm, use, expiry and active/revoked lifecycle.
 * - this contract owns an operational relationship between one subject and
 *   that key, including relationship type and relationship lifecycle;
 * - one subject can rotate across several keys and one key can be referenced
 *   by several relationships without rewriting the key asset;
 * - suspending or revoking a binding never reactivates, revokes or otherwise
 *   mutates the referenced key.
 *
 * A binding stores only `keyId`. It is not canonical identity, proof of key
 * possession, a licence, consent or channel authorization. Callers must resolve
 * the key from `cryptographickey-sc` in the same channel and validate both
 * lifecycles plus the applicable business authorization.
 */
class SubjectKeyBindingContract extends Contract {
  /**
   * Creates a new relationship referencing an existing or concurrently
   * provisioned cryptographic-key ID. Fabric does not provide cross-chaincode
   * foreign keys, so the orchestrating GW is responsible for ensuring the key
   * exists and for failing the overall workflow if either write fails.
   */
  async CreateSubjectKeyBinding(ctx, bindingId, payloadJson) {
    if (await existsAsset(ctx.stub, bindingId)) {
      throw new Error(`${SUBJECT_KEY_BINDING_ASSET_LABEL} ${bindingId} already exists`);
    }

    const payload = parseJson(payloadJson, "payload");
    if (payload.bindingId && payload.bindingId !== bindingId) {
      throw new Error(`Payload bindingId ${payload.bindingId} does not match ${bindingId}`);
    }
    if (!payload.subjectType || !payload.subjectId || !payload.keyId) {
      throw new Error("subjectType, subjectId, and keyId are required");
    }
    assertProfessionalLinks(payload);

    const status = payload.status || "active";
    assertStatus(status);
    const asset = buildStoredSubjectKeyBindingAsset(ctx, bindingId, payload);
    await writeJsonAsset(ctx.stub, bindingId, asset);
    await writeIndexes(ctx, asset.subjectType, asset.subjectId, asset.keyId, bindingId);
    return asset;
  }

  async createSubjectKeyBinding(ctx, bindingId, payloadJson) {
    return this.CreateSubjectKeyBinding(ctx, bindingId, payloadJson);
  }

  /**
   * Creates or updates only relationship-owned fields. Public-key material in
   * the payload is deliberately ignored by the stored-asset projection.
   */
  async UpsertSubjectKeyBinding(ctx, bindingId, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    const status = payload.status || "active";
    assertStatus(status);

    if (!(await existsAsset(ctx.stub, bindingId))) {
      return this.CreateSubjectKeyBinding(ctx, bindingId, payloadJson);
    }

    const previous = await readAsset(ctx.stub, bindingId, SUBJECT_KEY_BINDING_ASSET_LABEL);
    assertProfessionalLinks(payload, previous);
    const next = buildStoredSubjectKeyBindingAsset(ctx, bindingId, payload, previous);
    await writeJsonAsset(ctx.stub, bindingId, next);
    await writeIndexes(ctx, next.subjectType, next.subjectId, next.keyId, bindingId);
    return next;
  }

  async upsertSubjectKeyBinding(ctx, bindingId, payloadJson) {
    return this.UpsertSubjectKeyBinding(ctx, bindingId, payloadJson);
  }

  async ReadSubjectKeyBinding(ctx, bindingId) {
    return readAsset(ctx.stub, bindingId, SUBJECT_KEY_BINDING_ASSET_LABEL);
  }

  async readSubjectKeyBinding(ctx, bindingId) {
    return this.ReadSubjectKeyBinding(ctx, bindingId);
  }

  /**
   * Changes the lifecycle of this relationship only. It does not change the
   * lifecycle of the referenced key in `cryptographickey-sc`.
   */
  async UpdateBindingStatus(ctx, bindingId, status, ts, reason, metaAttributesJson) {
    assertStatus(status);
    const timestamp = Number(ts);
    if (!Number.isFinite(timestamp)) {
      throw new Error("Invalid timestamp");
    }

    const previousAsset = await readAsset(ctx.stub, bindingId, SUBJECT_KEY_BINDING_ASSET_LABEL);
    const payload = {
      ...previousAsset,
      status,
      reason: reason || previousAsset.reason || null,
      meta: metaAttributesJson
        ? {
          ...(previousAsset.meta && typeof previousAsset.meta === "object" ? previousAsset.meta : {}),
          attributes: {
            ...((previousAsset?.meta?.attributes && typeof previousAsset.meta.attributes === "object")
              ? previousAsset.meta.attributes
              : {}),
            ...parseJson(metaAttributesJson, "meta.attributes"),
          },
        }
        : previousAsset.meta,
      expiresAt: status === "expired" ? timestamp : previousAsset.expiresAt,
    };
    const asset = buildStoredSubjectKeyBindingAsset(ctx, bindingId, payload, previousAsset);
    asset.updatedAt = timestamp;
    asset.meta.audit.updatedAt = timestamp;
    asset.meta.audit.txTime = timestamp;
    await writeJsonAsset(ctx.stub, bindingId, asset);
    return asset;
  }

  async updateBindingStatus(ctx, bindingId, status, ts, reason, metaAttributesJson) {
    return this.UpdateBindingStatus(ctx, bindingId, status, ts, reason, metaAttributesJson);
  }

  async GetSubjectKeyBindingHistory(ctx, bindingId) {
    return buildHistory(ctx, bindingId);
  }

  async getSubjectKeyBindingHistory(ctx, bindingId) {
    return this.GetSubjectKeyBindingHistory(ctx, bindingId);
  }
}

module.exports = SubjectKeyBindingContract;
