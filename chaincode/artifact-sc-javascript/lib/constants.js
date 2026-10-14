/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const ALLOWED_STATUS = new Set(["declared", "validated", "superseded", "revoked", "expired"]);
const CID_INDEX = "cid~artifact";
const ARTIFACT_ASSET_LABEL = "Artifact";

module.exports = {
  ALLOWED_STATUS,
  CID_INDEX,
  ARTIFACT_ASSET_LABEL,
};
