/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { expect } = require("chai");

const existsAsset = require("../lib/exists");
const { buildHistory, getTxTimestampSeconds } = require("../lib/history");
const { buildStoredSubjectKeyBindingAsset } = require("../lib/subject-key-binding-asset");
const readAsset = require("../lib/read");
const { assertStatus, buildAudit, parseJson, readMetaAttributes } = require("../lib/utils");
const writeJsonAsset = require("../lib/write");
const { createContractContext } = require("../../test-support/contract-test-context");

describe("subjectkeybinding lib helpers", () => {
  it("covers parse, status validation, write/read/exists, timestamps and history", async () => {
    expect(() => parseJson("", "payload")).to.throw("payload is required");
    expect(() => parseJson(JSON.stringify([]), "payload")).to.throw("payload must be an object");
    expect(() => assertStatus("bad")).to.throw("Invalid status bad. Allowed: active, suspended, revoked, expired");
    expect(readMetaAttributes({ meta: { attributes: { a: 1 } } })).to.deep.equal({ a: 1 });
    expect(readMetaAttributes({ metadata: { legacy: true } })).to.deep.equal({ legacy: true });

    const ctx = createContractContext({ txSeconds: 9, txId: "TX-S-LIB" });
    const asset = buildStoredSubjectKeyBindingAsset(ctx, "b1", { subjectType: "organization", subjectId: "acme", keyId: "k1" });
    expect(asset.meta.audit).to.deep.equal(buildAudit(ctx, undefined, "active", true));
    expect(getTxTimestampSeconds(ctx.stub)).to.equal(9);
    expect(getTxTimestampSeconds(createContractContext({ txSeconds: { toNumber: () => 10 } }).stub)).to.equal(10);

    const previousAsset = {
      subjectType: "organization",
      subjectId: "acme",
      keyId: "k1",
      suspendedAt: 2,
      revokedAt: 3,
      meta: { attributes: { a: 1 }, audit: { createdAt: 1, version: 0, status: "active" } },
    };
    const suspended = buildStoredSubjectKeyBindingAsset(ctx, "b2", { status: "suspended", meta: { attributes: { b: 2 } } }, previousAsset);
    expect(suspended.suspendedAt).to.equal(9);
    expect(suspended.meta.attributes).to.deep.equal({ a: 1, b: 2 });
    const revoked = buildStoredSubjectKeyBindingAsset(ctx, "b2", { status: "revoked" }, previousAsset);
    expect(revoked.revokedAt).to.equal(9);
    expect(revoked.suspendedAt).to.equal(2);
    const revokedWithoutSuspended = buildStoredSubjectKeyBindingAsset(
      ctx,
      "b3",
      { status: "revoked" },
      { ...previousAsset, suspendedAt: undefined },
    );
    expect(revokedWithoutSuspended.suspendedAt).to.equal(null);
    const activeReset = buildStoredSubjectKeyBindingAsset(ctx, "b2", { status: "active" }, previousAsset);
    expect(activeReset.suspendedAt).to.equal(null);
    expect(activeReset.revokedAt).to.equal(null);
    const auditFromPrevious = buildAudit(ctx, {}, "active", false);
    expect(auditFromPrevious.version).to.equal(2);

    await writeJsonAsset(ctx.stub, "b1", asset);
    expect(await existsAsset(ctx.stub, "b1")).to.equal(true);
    const stored = await readAsset(ctx.stub, "b1", "SubjectKeyBinding");
    expect(stored.bindingId).to.equal("b1");
    expect(stored.subjectType).to.equal("organization");
    expect(stored.subjectId).to.equal("acme");
    expect(stored.keyId).to.equal("k1");
    expect(stored.meta.audit.version).to.equal(1);
    await expect(readAsset(ctx.stub, "missing", "SubjectKeyBinding")).to.be.rejectedWith("SubjectKeyBinding missing does not exist");

    const history = await buildHistory(createContractContext({
      historyByKey: {
        b1: [
          { txId: "A", timestamp: { seconds: { toNumber: () => 1 } }, isDelete: false, value: Buffer.from("{}") },
          { txId: "B", timestamp: { seconds: { low: 2 } }, isDelete: true, value: Buffer.from("") },
          { txId: "C", timestamp: {}, isDelete: false, value: Buffer.from("{}") },
          { txId: "D", timestamp: { seconds: 3 }, isDelete: false, value: Buffer.from("{}") },
        ],
      },
    }), "b1");
    expect(history[0].timestamp).to.equal(1);
    expect(history[1].timestamp).to.equal(2);
    expect(history[2].timestamp).to.equal(0);
    expect(history[3].timestamp).to.equal(3);
  });
});
