/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract } = require("fabric-contract-api");
const { CRYPTOGRAPHIC_KEY_ASSET_LABEL, ORG_KEY_INDEX } = require("./constants");
const { buildStoredCryptographicKeyAsset } = require("./cryptographic-key-asset");
const existsAsset = require("./exists");
const { buildHistory } = require("./history");
const readAsset = require("./read");
const { assertStatus, parseJson, parseJsonArray, resolveKeyId } = require("./utils");
const writeJsonAsset = require("./write");

async function writeOrgIndex(ctx, orgId, keyId) {
  await ctx.stub.putState(ctx.stub.createCompositeKey(ORG_KEY_INDEX, [orgId, keyId]), Buffer.from(""));
}

function assertCompatible(existing, requested, keyId) {
  const immutableFields = ["orgId", "kid", "thumbprint", "kty", "crv", "alg", "use", "purpose", "origin"];
  const conflict = immutableFields.some((field) => requested[field] !== undefined && existing[field] !== requested[field]);
  if (conflict) throw new Error(`CRYPTOGRAPHIC_KEY_CONFLICT:${keyId}`);
}

class CryptographicKeyContract extends Contract {
  async RegisterKey(ctx, keyId, payloadJson) {
    if (await existsAsset(ctx.stub, keyId)) {
      throw new Error(`${CRYPTOGRAPHIC_KEY_ASSET_LABEL} ${keyId} already exists`);
    }
    const payload = parseJson(payloadJson, "payload");
    if (!payload.orgId) throw new Error("orgId is required");
    if (payload.keyId && payload.keyId !== keyId) {
      throw new Error(`Payload keyId ${payload.keyId} does not match ${keyId}`);
    }
    const asset = buildStoredCryptographicKeyAsset(ctx, keyId, payload.orgId, payload);
    await writeJsonAsset(ctx.stub, keyId, asset);
    await writeOrgIndex(ctx, asset.orgId, keyId);
    return asset;
  }

  async registerKey(ctx, keyId, payloadJson) { return this.RegisterKey(ctx, keyId, payloadJson); }

  async EnsureKey(ctx, keyId, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    if (!(await existsAsset(ctx.stub, keyId))) {
      return { created: true, asset: await this.RegisterKey(ctx, keyId, payloadJson) };
    }
    const asset = await this.ReadCryptographicKey(ctx, keyId);
    assertCompatible(asset, payload, keyId);
    return { created: false, asset };
  }

  async ensureKey(ctx, keyId, payloadJson) { return this.EnsureKey(ctx, keyId, payloadJson); }

  async RegisterKeysBatch(ctx, orgId, keysJson) {
    const keys = parseJsonArray(keysJson, "keys");
    const assets = [];
    for (const entry of keys) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid key payload");
      if (entry.orgId && entry.orgId !== orgId) throw new Error(`Key orgId ${entry.orgId} does not match ${orgId}`);
      const keyId = resolveKeyId(orgId, entry);
      assets.push(await this.RegisterKey(ctx, keyId, JSON.stringify({ ...entry, keyId, orgId })));
    }
    return assets;
  }

  async registerKeysBatch(ctx, orgId, keysJson) { return this.RegisterKeysBatch(ctx, orgId, keysJson); }

  async ReadCryptographicKey(ctx, keyId) {
    return readAsset(ctx.stub, keyId, CRYPTOGRAPHIC_KEY_ASSET_LABEL);
  }

  async readCryptographicKey(ctx, keyId) { return this.ReadCryptographicKey(ctx, keyId); }
  async GetKey(ctx, keyId) { return this.ReadCryptographicKey(ctx, keyId); }

  async ListKeysByOrg(ctx, orgId) {
    const iterator = await ctx.stub.getStateByPartialCompositeKey(ORG_KEY_INDEX, [orgId]);
    const assets = [];
    while (true) {
      const result = await iterator.next();
      if (result.value) {
        const { attributes } = ctx.stub.splitCompositeKey(result.value.key);
        const indexedKeyId = attributes[1];
        if (indexedKeyId) assets.push(await this.ReadCryptographicKey(ctx, indexedKeyId));
      }
      if (result.done) {
        await iterator.close();
        break;
      }
    }
    return assets;
  }

  async listKeysByOrg(ctx, orgId) { return this.ListKeysByOrg(ctx, orgId); }

  async ListActiveKeysByOrg(ctx, orgId, use, purpose) {
    return (await this.ListKeysByOrg(ctx, orgId)).filter((asset) => (
      asset.status === "active"
      && (!use || asset.use === use)
      && (!purpose || asset.purpose === purpose)
    ));
  }

  async listActiveKeysByOrg(ctx, orgId, use, purpose) {
    return this.ListActiveKeysByOrg(ctx, orgId, use, purpose);
  }

  async UpdateKeyStatus(ctx, keyId, status, timestampText) {
    assertStatus(status);
    const timestamp = Number(timestampText);
    if (!Number.isFinite(timestamp)) throw new Error("Invalid timestamp");
    const previous = await this.ReadCryptographicKey(ctx, keyId);
    const asset = buildStoredCryptographicKeyAsset(ctx, keyId, previous.orgId, {
      ...previous,
      status,
      expiresAt: status === "expired" ? timestamp : previous.expiresAt,
    }, previous);
    asset.updatedAt = timestamp;
    asset.meta.audit.updatedAt = timestamp;
    asset.meta.audit.txTime = timestamp;
    await writeJsonAsset(ctx.stub, keyId, asset);
    return asset;
  }

  async updateKeyStatus(ctx, keyId, status, timestampText) {
    return this.UpdateKeyStatus(ctx, keyId, status, timestampText);
  }

  async GetKeyHistory(ctx, keyId) { return buildHistory(ctx, keyId); }
  async getCryptographicKeyHistory(ctx, keyId) { return this.GetKeyHistory(ctx, keyId); }
}

module.exports = CryptographicKeyContract;
