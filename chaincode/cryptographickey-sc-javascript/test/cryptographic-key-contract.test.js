// Flow contract: cryptographic-key lifecycle remains idempotent for identical opaque material and rejects conflicting custody bindings.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const CryptographicKeyContract = contractModule.CryptographicKeyContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const KEY_ID = "key1";
const ORG_ID = "acme";

function createContract() {
  return new CryptographicKeyContract();
}

function buildPayload(overrides = {}) {
  return {
    keyId: KEY_ID,
    orgId: ORG_ID,
    kid: "kid-1",
    thumbprint: "thumb-1",
    kty: "EC",
    crv: "P-256",
    alg: "ES256",
    use: "sig",
    purpose: "organization-signing",
    origin: "did:web",
    ...overrides,
  };
}

describe("CryptographicKeyContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(CryptographicKeyContract);
  });

  it("registers, batches, reads, lists, filters, updates and returns history", async () => {
    const createCtx = createContractContext({ txSeconds: 10, txId: "TX-K-1" });
    const created = await contract.RegisterKey(createCtx, KEY_ID, JSON.stringify(buildPayload()));
    expect(created.meta.audit.version).to.equal(1);
    const createdAlias = await contract.registerKey(
      createContractContext({ txSeconds: 11, txId: "TX-K-1A" }),
      "key-alias",
      JSON.stringify(buildPayload({ keyId: "key-alias", kid: "kid-alias", thumbprint: "thumb-alias" })),
    );
    expect(createdAlias.keyId).to.equal("key-alias");

    const batchCtx = createContractContext({ txSeconds: 20, txId: "TX-K-2" });
    const batch = await contract.registerKeysBatch(batchCtx, ORG_ID, JSON.stringify([
      { kid: "kid-2", use: "enc", purpose: "organization-encryption", thumbprint: "thumb-2" },
      { keyId: "key3", kid: "kid-3", use: "sig", purpose: "organization-signing" },
    ]));
    expect(batch).to.have.length(2);

    const ctx = createContractContext({
      txSeconds: 30,
      txId: "TX-K-3",
      existingState: {
        [KEY_ID]: created,
        key3: { ...batch[1], status: "suspended" },
        [`${ORG_ID}_thumb-2`]: batch[0],
        [`org~key\u0000${ORG_ID}\u0000${KEY_ID}`]: "",
        [`org~key\u0000${ORG_ID}\u0000${ORG_ID}_thumb-2`]: "",
        [`org~key\u0000${ORG_ID}\u0000key3`]: "",
        [`org~key\u0000${ORG_ID}\u0000`]: "",
      },
      historyByKey: {
        [KEY_ID]: [{
          txId: "TX-H-1",
          timestamp: { seconds: { toNumber: () => 55 } },
          isDelete: false,
          value: Buffer.from(JSON.stringify(created)),
        }],
      },
    });

    const read = await contract.readCryptographicKey(ctx, KEY_ID);
    expect(read.keyId).to.equal(KEY_ID);
    const readAlias = await contract.GetKey(ctx, KEY_ID);
    expect(readAlias.keyId).to.equal(KEY_ID);
    const listed = await contract.listKeysByOrg(ctx, ORG_ID);
    expect(listed).to.have.length(3);
    const listedAlias = await contract.ListKeysByOrg(ctx, ORG_ID);
    expect(listedAlias).to.have.length(3);
    const activeSigning = await contract.listActiveKeysByOrg(ctx, ORG_ID, "sig", "organization-signing");
    expect(activeSigning).to.have.length(1);
    const activeSigningAlias = await contract.ListActiveKeysByOrg(ctx, ORG_ID, "sig", "organization-signing");
    expect(activeSigningAlias).to.have.length(1);
    const activeEnc = await contract.ListActiveKeysByOrg(ctx, ORG_ID, "enc", "organization-encryption");
    expect(activeEnc).to.have.length(1);
    const inactiveByUse = await contract.ListActiveKeysByOrg(ctx, ORG_ID, "enc");
    expect(inactiveByUse).to.have.length(1);
    const mismatchPurpose = await contract.ListActiveKeysByOrg(ctx, ORG_ID, "sig", "organization-encryption");
    expect(mismatchPurpose).to.have.length(0);
    const updated = await contract.updateKeyStatus(ctx, KEY_ID, "suspended", "300");
    expect(updated.status).to.equal("suspended");
    const reactivated = await contract.UpdateKeyStatus(ctx, KEY_ID, "active", "301");
    expect(reactivated.suspendedAt).to.equal(null);
    const revoked = await contract.UpdateKeyStatus(ctx, KEY_ID, "revoked", "302");
    expect(revoked.revokedAt).to.equal(30);
    const expired = await contract.updateKeyStatus(ctx, KEY_ID, "expired", "303");
    expect(expired.expiresAt).to.equal(303);
    const history = await contract.getCryptographicKeyHistory(ctx, KEY_ID);
    expect(history[0].timestamp).to.equal(55);
    const historyAlias = await contract.GetKeyHistory(ctx, KEY_ID);
    expect(historyAlias).to.have.length(1);
  });

  it("rejects duplicates, malformed payloads and invalid batch/status operations", async () => {
    await expect(contract.RegisterKey(
      createContractContext({ existingState: { [KEY_ID]: buildPayload() } }),
      KEY_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith(`CryptographicKey ${KEY_ID} already exists`);

    await expect(contract.RegisterKey(createContractContext(), KEY_ID, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.RegisterKey(createContractContext(), KEY_ID, JSON.stringify("bad")))
      .to.be.rejectedWith("payload must be an object");
    await expect(contract.RegisterKey(createContractContext(), KEY_ID, JSON.stringify({ keyId: KEY_ID })))
      .to.be.rejectedWith("orgId is required");
    await expect(contract.RegisterKey(createContractContext(), KEY_ID, JSON.stringify(buildPayload({ keyId: "other" }))))
      .to.be.rejectedWith(`Payload keyId other does not match ${KEY_ID}`);
    await expect(contract.registerKey(createContractContext(), KEY_ID, JSON.stringify({ keyId: KEY_ID })))
      .to.be.rejectedWith("orgId is required");
    await expect(contract.readCryptographicKey(createContractContext(), KEY_ID))
      .to.be.rejectedWith(`CryptographicKey ${KEY_ID} does not exist`);

    await expect(contract.RegisterKeysBatch(createContractContext(), ORG_ID, JSON.stringify({})))
      .to.be.rejectedWith("keys must be an array");
    await expect(contract.RegisterKeysBatch(createContractContext(), ORG_ID, JSON.stringify([null])))
      .to.be.rejectedWith("Invalid key payload");
    await expect(contract.RegisterKeysBatch(createContractContext(), ORG_ID, JSON.stringify([{ orgId: "other", kid: "k1" }])))
      .to.be.rejectedWith(`Key orgId other does not match ${ORG_ID}`);
    await expect(contract.RegisterKeysBatch(createContractContext(), ORG_ID, JSON.stringify([{ foo: "bar" }])))
      .to.be.rejectedWith("keyId, kid, or thumbprint is required");
    await expect(contract.RegisterKeysBatch(
      createContractContext({ existingState: { key1: buildPayload() } }),
      ORG_ID,
      [{ keyId: "key1", kid: "k1" }],
    )).to.be.rejectedWith("CryptographicKey key1 already exists");

    const ctx = createContractContext({ existingState: { [KEY_ID]: buildPayload() } });
    await expect(contract.UpdateKeyStatus(ctx, KEY_ID, "bad", "1"))
      .to.be.rejectedWith("Invalid status bad. Allowed: active, suspended, revoked, expired");
    await expect(contract.UpdateKeyStatus(ctx, KEY_ID, "active", "nan"))
      .to.be.rejectedWith("Invalid timestamp");
  });

  it("ensures an identical key idempotently and rejects incompatible existing material", async () => {
    const createCtx = createContractContext({ txSeconds: 10, txId: "TX-ENSURE-CREATE" });
    const created = await contract.EnsureKey(createCtx, KEY_ID, JSON.stringify(buildPayload()));
    expect(created).to.deep.equal({ created: true, asset: createCtx.readJson(KEY_ID) });

    const retryCtx = createContractContext({
      txSeconds: 20,
      txId: "TX-ENSURE-RETRY",
      existingState: { [KEY_ID]: created.asset },
    });
    const retried = await contract.ensureKey(retryCtx, KEY_ID, JSON.stringify(buildPayload()));
    expect(retried).to.deep.equal({ created: false, asset: created.asset });
    expect(retryCtx.writes).to.have.length(0);

    await expect(contract.EnsureKey(
      createContractContext({ existingState: { [KEY_ID]: created.asset } }),
      KEY_ID,
      JSON.stringify(buildPayload({ orgId: "other-org" })),
    )).to.be.rejectedWith(`CRYPTOGRAPHIC_KEY_CONFLICT:${KEY_ID}`);
    await expect(contract.EnsureKey(
      createContractContext({ existingState: { [KEY_ID]: created.asset } }),
      KEY_ID,
      JSON.stringify(buildPayload({ thumbprint: "different-thumbprint" })),
    )).to.be.rejectedWith(`CRYPTOGRAPHIC_KEY_CONFLICT:${KEY_ID}`);
  });
});
