/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Reads and parses one JSON asset from world state.
 *
 * @param {import("fabric-shim").ChaincodeStub} stub
 * @param {string} assetId
 * @param {string} assetLabel
 * @returns {Promise<Record<string, unknown>>}
 */
async function readAsset(stub, assetId, assetLabel) {
  const buffer = await stub.getState(assetId);
  if (!buffer || buffer.length === 0) {
    throw new Error(`${assetLabel} ${assetId} does not exist`);
  }
  return JSON.parse(buffer.toString("utf8"));
}

module.exports = readAsset;
