// Flow contract: organization helpers preserve evidence uniqueness, lifecycle audit fields, and deterministic history.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { expect } = require("chai");

const existsAsset = require("../lib/exists");
const { buildHistory, getTxTimestampSeconds } = require("../lib/history");
const { buildStoredOrganizationAsset, getEvidenceHashes } = require("../lib/organization-asset");
const readAsset = require("../lib/read");
const { assertStatus, buildAudit, parseJson } = require("../lib/utils");
const writeJsonAsset = require("../lib/write");
const { createContractContext } = require("../../test-support/contract-test-context");

describe("organization lib helpers", () => {
  it("covers parse, status validation, evidence extraction, write/read/exists, timestamps and history", async () => {
    expect(parseJson(JSON.stringify({ ok: true }), "payload")).to.deep.equal({ ok: true });
    expect(() => assertStatus("active")).not.to.throw();
    expect(() => parseJson("", "payload")).to.throw("payload is required");
    expect(() => parseJson(JSON.stringify([]), "payload")).to.throw("payload must be an object");
    expect(() => assertStatus("bad")).to.throw("Invalid status bad. Allowed: active, suspended, revoked");

    const digests = getEvidenceHashes([
      { digest: [{ type: "DocumentHash", hashValue: "doc" }, { type: "SignedDocumentHash", hashValue: "signed" }] },
      { digests: { type: "DocumentHash", hashValue: "doc2" } },
      { digest: [{ type: "Other", hashValue: "skip" }] },
    ]);
    expect(digests).to.deep.equal({ docHash: "doc2", signedHash: "signed" });
    expect(getEvidenceHashes()).to.deep.equal({});
    expect(getEvidenceHashes({ digest: [{ type: "SignedDocumentHash", hashValue: "signed3" }, { type: "DocumentHash", value: "doc3" }] }))
      .to.deep.equal({ docHash: "doc3", signedHash: "signed3" });
    expect(getEvidenceHashes({ digest: [{ type: "DocumentHash", digest: 123 }, { type: "SignedDocumentHash", hashValue: "" }, { type: "Other", hashValue: "x" }] }))
      .to.deep.equal({ docHash: "123", signedHash: undefined });
    expect(getEvidenceHashes({ digest: [{ type: "DocumentHash", hashValue: 0 }, { type: "SignedDocumentHash", hashValue: false }] }))
      .to.deep.equal({ docHash: undefined, signedHash: undefined });
    expect(getEvidenceHashes({ digest: [true] }))
      .to.deep.equal({ docHash: undefined, signedHash: undefined });
    expect(getEvidenceHashes({ digest: [null] }))
      .to.deep.equal({ docHash: undefined, signedHash: undefined });
    expect(getEvidenceHashes({ digest: ["signed-direct"] }))
      .to.deep.equal({ docHash: undefined, signedHash: undefined });
    expect(getEvidenceHashes({})).to.deep.equal({ docHash: undefined, signedHash: undefined });
    expect(getEvidenceHashes([{ digests: null }, null])).to.deep.equal({ docHash: undefined, signedHash: undefined });

    const ctx = createContractContext({ txSeconds: { toNumber: () => 10 }, txId: "TX-LIB-1" });
    const asset = buildStoredOrganizationAsset(ctx, "org", { vc: { id: "urn:vc:1", evidence: [{ digest: [{ type: "SignedDocumentHash", hashValue: "signed" }] }] } });
    expect(asset.meta.audit).to.deep.equal(buildAudit(ctx, undefined, "active", true));
    expect(getTxTimestampSeconds(ctx.stub)).to.equal(10);
    const revokedAsset = buildStoredOrganizationAsset(ctx, "org", { status: "revoked", vc: { id: "urn:vc:1" } }, asset);
    expect(revokedAsset.meta.audit.status).to.equal("revoked");
    const fallbackAsset = buildStoredOrganizationAsset(ctx, "org", { status: "suspended" }, asset);
    expect(fallbackAsset.vc.id).to.equal("urn:vc:1");
    const previousStatusAsset = buildStoredOrganizationAsset(ctx, "org", { vc: { id: "urn:vc:2" } }, {
      vc: { id: "urn:vc:prev" },
      meta: { audit: { status: "revoked", createdAt: 5, version: 2 } },
    });
    expect(previousStatusAsset.meta.audit.status).to.equal("revoked");
    expect(buildAudit(ctx, { createdAt: 1 }, "active", false)).to.deep.equal({
      createdAt: 1,
      updatedAt: 10,
      txId: "TX-LIB-1",
      txTime: 10,
      status: "active",
      version: 2,
    });
    expect(buildAudit(ctx, { createdAt: 2, version: 4 }, "revoked", false)).to.deep.equal({
      createdAt: 2,
      updatedAt: 10,
      txId: "TX-LIB-1",
      txTime: 10,
      status: "revoked",
      version: 5,
    });

    await writeJsonAsset(ctx.stub, "org", asset);
    expect(await existsAsset(ctx.stub, "org")).to.equal(true);
    expect(await existsAsset(ctx.stub, "missing")).to.equal(false);
    expect(await readAsset(ctx.stub, "org", "Organization")).to.deep.equal(asset);
    await expect(readAsset(ctx.stub, "missing", "Organization")).to.be.rejectedWith("Organization missing does not exist");

    const historyCtx = createContractContext({
      historyByKey: {
        org: [
          { txId: "A", timestamp: { seconds: { toNumber: () => 1 } }, isDelete: false, value: Buffer.from("{}") },
          { txId: "B", timestamp: { seconds: { low: 2 } }, isDelete: false, value: Buffer.alloc(0) },
          { txId: "C", timestamp: { seconds: 3 }, isDelete: true, value: Buffer.from("{}") },
          { txId: "D", timestamp: {}, isDelete: false, value: Buffer.from("{}") },
        ],
      },
    });
    const history = await buildHistory(historyCtx, "org");
    expect(history.map((item) => item.timestamp)).to.deep.equal([1, 2, 3, 0]);
  });
});
