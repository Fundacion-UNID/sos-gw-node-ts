// Flow contract: artifact helpers preserve CID identity, history, and ledger-safe clinical links without raw subject data.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { expect } = require("chai");

const existsAsset = require("../lib/exists");
const { buildHistory, getTxTimestampSeconds } = require("../lib/history");
const { buildStoredArtifactAsset } = require("../lib/artifact-asset");
const readAsset = require("../lib/read");
const { assertStatus, buildAudit, mergeMetadata, parseJson, readMetaAttributes } = require("../lib/utils");
const writeJsonAsset = require("../lib/write");
const { createContractContext } = require("../../test-support/contract-test-context");

describe("artifact lib helpers", () => {
  it("covers parse, status validation, metadata merge, write/read/exists, timestamps and history", async () => {
    expect(() => parseJson("", "payload")).to.throw("payload is required");
    expect(() => parseJson(JSON.stringify([]), "payload")).to.throw("payload must be an object");
    expect(() => assertStatus("bad")).to.throw("Invalid status bad. Allowed: declared, validated, superseded, revoked, expired");
    expect(() => assertStatus("declared")).not.to.throw();
    expect(mergeMetadata({ a: 1 }, { b: 2 })).to.deep.equal({ a: 1, b: 2 });
    expect(mergeMetadata(null, "bad")).to.deep.equal({});
    expect(readMetaAttributes({ meta: { attributes: { a: 1 } } })).to.deep.equal({ a: 1 });
    expect(readMetaAttributes({ metadata: { legacy: true } })).to.deep.equal({ legacy: true });

    const ctx = createContractContext({ txSeconds: { toNumber: () => 5 }, txId: "TX-A-LIB" });
    const asset = buildStoredArtifactAsset(ctx, "a1", { hash: "hash", meta: { attributes: { x: 1 } } });
    expect(asset.meta.audit).to.deep.equal(buildAudit(ctx, undefined, "declared", true));
    expect(getTxTimestampSeconds(ctx.stub)).to.equal(5);

    const previousAsset = {
      createdAt: 1,
      validatedAt: 2,
      validationCount: 3,
      meta: { attributes: { a: 1 }, audit: { createdAt: 1, version: 0, status: "declared" } },
    };
    const validated = buildStoredArtifactAsset(ctx, "a2", { status: "validated", validationCount: 1 }, previousAsset);
    expect(validated.validatedAt).to.equal(2);
    expect(validated.validationCount).to.equal(3);
    expect(validated.meta.attributes).to.deep.equal({ a: 1 });
    const createdValidated = buildStoredArtifactAsset(ctx, "a3", { status: "validated", hash: "x" });
    expect(createdValidated.validatedAt).to.equal(5);
    const previousStatus = buildStoredArtifactAsset(ctx, "a4", { hash: "y" }, { ...previousAsset, status: "superseded", meta: undefined, metadata: { legacy: true } });
    expect(previousStatus.status).to.equal("superseded");
    expect(previousStatus.meta.attributes).to.deep.equal({ legacy: true });
    expect(() => buildStoredArtifactAsset(ctx, "a5", { status: "bad", hash: "z" })).to.throw(
      "Invalid status bad. Allowed: declared, validated, superseded, revoked, expired",
    );
    const plainAudit = buildAudit(ctx, {}, "declared", false);
    expect(plainAudit.version).to.equal(2);

    await writeJsonAsset(ctx.stub, "a1", asset);
    expect(await existsAsset(ctx.stub, "a1")).to.equal(true);
    const stored = await readAsset(ctx.stub, "a1", "Artifact");
    expect(stored.artifactId).to.equal("a1");
    expect(stored.hash).to.equal("hash");
    expect(stored.meta.audit.version).to.equal(1);
    await expect(readAsset(ctx.stub, "missing", "Artifact")).to.be.rejectedWith("Artifact missing does not exist");

    const history = await buildHistory(createContractContext({
      historyByKey: {
        a1: [
          { txId: "A", timestamp: { seconds: { toNumber: () => 1 } }, isDelete: false, value: Buffer.from("{}") },
          { txId: "B", timestamp: { seconds: { low: 2 } }, isDelete: true, value: Buffer.from("") },
          { txId: "C", timestamp: {}, isDelete: false, value: Buffer.from("{}") },
          { txId: "D", timestamp: { seconds: 3 }, isDelete: false, value: Buffer.from("{}") },
        ],
      },
    }), "a1");
    expect(history[0].timestamp).to.equal(1);
    expect(history[1].timestamp).to.equal(2);
    expect(history[2].timestamp).to.equal(0);
    expect(history[3].timestamp).to.equal(3);
  });
});
