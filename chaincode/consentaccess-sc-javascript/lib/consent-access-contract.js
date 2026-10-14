/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { Contract: ContractBase } = require("fabric-contract-api");

const { buildStoredAsset } = require("./consent-access-asset");
const { buildHistory } = require("./history");
const existsAsset = require("./exists");
const parseJson = require("./parse");
const readAsset = require("./read");
const writeJsonAsset = require("./write");

const CONSENT_ACCESS_ASSET_LABEL = "ConsentAccess";
const PAYLOAD_LABEL = "payload";

/**
 * Produces a stable JSON representation without changing array order.
 * Fabric transports JSON values, so object insertion order and JavaScript
 * prototypes are representation details rather than consent changes.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort()
    .reduce((canonical, key) => {
      canonical[key] = canonicalizeJson(value[key]);
      return canonical;
    }, {});
}

/**
 * Compares JSON payloads by value instead of serialized property order.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function jsonValuesEqual(left, right) {
  return JSON.stringify(canonicalizeJson(left)) === JSON.stringify(canonicalizeJson(right));
}

/**
 * Smart contract responsible for persisting blockchain-safe consent access
 * bundles.
 *
 * Design rules:
 * - input is always one primary document with `data[]`
 * - the smart contract sanitizes the claim surface again before writing
 * - audit metadata is generated on-chain
 * - `Upsert` becomes a no-op when the sanitized bundle is identical
 */
class ConsentAccessContract extends ContractBase {
  /**
   * Creates a new consent access bundle.
   *
   * @param {import("fabric-contract-api").Context} ctx
   * @param {string} assetId
   * @param {string} payloadJson
   * @returns {Promise<Record<string, unknown>>}
   */
  async CreateConsentAccess(ctx, assetId, payloadJson) {
    const exists = await existsAsset(ctx.stub, assetId);
    if (exists) {
      throw new Error(`${CONSENT_ACCESS_ASSET_LABEL} ${assetId} already exists`);
    }

    const asset = buildStoredAsset(ctx, assetId, parseJson(payloadJson, PAYLOAD_LABEL));
    await writeJsonAsset(ctx.stub, assetId, asset);
    return asset;
  }

  /**
   * Lowercase alias kept for compatibility with generic contract managers.
   */
  async createConsentAccess(ctx, assetId, payloadJson) {
    return this.CreateConsentAccess(ctx, assetId, payloadJson);
  }

  /**
   * Rewrites one existing consent access bundle with a newly sanitized version.
   *
   * @param {import("fabric-contract-api").Context} ctx
   * @param {string} assetId
   * @param {string} payloadJson
   * @returns {Promise<Record<string, unknown>>}
   */
  async UpdateConsentAccess(ctx, assetId, payloadJson) {
    const previousAsset = await readAsset(ctx.stub, assetId, CONSENT_ACCESS_ASSET_LABEL);
    const asset = buildStoredAsset(ctx, assetId, parseJson(payloadJson, PAYLOAD_LABEL), previousAsset);
    await writeJsonAsset(ctx.stub, assetId, asset);
    return asset;
  }

  /**
   * Lowercase alias kept for compatibility with generic contract managers.
   */
  async updateConsentAccess(ctx, assetId, payloadJson) {
    return this.UpdateConsentAccess(ctx, assetId, payloadJson);
  }

  /**
   * Creates or updates a consent access bundle depending on state existence.
   *
   * If the newly sanitized bundle is identical to the stored one, this method
   * returns the previous asset without writing a new revision.
   *
   * @param {import("fabric-contract-api").Context} ctx
   * @param {string} assetId
   * @param {string} payloadJson
   * @returns {Promise<Record<string, unknown>>}
   */
  async UpsertConsentAccess(ctx, assetId, payloadJson) {
    const exists = await existsAsset(ctx.stub, assetId);
    if (!exists) {
      return this.CreateConsentAccess(ctx, assetId, payloadJson);
    }

    const previousAsset = await readAsset(ctx.stub, assetId, CONSENT_ACCESS_ASSET_LABEL);
    const nextAsset = buildStoredAsset(ctx, assetId, parseJson(payloadJson, PAYLOAD_LABEL), previousAsset);
    if (jsonValuesEqual(previousAsset.data, nextAsset.data)
      && previousAsset.meta.audit.status === nextAsset.meta.audit.status) {
      return previousAsset;
    }

    await writeJsonAsset(ctx.stub, assetId, nextAsset);
    return nextAsset;
  }

  /**
   * Lowercase alias kept for compatibility with generic contract managers.
   */
  async upsertConsentAccess(ctx, assetId, payloadJson) {
    return this.UpsertConsentAccess(ctx, assetId, payloadJson);
  }

  /**
   * Returns whether an asset is present in world state.
   *
   * @param {import("fabric-contract-api").Context} ctx
   * @param {string} assetId
   * @returns {Promise<boolean>}
   */
  async ExistsConsentAccess(ctx, assetId) {
    return existsAsset(ctx.stub, assetId);
  }

  /**
   * Lowercase alias kept for compatibility with generic contract managers.
   */
  async existsConsentAccess(ctx, assetId) {
    return this.ExistsConsentAccess(ctx, assetId);
  }

  /**
   * Reads one stored consent access bundle.
   *
   * @param {import("fabric-contract-api").Context} ctx
   * @param {string} assetId
   * @returns {Promise<Record<string, unknown>>}
   */
  async ReadConsentAccess(ctx, assetId) {
    return readAsset(ctx.stub, assetId, CONSENT_ACCESS_ASSET_LABEL);
  }

  /**
   * Lowercase alias kept for compatibility with generic contract managers.
   */
  async readConsentAccess(ctx, assetId) {
    return this.ReadConsentAccess(ctx, assetId);
  }

  /**
   * Returns full blockchain history for one consent access bundle.
   *
   * @param {import("fabric-contract-api").Context} ctx
   * @param {string} assetId
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async GetConsentAccessHistory(ctx, assetId) {
    return buildHistory(ctx, assetId);
  }

  /**
   * Lowercase alias kept for compatibility with generic contract managers.
   */
  async getConsentAccessHistory(ctx, assetId) {
    return this.GetConsentAccessHistory(ctx, assetId);
  }
}

module.exports = ConsentAccessContract;
