// Flow contract: organization identity is unique by evidence, supports audited lifecycle changes, and is idempotent only for the same VC.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const OrganizationContract = contractModule.OrganizationContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const ORG_ID = "urn:gdc:test:org:acme";
const DOC_HASH = "unsigned-hash";
const SIGNED_HASH = "signed-hash";

function createContract() {
  return new OrganizationContract();
}

function buildPayload(overrides = {}) {
  return {
    orgId: ORG_ID,
    vc: {
      id: "urn:vc:governance:1",
      proof: [{ type: "JsonWebSignature2020" }],
      credentialSubject: {
        evidence: [{
          digest: [
            { type: "DocumentHash", hashValue: DOC_HASH },
            { type: "SignedDocumentHash", hashValue: SIGNED_HASH },
          ],
        }],
      },
    },
    ...overrides,
  };
}

function buildHistoryItems() {
  return [{
    txId: "TX-1",
    timestamp: { seconds: { toNumber: () => 101 } },
    isDelete: false,
    value: Buffer.from(JSON.stringify({ orgId: ORG_ID })),
  }];
}

describe("OrganizationContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(OrganizationContract);
  });

  it("creates an organization asset with meta.audit and evidence uniqueness index", async () => {
    const ctx = createContractContext({ txSeconds: 1713378604, txId: "TX-ORG-1" });
    const asset = await contract.CreateOrganization(ctx, ORG_ID, JSON.stringify(buildPayload()));

    expect(asset.orgId).to.equal(ORG_ID);
    expect(asset.vc.id).to.equal("urn:vc:governance:1");
    expect(asset.meta.audit).to.deep.equal({
      createdAt: 1713378604,
      updatedAt: 1713378604,
      txId: "TX-ORG-1",
      txTime: 1713378604,
      status: "active",
      version: 1,
    });
    expect(ctx.readJson(ORG_ID)).to.deep.equal(asset);
    expect(ctx.readText(`evidence\u0000${DOC_HASH}\u0000${SIGNED_HASH}`)).to.equal(ORG_ID);
  });

  it("supports aliases, reads, status updates, did upsert, and history", async () => {
    const ctx = createContractContext({
      txSeconds: 200,
      txId: "TX-ORG-2",
      existingState: {
        [ORG_ID]: buildPayload(),
      },
      historyByKey: { [ORG_ID]: buildHistoryItems() },
    });
    const created = await contract.createOrganization(
      createContractContext({ txSeconds: 10, txId: "TX-CREATE" }),
      ORG_ID,
      JSON.stringify(buildPayload()),
    );
    expect(created.meta.audit.version).to.equal(1);
    const viaGetAlias = await contract.GetOrganization(ctx, ORG_ID);
    expect(viaGetAlias.orgId).to.equal(ORG_ID);

    const read = await contract.readOrganization(ctx, ORG_ID);
    expect(read.orgId).to.equal(ORG_ID);

    const updated = await contract.updateOrganizationStatus(ctx, ORG_ID, "suspended", "222");
    expect(updated.meta.audit.status).to.equal("suspended");
    const updatedViaGet = await contract.GetOrganization(ctx, ORG_ID);
    expect(updatedViaGet.meta.audit.status).to.equal("suspended");

    const history = await contract.getOrganizationHistory(ctx, ORG_ID);
    expect(history).to.have.length(1);
    expect(history[0].timestamp).to.equal(101);
    const historyAlias = await contract.GetOrganizationHistory(ctx, ORG_ID);
    expect(historyAlias).to.have.length(1);
    await expect(contract.upsertDidBySector(ctx, ORG_ID, "health-care", "did:web:test", "hash", "sha256", "1"))
      .to.be.rejectedWith("UpsertDidBySector is deprecated. Hosted DID routing does not belong in organization-sc");
  });

  it("rejects duplicates, payload mismatches and duplicate evidence", async () => {
    const existingState = {
      [ORG_ID]: buildPayload(),
      [`evidence\u0000${DOC_HASH}\u0000${SIGNED_HASH}`]: ORG_ID,
    };
    await expect(contract.CreateOrganization(
      createContractContext({ existingState }),
      ORG_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith(`Organization ${ORG_ID} already exists`);

    await expect(contract.CreateOrganization(
      createContractContext(),
      ORG_ID,
      JSON.stringify(buildPayload({ orgId: "urn:other" })),
    )).to.be.rejectedWith(`Payload orgId urn:other does not match ${ORG_ID}`);

    await expect(contract.CreateOrganization(
      createContractContext({ existingState: { [`evidence\u0000${DOC_HASH}\u0000${SIGNED_HASH}`]: ORG_ID } }),
      ORG_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith("EvidenceAlreadyRegistered");
  });

  it("rejects invalid payloads, timestamps, status transitions and missing reads", async () => {
    await expect(contract.CreateOrganization(createContractContext(), ORG_ID, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.CreateOrganization(createContractContext(), ORG_ID, JSON.stringify("bad")))
      .to.be.rejectedWith("payload must be an object");
    await expect(contract.CreateOrganization(createContractContext(), ORG_ID, JSON.stringify({ orgId: ORG_ID })))
      .to.be.rejectedWith("vc is required");
    await expect(contract.CreateOrganization(createContractContext(), ORG_ID, JSON.stringify({ orgId: ORG_ID, vc: [] })))
      .to.be.rejectedWith("vc is required");
    await expect(contract.readOrganization(createContractContext(), ORG_ID))
      .to.be.rejectedWith(`Organization ${ORG_ID} does not exist`);

    const ctx = createContractContext({ existingState: { [ORG_ID]: buildPayload() } });
    await expect(contract.UpdateOrganizationStatus(ctx, ORG_ID, "bad", "1"))
      .to.be.rejectedWith("Invalid status bad. Allowed: active, suspended, revoked");
    await expect(contract.UpdateOrganizationStatus(ctx, ORG_ID, "active", "nan"))
      .to.be.rejectedWith("Invalid timestamp");
    await expect(contract.UpsertDidBySector(ctx, ORG_ID, "health-care", "did:web:test", "hash", "sha256", "1"))
      .to.be.rejectedWith("UpsertDidBySector is deprecated. Hosted DID routing does not belong in organization-sc");
  });

  it("accepts evidence directly on vc.evidence and skips uniqueness index when hashes are incomplete", async () => {
    const ctx = createContractContext({ txSeconds: 500, txId: "TX-ORG-VC-EVIDENCE" });
    const asset = await contract.CreateOrganization(ctx, "urn:gdc:test:org:vc-evidence", JSON.stringify(buildPayload({
      orgId: "urn:gdc:test:org:vc-evidence",
      vc: {
        id: "urn:vc:direct-evidence",
        evidence: [{ digest: [{ type: "SignedDocumentHash", hashValue: "signed-only" }] }],
      },
    })));
    expect(asset.vc.id).to.equal("urn:vc:direct-evidence");
    expect(ctx.writes).to.have.length(1);
  });

  it("ensures an identical organization idempotently and rejects a different VC", async () => {
    const createCtx = createContractContext({ txSeconds: 10, txId: "TX-ORG-ENSURE-CREATE" });
    const created = await contract.EnsureOrganization(createCtx, ORG_ID, JSON.stringify(buildPayload()));
    expect(created).to.deep.equal({ created: true, asset: createCtx.readJson(ORG_ID) });

    const retryCtx = createContractContext({
      txSeconds: 20,
      txId: "TX-ORG-ENSURE-RETRY",
      existingState: {
        [ORG_ID]: created.asset,
        [`evidence\u0000${DOC_HASH}\u0000${SIGNED_HASH}`]: ORG_ID,
      },
    });
    const retried = await contract.ensureOrganization(retryCtx, ORG_ID, JSON.stringify(buildPayload()));
    expect(retried).to.deep.equal({ created: false, asset: created.asset });
    expect(retryCtx.writes).to.have.length(0);

    await expect(contract.EnsureOrganization(
      createContractContext({ existingState: { [ORG_ID]: created.asset } }),
      ORG_ID,
      JSON.stringify(buildPayload({ vc: { id: "urn:vc:different" } })),
    )).to.be.rejectedWith(`ORGANIZATION_CONFLICT:${ORG_ID}`);
    await expect(contract.EnsureOrganization(
      createContractContext(),
      ORG_ID,
      JSON.stringify(buildPayload({ orgId: "urn:other" })),
    )).to.be.rejectedWith(`Payload orgId urn:other does not match ${ORG_ID}`);
    await expect(contract.EnsureOrganization(
      createContractContext(),
      ORG_ID,
      JSON.stringify({ orgId: ORG_ID, vc: [] }),
    )).to.be.rejectedWith("vc is required");
  });
});
