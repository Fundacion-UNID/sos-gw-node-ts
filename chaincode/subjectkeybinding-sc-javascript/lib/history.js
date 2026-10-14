/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

function getTxTimestampSeconds(stub) {
  const ts = stub.getTxTimestamp();
  const seconds = typeof ts.seconds === "object" && typeof ts.seconds.toNumber === "function"
    ? ts.seconds.toNumber()
    : Number(ts.seconds);
  return seconds;
}

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
};
