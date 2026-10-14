/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

async function writeJsonAsset(stub, assetId, value) {
  await stub.putState(assetId, Buffer.from(JSON.stringify(value)));
}

module.exports = writeJsonAsset;
