/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { expect } = require("chai");

const existsAsset = require("../lib/exists");
const { buildHistory, getTxTimestampSeconds } = require("../lib/history");
const { buildStoredArtifactEventAsset } = require("../lib/artifact-event-asset");
const readAsset = require("../lib/read");
const { buildAudit, parseJson, readMetaAttributes } = require("../lib/utils");
const writeJsonAsset = require("../lib/write");
const { createContractContext } = require("../../test-support/contract-test-context");

describe("artifactevent lib helpers", () => {
  it("covers parse, write/read/exists, timestamps and history", async () => {
    expect(() => parseJson("", "payload")).to.throw("payload is required");
    expect(() => parseJson(JSON.stringify([]), "payload")).to.throw("payload must be an object");
    expect(readMetaAttributes({ meta: { attributes: { a: 1 } } })).to.deep.equal({ a: 1 });
    expect(readMetaAttributes({ metadata: { legacy: true } })).to.deep.equal({ legacy: true });

    const ctx = createContractContext({ txSeconds: 7, txId: "TX-E-LIB" });
    const asset = buildStoredArtifactEventAsset(ctx, "e1", { artifactId: "a1" });
    expect(asset.meta.audit).to.deep.equal(buildAudit(ctx, undefined, "active", true));
    expect(getTxTimestampSeconds(ctx.stub)).to.equal(7);
    expect(getTxTimestampSeconds(createContractContext({ txSeconds: { toNumber: () => 8 } }).stub)).to.equal(8);

    const previousAsset = {
      artifactId: "a-prev",
      eventSubType: "sub-prev",
      meta: { attributes: { a: 1 }, audit: { createdAt: 1, version: 0, status: "active" } },
    };
    const merged = buildStoredArtifactEventAsset(ctx, "e2", { meta: { attributes: { b: 2 } } }, previousAsset);
    expect(merged.artifactId).to.equal("a-prev");
    expect(merged.meta.attributes).to.deep.equal({ a: 1, b: 2 });
    const auditFromPrevious = buildAudit(ctx, {}, "revoked", false);
    expect(auditFromPrevious.version).to.equal(2);

    await writeJsonAsset(ctx.stub, "e1", asset);
    expect(await existsAsset(ctx.stub, "e1")).to.equal(true);
    const stored = await readAsset(ctx.stub, "e1", "ArtifactEvent");
    expect(stored.eventId).to.equal("e1");
    expect(stored.artifactId).to.equal("a1");
    expect(stored.meta.audit.version).to.equal(1);
    await expect(readAsset(ctx.stub, "missing", "ArtifactEvent")).to.be.rejectedWith("ArtifactEvent missing does not exist");

    const history = await buildHistory(createContractContext({
      historyByKey: {
        e1: [
          { txId: "A", timestamp: { seconds: { toNumber: () => 1 } }, isDelete: false, value: Buffer.from("{}") },
          { txId: "B", timestamp: { seconds: { low: 2 } }, isDelete: true, value: Buffer.from("") },
          { txId: "C", timestamp: {}, isDelete: false, value: Buffer.from("{}") },
          { txId: "D", timestamp: { seconds: 3 }, isDelete: false, value: Buffer.from("{}") },
        ],
      },
    }), "e1");
    expect(history[0].timestamp).to.equal(1);
    expect(history[1].timestamp).to.equal(2);
    expect(history[2].timestamp).to.equal(0);
    expect(history[3].timestamp).to.equal(3);
  });
});
