/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const ArtifactEventContract = contractModule.ArtifactEventContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const EVENT_ID = "artifact_1__event_1";
const ARTIFACT_ID = "artifact_1";

function createContract() {
  return new ArtifactEventContract();
}

function buildPayload(overrides = {}) {
  return {
    eventId: EVENT_ID,
    artifactId: ARTIFACT_ID,
    eventType: "validation",
    eventSubType: "oidc4ida-verify",
    actor: "acme-id",
    actorType: "tenant",
    evidenceRef: "zEvidence",
    meta: { attributes: { source: "ica" } },
    ...overrides,
  };
}

describe("ArtifactEventContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(ArtifactEventContract);
  });

  it("creates, reads, lists and returns history for artifact events", async () => {
    const createCtx = createContractContext({ txSeconds: 10, txId: "TX-E-1" });
    const created = await contract.CreateArtifactEvent(createCtx, EVENT_ID, JSON.stringify(buildPayload()));
    expect(created.meta.audit.version).to.equal(1);
    expect(created.meta.attributes).to.deep.equal({ source: "ica" });
    const aliasCreateCtx = createContractContext({ txSeconds: 11, txId: "TX-E-1A" });
    const viaAlias = await contract.createArtifactEvent(aliasCreateCtx, "artifact_1__event_2", JSON.stringify(buildPayload({ eventId: "artifact_1__event_2" })));
    expect(viaAlias.eventId).to.equal("artifact_1__event_2");

    const ctx = createContractContext({
      txSeconds: 20,
      txId: "TX-E-2",
      existingState: {
        [EVENT_ID]: created,
        [`artifact~event\u0000${ARTIFACT_ID}\u0000${EVENT_ID}`]: "",
        [`artifact~event\u0000${ARTIFACT_ID}\u0000`]: "",
      },
      historyByKey: {
        [EVENT_ID]: [{
          txId: "TX-H-1",
          timestamp: { seconds: 44 },
          isDelete: false,
          value: Buffer.from(JSON.stringify(created)),
        }],
      },
    });
    const read = await contract.readArtifactEvent(ctx, EVENT_ID);
    expect(read.artifactId).to.equal(ARTIFACT_ID);
    const readAlias = await contract.ReadArtifactEvent(ctx, EVENT_ID);
    expect(readAlias.eventId).to.equal(EVENT_ID);
    const listed = await contract.listEventsByArtifact(ctx, ARTIFACT_ID);
    expect(listed).to.have.length(1);
    const listedAlias = await contract.ListEventsByArtifact(ctx, ARTIFACT_ID);
    expect(listedAlias).to.have.length(1);
    const history = await contract.getArtifactEventHistory(ctx, EVENT_ID);
    expect(history[0].timestamp).to.equal(44);
    const historyAlias = await contract.GetArtifactEventHistory(ctx, EVENT_ID);
    expect(historyAlias).to.have.length(1);
  });

  it("rejects duplicates and malformed payloads", async () => {
    await expect(contract.CreateArtifactEvent(
      createContractContext({ existingState: { [EVENT_ID]: buildPayload() } }),
      EVENT_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith(`ArtifactEvent ${EVENT_ID} already exists`);

    await expect(contract.CreateArtifactEvent(createContractContext(), EVENT_ID, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.CreateArtifactEvent(createContractContext(), EVENT_ID, JSON.stringify("bad")))
      .to.be.rejectedWith("payload must be an object");
    await expect(contract.CreateArtifactEvent(createContractContext(), EVENT_ID, JSON.stringify(buildPayload({ eventId: "other" }))))
      .to.be.rejectedWith(`Payload eventId other does not match ${EVENT_ID}`);
    await expect(contract.CreateArtifactEvent(createContractContext(), EVENT_ID, JSON.stringify({ eventId: EVENT_ID })))
      .to.be.rejectedWith("artifactId is required");
    await expect(contract.readArtifactEvent(createContractContext(), EVENT_ID))
      .to.be.rejectedWith(`ArtifactEvent ${EVENT_ID} does not exist`);
  });
});
