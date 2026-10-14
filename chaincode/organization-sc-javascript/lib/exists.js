/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
module.exports = async (stub, id) => {
  const value = await stub.getState(id);
  return !!value && value.length > 0;
};
