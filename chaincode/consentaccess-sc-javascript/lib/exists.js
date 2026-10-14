/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Returns whether a state entry already exists in the current world state.
 *
 * @param {import("fabric-shim").ChaincodeStub} stub
 * @param {string} assetId
 * @returns {Promise<boolean>}
 */
async function existsAsset(stub, assetId) {
  const buffer = await stub.getState(assetId);
  return !!buffer && buffer.length > 0;
}

module.exports = existsAsset;
