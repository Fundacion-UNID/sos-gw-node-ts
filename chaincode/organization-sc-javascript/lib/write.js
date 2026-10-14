/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
module.exports = async (stub, id, value) => stub.putState(id, Buffer.from(JSON.stringify(value)));
