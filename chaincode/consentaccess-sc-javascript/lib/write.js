/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Persists a JSON asset in world state.
 *
 * @param {import("fabric-shim").ChaincodeStub} stub
 * @param {string} assetId
 * @param {Record<string, unknown>} asset
 * @returns {Promise<void>}
 */
async function writeJsonAsset(stub, assetId, asset) {
  await stub.putState(assetId, Buffer.from(JSON.stringify(asset)));
}

module.exports = writeJsonAsset;
