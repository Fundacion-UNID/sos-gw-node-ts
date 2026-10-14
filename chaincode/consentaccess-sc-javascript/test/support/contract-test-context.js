/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { TEST_IDENTIFIERS } = require("./consent-access-test-data");

/**
 * Builds a minimal Fabric history iterator for unit testing.
 *
 * @param {Array<Record<string, unknown>>} items
 * @returns {{next: Function, close: Function}}
 */
function createHistoryIterator(items) {
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

/**
 * Creates a lightweight contract context with in-memory world state.
 *
 * @param {object} input
 * @param {Record<string, unknown>} input.existingState
 * @param {number|object} input.txSeconds
 * @param {string} input.txId
 * @param {Array<Record<string, unknown>>} input.historyItems
 * @returns {Record<string, unknown>}
 */
function createContractContext({
  existingState = {},
  txSeconds,
  txId = TEST_IDENTIFIERS.NewTransactionId,
  historyItems = [],
} = {}) {
  const state = new Map();
  Object.entries(existingState).forEach(([key, value]) => {
    state.set(key, Buffer.from(JSON.stringify(value)));
  });

  const writes = [];
  const stub = {
    getState: async (key) => state.get(key) || Buffer.alloc(0),
    putState: async (key, value) => {
      writes.push({ key, value });
      state.set(key, value);
    },
    getTxTimestamp: () => ({ seconds: txSeconds }),
    getTxID: () => txId,
    getHistoryForKey: async () => createHistoryIterator(historyItems),
  };

  return {
    stub,
    writes,
    readStoredAsset(assetId = TEST_IDENTIFIERS.AssetId) {
      return JSON.parse(state.get(assetId).toString("utf8"));
    },
  };
}

module.exports = {
  createContractContext,
  createHistoryIterator,
};
