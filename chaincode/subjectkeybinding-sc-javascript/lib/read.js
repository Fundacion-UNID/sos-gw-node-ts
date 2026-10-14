/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

async function readAsset(stub, assetId, label) {
  const buffer = await stub.getState(assetId);
  if (!buffer || buffer.length === 0) {
    throw new Error(`${label} ${assetId} does not exist`);
  }
  return JSON.parse(buffer.toString("utf8"));
}

module.exports = readAsset;
