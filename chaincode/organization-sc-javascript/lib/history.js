/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
function getTxTimestampSeconds(stub) {
  const { seconds } = stub.getTxTimestamp();
  return typeof seconds === "object" && typeof seconds.toNumber === "function" ? seconds.toNumber() : Number(seconds);
}
function normalizeTimestamp(timestamp) {
  if (!timestamp?.seconds) return 0;
  if (typeof timestamp.seconds === "object" && typeof timestamp.seconds.toNumber === "function") return timestamp.seconds.toNumber();
  if (typeof timestamp.seconds === "object" && typeof timestamp.seconds.low === "number") return timestamp.seconds.low;
  return Number(timestamp.seconds);
}
async function buildHistory(ctx, id) {
  const iterator = await ctx.stub.getHistoryForKey(id);
  const items = [];
  while (true) {
    const result = await iterator.next();
    if (result.value) items.push({
      txId: result.value.txId,
      timestamp: normalizeTimestamp(result.value.timestamp),
      isDelete: result.value.isDelete,
      value: result.value.value?.length ? JSON.parse(result.value.value.toString("utf8")) : null,
    });
    if (result.done) { await iterator.close(); break; }
  }
  return items;
}
module.exports = { buildHistory, getTxTimestampSeconds };
