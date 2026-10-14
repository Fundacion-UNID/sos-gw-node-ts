/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Normalizes Fabric transaction timestamps to plain epoch seconds.
 *
 * @param {{seconds?: number|{toNumber?: Function, low?: number}}} timestamp
 * @returns {number}
 */
function normalizeHistoryTimestamp(timestamp) {
  if (!timestamp || !timestamp.seconds) {
    return 0;
  }
  if (typeof timestamp.seconds === "object" && typeof timestamp.seconds.toNumber === "function") {
    return timestamp.seconds.toNumber();
  }
  if (typeof timestamp.seconds === "object" && typeof timestamp.seconds.low === "number") {
    return timestamp.seconds.low;
  }
  return Number(timestamp.seconds);
}

/**
 * Reads the current transaction timestamp from Fabric and normalizes it to
 * epoch seconds.
 *
 * @param {import("fabric-shim").ChaincodeStub} stub
 * @returns {number}
 */
function getTxTimestampSeconds(stub) {
  return normalizeHistoryTimestamp(stub.getTxTimestamp());
}

/**
 * Reads full key history and returns JSON-decoded values for each revision.
 *
 * @param {import("fabric-contract-api").Context} ctx
 * @param {string} assetId
 * @returns {Promise<Array<{txId:string,timestamp:number,isDelete:boolean,value:unknown}>>}
 */
async function buildHistory(ctx, assetId) {
  const iterator = await ctx.stub.getHistoryForKey(assetId);
  const history = [];
  while (true) {
    const res = await iterator.next();
    if (res.value) {
      const value = res.value.value && res.value.value.length
        ? JSON.parse(res.value.value.toString("utf8"))
        : null;
      history.push({
        txId: res.value.txId,
        timestamp: normalizeHistoryTimestamp(res.value.timestamp),
        isDelete: res.value.isDelete,
        value,
      });
    }
    if (res.done) {
      await iterator.close();
      break;
    }
  }
  return history;
}

module.exports = {
  buildHistory,
  getTxTimestampSeconds,
  normalizeHistoryTimestamp,
};
