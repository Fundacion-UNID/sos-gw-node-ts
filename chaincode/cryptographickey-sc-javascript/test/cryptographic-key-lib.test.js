// Flow contract: cryptographic-key helpers preserve deterministic key assets, lifecycle audit data, indexes, and history.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const { expect } = require("chai");

const existsAsset = require("../lib/exists");
const { buildHistory, getTxTimestampSeconds } = require("../lib/history");
const { buildStoredCryptographicKeyAsset } = require("../lib/cryptographic-key-asset");
const readAsset = require("../lib/read");
const { assertStatus, buildAudit, parseJson, parseJsonArray, resolveKeyId } = require("../lib/utils");
const writeJsonAsset = require("../lib/write");
const { createContractContext } = require("../../test-support/contract-test-context");

describe("cryptographickey lib helpers", () => {
  it("covers parse, array parse, status validation, key resolution, write/read/exists, timestamps and history", async () => {
    expect(() => parseJson("", "payload")).to.throw("payload is required");
    expect(() => parseJson(JSON.stringify([]), "payload")).to.throw("payload must be an object");
    expect(parseJson({ value: "already-decoded" }, "payload")).to.deep.equal({ value: "already-decoded" });
    expect(() => parseJsonArray("", "keys")).to.throw("keys is required");
    expect(() => parseJsonArray(JSON.stringify({}), "keys")).to.throw("keys must be an array");
    expect(() => assertStatus("bad")).to.throw("Invalid status bad. Allowed: active, suspended, revoked, expired");
    expect(resolveKeyId("org", { keyId: "k1" })).to.equal("k1");
    expect(resolveKeyId("org", { kid: "k2" })).to.equal("org_k2");
    expect(resolveKeyId("org", { thumbprint: "t3" })).to.equal("org_t3");
    expect(() => resolveKeyId("org", {})).to.throw("keyId, kid, or thumbprint is required");

    const ctx = createContractContext({ txSeconds: 12, txId: "TX-K-LIB" });
    const asset = buildStoredCryptographicKeyAsset(ctx, "k1", "org", { kid: "kid-1" });
    expect(asset.meta.audit).to.deep.equal(buildAudit(ctx, undefined, "active", true));
    expect(getTxTimestampSeconds(ctx.stub)).to.equal(12);
    expect(getTxTimestampSeconds(createContractContext({ txSeconds: { toNumber: () => 13 } }).stub)).to.equal(13);
    const assetWithoutKid = buildStoredCryptographicKeyAsset(ctx, "k0", "org", {});
    expect(assetWithoutKid.kid).to.equal(undefined);

    const previousAsset = {
      createdAt: 1,
      kid: "kid-prev",
      thumbprint: "thumb-prev",
      suspendedAt: 4,
      revokedAt: 5,
      meta: { audit: { createdAt: 1, version: 0, status: "active" } },
    };
    const suspended = buildStoredCryptographicKeyAsset(ctx, "k2", "org", { status: "suspended" }, previousAsset);
    expect(suspended.kid).to.equal("kid-prev");
    expect(suspended.thumbprint).to.equal("thumb-prev");
    expect(suspended.suspendedAt).to.equal(12);
    const revoked = buildStoredCryptographicKeyAsset(ctx, "k2", "org", { status: "revoked" }, previousAsset);
    expect(revoked.revokedAt).to.equal(12);
    const activeReset = buildStoredCryptographicKeyAsset(ctx, "k2", "org", { status: "active" }, previousAsset);
    expect(activeReset.suspendedAt).to.equal(null);
    expect(activeReset.revokedAt).to.equal(null);
    const auditFromPrevious = buildAudit(ctx, { createdAt: 2 }, "active", false);
    expect(auditFromPrevious.createdAt).to.equal(2);
    expect(auditFromPrevious.version).to.equal(2);
    const auditFromVersionless = buildAudit(ctx, {}, "active", false);
    expect(auditFromVersionless.version).to.equal(2);

    await writeJsonAsset(ctx.stub, "k1", asset);
    expect(await existsAsset(ctx.stub, "k1")).to.equal(true);
    const stored = await readAsset(ctx.stub, "k1", "CryptographicKey");
    expect(stored.keyId).to.equal("k1");
    expect(stored.orgId).to.equal("org");
    expect(stored.kid).to.equal("kid-1");
    expect(stored.meta.audit.version).to.equal(1);
    await expect(readAsset(ctx.stub, "missing", "CryptographicKey")).to.be.rejectedWith("CryptographicKey missing does not exist");

    const history = await buildHistory(createContractContext({
      historyByKey: {
        k1: [
          { txId: "A", timestamp: { seconds: { toNumber: () => 1 } }, isDelete: false, value: Buffer.from("{}") },
          { txId: "B", timestamp: { seconds: { low: 2 } }, isDelete: true, value: Buffer.from("") },
          { txId: "C", timestamp: {}, isDelete: false, value: Buffer.from("{}") },
          { txId: "D", timestamp: { seconds: 3 }, isDelete: false, value: Buffer.from("{}") },
        ],
      },
    }), "k1");
    expect(history[0].timestamp).to.equal(1);
    expect(history[1].timestamp).to.equal(2);
    expect(history[1].value).to.equal(null);
    expect(history[2].timestamp).to.equal(0);
    expect(history[3].timestamp).to.equal(3);
  });
});
