/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
module.exports = async (stub, id, label) => {
  const value = await stub.getState(id);
  if (!value || value.length === 0) throw new Error(`${label} ${id} does not exist`);
  return JSON.parse(value.toString("utf8"));
};
