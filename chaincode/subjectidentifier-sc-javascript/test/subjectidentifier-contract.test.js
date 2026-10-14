// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
/*
 * Flow contract: the global subject-identifier ledger stores one opaque alias
 * per asset and only the provider DID. It never stores the raw private
 * identifier, card or tenant id. Replays are idempotent and another provider
 * cannot claim the alias.
 */
"use strict";

const chai = require("chai");
chai.use(require("chai-as-promised"));
const { expect } = chai;
const { SubjectIdentifierContract } = require("../index");
const { createContractContext } = require("../../test-support/contract-test-context");

const ASSET_ID = "urn:multibase:zQmWATW6YwRbc2Qfq5Qv7FpC18JNpDutLCRa14Q6gttxyP";
const INDEX_PROVIDER_DID = "did:web:index.vetchain.app";

function payload(indexProviderDid = INDEX_PROVIDER_DID) {
  return JSON.stringify({ indexProviderDid });
}

describe("SubjectIdentifierContract", () => {
  it("creates and reads only the provider DID pointer", async () => {
    const ctx = createContractContext({ txSeconds: 100 });
    const contract = new SubjectIdentifierContract();
    const asset = await contract.UpsertSubjectIdentifier(ctx, ASSET_ID, payload());

    expect(asset).to.deep.equal({
      assetId: ASSET_ID,
      indexProviderDid: INDEX_PROVIDER_DID,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(await contract.ReadSubjectIdentifier(ctx, ASSET_ID)).to.deep.equal(asset);
    expect(JSON.stringify(asset)).not.to.include("card");
    expect(JSON.stringify(asset)).not.to.include("981020000123456");
  });

  it("is idempotent for the same provider DID", async () => {
    const first = {
      assetId: ASSET_ID,
      indexProviderDid: INDEX_PROVIDER_DID,
      createdAt: 10,
      updatedAt: 10,
    };
    const ctx = createContractContext({ existingState: { [ASSET_ID]: first }, txSeconds: 20 });
    const contract = new SubjectIdentifierContract();

    expect(await contract.UpsertSubjectIdentifier(ctx, ASSET_ID, payload())).to.deep.equal(first);
  });

  it("rejects another provider and malformed asset or provider identifiers", async () => {
    const existing = {
      assetId: ASSET_ID,
      indexProviderDid: INDEX_PROVIDER_DID,
      createdAt: 10,
      updatedAt: 10,
    };
    const contract = new SubjectIdentifierContract();
    await expect(contract.UpsertSubjectIdentifier(
      createContractContext(),
      ASSET_ID,
      JSON.stringify({ indexProviderDid: INDEX_PROVIDER_DID, card: "private" }),
    )).to.be.rejectedWith("must contain only indexProviderDid");
    await expect(contract.UpsertSubjectIdentifier(
      createContractContext({ existingState: { [ASSET_ID]: existing } }),
      ASSET_ID,
      JSON.stringify({
        indexProviderDid: "did:web:other.example",
      }),
    )).to.be.rejectedWith("SubjectIdentifierProviderConflict");
    await expect(contract.UpsertSubjectIdentifier(createContractContext(), ASSET_ID, payload("https://index.vetchain.app")))
      .to.be.rejectedWith("indexProviderDid must be a did:web identifier");
    await expect(contract.UpsertSubjectIdentifier(createContractContext(), "12345678Z", payload()))
      .to.be.rejectedWith("assetId must be an urn:multibase value");
  });

  it("deletes current resolution without placing the private identifier in a transaction argument", async () => {
    const existing = {
      assetId: ASSET_ID,
      indexProviderDid: INDEX_PROVIDER_DID,
      createdAt: 10,
      updatedAt: 10,
    };
    const ctx = createContractContext({ existingState: { [ASSET_ID]: existing } });
    const contract = new SubjectIdentifierContract();

    expect(await contract.DeleteSubjectIdentifier(ctx, ASSET_ID, INDEX_PROVIDER_DID)).to.deep.equal({
      assetId: ASSET_ID,
      deleted: true,
    });
    await expect(contract.ReadSubjectIdentifier(ctx, ASSET_ID)).to.be.rejectedWith("does not exist");
  });
});
