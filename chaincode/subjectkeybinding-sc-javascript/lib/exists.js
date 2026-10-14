/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

async function existsAsset(stub, assetId) {
  const buffer = await stub.getState(assetId);
  return !!buffer && buffer.length > 0;
}

module.exports = existsAsset;
