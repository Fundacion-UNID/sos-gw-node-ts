/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const SUBJECT_BINDING_INDEX = "subject~binding";
const KEY_BINDING_INDEX = "key~binding";
const ALLOWED_STATUS = new Set(["active", "suspended", "revoked", "expired"]);
const SUBJECT_KEY_BINDING_ASSET_LABEL = "SubjectKeyBinding";

module.exports = {
  ALLOWED_STATUS,
  KEY_BINDING_INDEX,
  SUBJECT_BINDING_INDEX,
  SUBJECT_KEY_BINDING_ASSET_LABEL,
};
