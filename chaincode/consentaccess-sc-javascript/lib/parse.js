/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Parses a JSON payload and throws a labelled error when the caller omits it.
 *
 * @param {string} input
 * @param {string} label
 * @returns {Record<string, unknown>}
 */
function parseJson(input, label) {
  if (!input) {
    throw new Error(`${label} is required`);
  }
  return JSON.parse(input);
}

module.exports = parseJson;
