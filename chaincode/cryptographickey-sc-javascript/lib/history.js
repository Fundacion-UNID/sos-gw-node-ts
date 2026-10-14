/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

function getTxTimestampSeconds(stub) {
  const { seconds } = stub.getTxTimestamp();
  return typeof seconds === "object" && typeof seconds.toNumber === "function"
    ? seconds.toNumber()
    : Number(seconds);
}

function normalizeHistoryTimestamp(timestamp) {
  if (!timestamp || !timestamp.seconds) return 0;
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
    const result = await iterator.next();
    if (result.value) {
      history.push({
        txId: result.value.txId,
        timestamp: normalizeHistoryTimestamp(result.value.timestamp),
        isDelete: result.value.isDelete,
        value: result.value.value && result.value.value.length
          ? JSON.parse(result.value.value.toString("utf8"))
          : null,
      });
    }
    if (result.done) {
      await iterator.close();
      break;
    }
  }
  return history;
}

module.exports = { buildHistory, getTxTimestampSeconds };
