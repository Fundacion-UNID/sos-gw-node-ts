/* SPDX-License-Identifier: Apache-2.0 */
"use strict";

function iterator(items) {
  let index = 0;
  return { next: async () => index < items.length ? { value: items[index++], done: false } : { done: true }, close: async () => undefined };
}

function encode(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
}

function createContractContext({ existingState = {}, txSeconds = 0, txId = "TX", historyByKey = {} } = {}) {
  const state = new Map(Object.entries(existingState).map(([key, value]) => [key, encode(value)]));
  const writes = [];
  const stub = {
    getState: async (key) => state.get(key) || Buffer.alloc(0),
    putState: async (key, value) => { const encoded = encode(value); state.set(key, encoded); writes.push({ key, value: encoded }); },
    getTxTimestamp: () => ({ seconds: txSeconds }),
    getTxID: () => txId,
    getHistoryForKey: async (key) => iterator(historyByKey[key] || []),
    createCompositeKey: (type, attributes) => `${type}\u0000${attributes.join("\u0000")}`,
    splitCompositeKey: (key) => { const parts = key.split("\u0000"); return { objectType: parts[0] || "", attributes: parts.slice(1) }; },
    getStateByPartialCompositeKey: async (type, attributes) => {
      const prefix = `${type}\u0000${attributes.join("\u0000")}\u0000`;
      return iterator([...state.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value })));
    },
  };
  return { stub, writes, readJson: (key) => JSON.parse(state.get(key).toString("utf8")) };
}

module.exports = { createContractContext };

