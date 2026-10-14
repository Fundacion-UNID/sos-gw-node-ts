/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const ALLOWED_STATUS = new Set(["active", "suspended", "revoked", "expired"]);
const CRYPTOGRAPHIC_KEY_ASSET_LABEL = "CryptographicKey";
const ORG_KEY_INDEX = "org~key";

module.exports = { ALLOWED_STATUS, CRYPTOGRAPHIC_KEY_ASSET_LABEL, ORG_KEY_INDEX };
