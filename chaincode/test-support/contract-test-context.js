/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const DEFAULT_TX_ID = "TX-001";
const COMPOSITE_SEPARATOR = "\u0000";

function createIterator(items) {
  let index = 0;
  return {
    next: async () => {
      if (index < items.length) {
        return { value: items[index++], done: false };
      }
      return { done: true };
    },
    close: async () => undefined,
  };
}

function encodeCompositeKey(objectType, attributes = []) {
  return [objectType, ...attributes].join(COMPOSITE_SEPARATOR);
}

function decodeCompositeKey(key) {
  const parts = String(key || "").split(COMPOSITE_SEPARATOR);
  return {
    objectType: parts[0] || "",
    attributes: parts.slice(1),
  };
}

function createContractContext({
  existingState = {},
  txSeconds = 1713378604,
  txId = DEFAULT_TX_ID,
  historyByKey = {},
} = {}) {
  const state = new Map();
  Object.entries(existingState).forEach(([key, value]) => {
    state.set(key, Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value)));
  });

  const writes = [];
  const stub = {
    getState: async (key) => state.get(key) || Buffer.alloc(0),
    putState: async (key, value) => {
      writes.push({ key, value });
      state.set(key, value);
    },
    deleteState: async (key) => {
      writes.push({ key, deleted: true });
      state.delete(key);
    },
    getTxTimestamp: () => ({ seconds: txSeconds }),
    getTxID: () => txId,
    getHistoryForKey: async (key) => createIterator(historyByKey[key] || []),
    createCompositeKey: (objectType, attributes) => encodeCompositeKey(objectType, attributes),
    splitCompositeKey: (key) => decodeCompositeKey(key),
    getStateByPartialCompositeKey: async (objectType, attributes = []) => {
      const prefix = encodeCompositeKey(objectType, attributes);
      const items = [];
      for (const [key] of state.entries()) {
        if (key === prefix || key.startsWith(`${prefix}${COMPOSITE_SEPARATOR}`)) {
          items.push({ key, value: state.get(key) });
        }
      }
      return createIterator(items);
    },
  };

  return {
    stub,
    writes,
    readJson(key) {
      return JSON.parse(state.get(key).toString("utf8"));
    },
    readText(key) {
      return state.get(key).toString("utf8");
    },
  };
}

module.exports = {
  createContractContext,
};
