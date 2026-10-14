// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// One primary-document data[] is processed atomically into one
// CID-keyed asset per entry; the chaincode strips claims and display text and
// never stores fullUrl or a clinical FHIR resource.
// TDD contract: write this test red first; make it green only with the complete real behavior.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const ArtifactContract = contractModule.ArtifactContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const ARTIFACT_ID = "artifact_sha256_abc";
const AUTHOR_HASH = "zG9EU4AWxfuVgFj41YxQMzyo4Y9neV8zDtN9ZvevfwRaPxYvgFMAvjXsjty9TzEyZAA9r";
const ATTESTER_HASH_A = "zG9G9MsjjKK3cqYznAg72qrQNQ4gr3EycS8eDSbVya9ymkUfp4wbagzcmJVPqLqarka3b";
const ATTESTER_HASH_B = "zG9HKYPu8qh5USBq9XsKuAWXiva5mUJq5VyDGiYGrcg47vqQcYwYxewQXpWi615DECCUo";
const SENDER_HASH = "zG9LkpGXgpJx42X9w4BYP3FFM9AD8Lunh56NUQcbgfnddnFvU3JUc1iWJ1eNDW6AVE7c2";
const SUBJECT_OWNER_HASH = "zG9LFngYGXvtM2WgPEvyNKfw2v9DcDm2fxLJN8wv8FHLZkKcCDhu56efu5AE8ZKqd5xXm";
const RAW_IDENTITY_REFERENCE = "did:web:identity.example";

function createContract() {
  return new ArtifactContract();
}

function buildPayload(overrides = {}) {
  return {
    artifactId: ARTIFACT_ID,
    hash: "abc",
    hashAlg: "sha256",
    artifactType: "pdf",
    declaredBy: "acme-id",
    declaredByType: "tenant",
    meta: { attributes: { source: "pdf" } },
    ...overrides,
  };
}

describe("ArtifactContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(ArtifactContract);
  });

  it("registers each code-only ResearchAsset before its VersionAsset marked research=true", async () => {
    const ctx = createContractContext({ txSeconds: 10, txId: "TX-RESEARCH-1" });
    const payload = { data: [{
      researchAsset: {
        type: "ResearchAsset",
        id: "8c942c42-6d54-4f76-97ef-058953b20001",
        resource: {
          resourceType: "ResearchAsset",
          meta: { tag: [{ id: "MedicationStatement.code", system: "http://snomed.info/sct", code: "108575001" }] },
        },
      },
      versionAsset: {
        type: "VersionAsset",
        id: "8c942c42-6d54-4f76-97ef-058953b20002",
        resource: {
          resourceType: "VersionAsset",
          parent: "8c942c42-6d54-4f76-97ef-058953b20001",
          research: true,
        },
      },
    }] };

    const result = await contract.UpsertResearchVersions(ctx, JSON.stringify(payload));

    expect(result.data.map((entry) => entry.type)).to.deep.equal(["ResearchAsset", "VersionAsset"]);
    const researchAsset = ctx.readJson(payload.data[0].researchAsset.id);
    const versionAsset = ctx.readJson(payload.data[0].versionAsset.id);
    expect(researchAsset.meta.attributes.tag).to.deep.equal(payload.data[0].researchAsset.resource.meta.tag);
    expect(JSON.stringify(researchAsset)).not.to.match(/text|display/i);
    expect(versionAsset.meta.attributes).to.deep.equal({
      parent: payload.data[0].researchAsset.id,
      research: true,
    });
    expect(ctx.writes.filter(({ key }) => !key.startsWith("cid~artifact"))
      .map(({ key }) => key)).to.deep.equal([
        payload.data[0].researchAsset.id,
        payload.data[0].versionAsset.id,
      ]);

    const replayCtx = createContractContext({
      txSeconds: 11,
      txId: "TX-RESEARCH-2",
      existingState: {
        [payload.data[0].researchAsset.id]: researchAsset,
        [payload.data[0].versionAsset.id]: versionAsset,
      },
    });
    const replay = await contract.upsertResearchVersions(replayCtx, JSON.stringify(payload));
    expect(replay.data[0].resource.meta.audit.version).to.equal(2);
    expect(replay.data[1].resource.meta.audit.version).to.equal(2);
  });

  it("rejects malformed, identifying, uncoded, or unlinked research asset pairs", async () => {
    const valid = {
      researchAsset: {
        type: "ResearchAsset",
        id: "8c942c42-6d54-4f76-97ef-058953b20001",
        resource: {
          resourceType: "ResearchAsset",
          meta: { tag: [{ id: "Observation.code", system: "http://loinc.org", code: "8310-5" }] },
        },
      },
      versionAsset: {
        type: "VersionAsset",
        id: "8c942c42-6d54-4f76-97ef-058953b20002",
        resource: {
          resourceType: "VersionAsset",
          parent: "8c942c42-6d54-4f76-97ef-058953b20001",
          research: true,
        },
      },
    };
    const reject = async (entry, message) => expect(
      contract.UpsertResearchVersions(createContractContext(), JSON.stringify({ data: [entry] })),
    ).to.be.rejectedWith(message);

    await expect(contract.UpsertResearchVersions(createContractContext(), JSON.stringify({ data: [] })))
      .to.be.rejectedWith("payload.data must be a non-empty array");
    for (const researchAsset of [undefined, null, [], {}, { ...valid.researchAsset, type: "VersionAsset" }, { ...valid.researchAsset, resource: {} }]) {
      await reject({ ...valid, researchAsset }, "researchAsset must be a ResearchAsset");
    }
    for (const versionAsset of [undefined, null, [], {}, { ...valid.versionAsset, type: "ResearchAsset" }, { ...valid.versionAsset, resource: {} }]) {
      await reject({ ...valid, versionAsset }, "versionAsset must be a VersionAsset");
    }
    await reject({ ...valid, researchAsset: { ...valid.researchAsset, id: "source-resource-id" } }, "asset ids must be opaque UUIDs");
    await reject({ ...valid, versionAsset: { ...valid.versionAsset, id: "source-version-id" } }, "asset ids must be opaque UUIDs");
    await reject({ ...valid, researchAsset: { ...valid.researchAsset, id: undefined } }, "asset ids must be opaque UUIDs");
    await reject({ ...valid, versionAsset: { ...valid.versionAsset, id: undefined } }, "asset ids must be opaque UUIDs");
    await reject({ ...valid, versionAsset: { ...valid.versionAsset, resource: { ...valid.versionAsset.resource, parent: "8c942c42-6d54-4f76-97ef-058953b29999" } } }, "parent must equal researchAsset.id");
    await reject({ ...valid, versionAsset: { ...valid.versionAsset, resource: { ...valid.versionAsset.resource, research: false } } }, "research must equal true");
    await reject({ ...valid, researchAsset: { ...valid.researchAsset, resource: { ...valid.researchAsset.resource, meta: {} } } }, "meta.tag must contain at least one code");
    for (const tag of [null, [], "code", {}, { id: "Observation.code" }, { id: "Observation.code", system: "http://loinc.org" }, { id: "Observation.code-text", system: "http://loinc.org", code: "8310-5" }, { id: "Observation.name", system: "http://loinc.org", code: "8310-5" }, { id: "Observation.code", system: "not-a-uri", code: "8310-5" }]) {
      const expected = tag === null || Array.isArray(tag) || typeof tag !== "object"
        ? "must be an object"
        : "must contain code-only id, system and code";
      await reject({
        ...valid,
        researchAsset: {
          ...valid.researchAsset,
          resource: { ...valid.researchAsset.resource, meta: { tag: [tag] } },
        },
      }, expected);
    }
    await reject({
      ...valid,
      researchAsset: {
        ...valid.researchAsset,
        resource: { ...valid.researchAsset.resource, meta: { tag: [{ id: "Observation.code", code: "8310-5" }] } },
      },
    }, "must contain code-only id, system and code");
  });

  it("creates, upserts, reads and returns history for artifact assets", async () => {
    const createCtx = createContractContext({ txSeconds: 11, txId: "TX-A-1" });
    const created = await contract.CreateArtifact(createCtx, ARTIFACT_ID, JSON.stringify(buildPayload({ cid: "bafy123" })));
    expect(created.meta.audit.version).to.equal(1);
    expect(createCtx.readText("cid~artifact\u0000bafy123\u0000artifact_sha256_abc")).to.equal("");

    const upsertCtx = createContractContext({
      txSeconds: 22,
      txId: "TX-A-2",
      existingState: { [ARTIFACT_ID]: created, "cid~artifact\u0000bafy123\u0000artifact_sha256_abc": "" },
      historyByKey: {
        [ARTIFACT_ID]: [{
          txId: "TX-H-1",
          timestamp: { seconds: { low: 99 } },
          isDelete: false,
          value: Buffer.from(JSON.stringify(created)),
        }],
      },
    });
    const upserted = await contract.upsertArtifact(upsertCtx, ARTIFACT_ID, JSON.stringify(buildPayload({
      status: "validated",
      validationCount: 2,
      meta: { attributes: { verifiedBy: "ica" } },
    })));
    expect(upserted.status).to.equal("validated");
    expect(upserted.validationCount).to.equal(2);
    expect(upserted.meta.audit.version).to.equal(2);
    expect(upserted.meta.attributes).to.deep.equal({ source: "pdf", verifiedBy: "ica" });

    const read = await contract.readArtifact(upsertCtx, ARTIFACT_ID);
    expect(read.artifactId).to.equal(ARTIFACT_ID);
    const readAlias = await contract.ReadArtifact(upsertCtx, ARTIFACT_ID);
    expect(readAlias.artifactId).to.equal(ARTIFACT_ID);
    const history = await contract.getArtifactHistory(upsertCtx, ARTIFACT_ID);
    expect(history[0].timestamp).to.equal(99);
    const historyAlias = await contract.GetArtifactHistory(upsertCtx, ARTIFACT_ID);
    expect(historyAlias).to.have.length(1);
  });

  it("preserves hashed relationships and ownerships for every resource in one compatible batch", async () => {
    const ctx = createContractContext({ txSeconds: 44, txId: "TX-A-BATCH" });
    const data = [
      {
        type: "Observation",
        id: "bafy-observation-version",
        resource: {
          resourceType: "Observation",
          meta: { versionId: "bafy-observation-version" },
        },
        relationships: {
          author: [AUTHOR_HASH],
          attester: [ATTESTER_HASH_A, ATTESTER_HASH_B],
          sender: [SENDER_HASH],
        },
        ownerships: [SUBJECT_OWNER_HASH],
      },
    ];

    const result = await contract.UpsertArtifacts(ctx, JSON.stringify({ data }));

    expect(result.data[0].resource.relationships).to.deep.equal(data[0].relationships);
    expect(result.data[0].resource.ownerships).to.deep.equal(data[0].ownerships);
    const stored = JSON.parse(ctx.readText(data[0].id));
    expect(stored.relationships).to.deep.equal(data[0].relationships);
    expect(stored.ownerships).to.deep.equal(data[0].ownerships);

    const csvCtx = createContractContext({ txSeconds: 45, txId: "TX-A-BATCH-CSV" });
    const csvResult = await contract.UpsertArtifacts(csvCtx, JSON.stringify({
      data: [{
        ...data[0],
        id: "bafybatchcsv",
        resource: { ...data[0].resource, meta: { versionId: "bafybatchcsv" } },
        relationships: { author: `${AUTHOR_HASH}, ${AUTHOR_HASH},` },
        ownerships: [],
      }],
    }));
    expect(csvResult.data[0].resource.relationships).to.deep.equal({ author: [AUTHOR_HASH] });
    expect(csvResult.data[0].resource.ownerships).to.equal(undefined);

    for (const relationships of [null, "not-an-object", [AUTHOR_HASH]]) {
      await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
        data: [{ ...data[0], relationships }],
      }))).to.be.rejectedWith("data[0].relationships must be an object");
    }
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], relationships: { author: [RAW_IDENTITY_REFERENCE] } }],
    }))).to.be.rejectedWith("data[0].relationships.author must contain only opaque multibase or CID values");
    const emptyRelationships = await contract.UpsertArtifacts(
      createContractContext({ txSeconds: 46, txId: "TX-A-BATCH-EMPTY" }),
      JSON.stringify({ data: [{ ...data[0], id: "bafybatchempty", resource: { ...data[0].resource, meta: { versionId: "bafybatchempty" } }, relationships: { author: [] } }] }),
    );
    expect(emptyRelationships.data[0].resource.relationships).to.equal(undefined);
  });

  it("processes every data entry as an individual CID-keyed asset in one batch", async () => {
    const ctx = createContractContext({ txSeconds: 12, txId: "TX-A-BATCH" });
    const data = [
      { type: "Observation", id: "bafy-observation-1", resource: { resourceType: "Observation", meta: { versionId: "bafy-observation-1", claims: { "Observation.code": "85354-9", "Observation.code-display": "must stay private" }, tag: [
        { id: "Observation[0].code", system: "http://loinc.org", code: "85354-9", version: "2.78", userSelected: true, display: "must stay private" },
        { id: "Observation[0].category" },
      ] } } },
      { type: "Condition", id: "bafy-condition-1", resource: { resourceType: "Condition", meta: { versionId: "bafy-condition-1" } } },
    ];

    const result = await contract.UpsertArtifacts(ctx, JSON.stringify({ data }));

    expect(result.data).to.have.length(2);
    expect(ctx.readJson("bafy-observation-1").artifactId).to.equal("bafy-observation-1");
    expect(ctx.readJson("bafy-condition-1").artifactId).to.equal("bafy-condition-1");
    expect(ctx.readJson("bafy-observation-1")).not.to.have.any.keys("fullUrl", "resource");
    expect(ctx.readJson("bafy-observation-1").meta.attributes.tag).to.deep.equal([
      { id: "Observation[0].code", system: "http://loinc.org", code: "85354-9", version: "2.78", userSelected: true },
      { id: "Observation[0].category" },
    ]);
    expect(ctx.readJson("bafy-observation-1").meta.attributes).not.to.have.property("claims");
    expect(ctx.writes.filter(({ key }) => !key.startsWith("cid~artifact"))).to.have.length(2);

    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], fullUrl: "urn:uuid:not-ledger-safe" }],
    }))).to.be.rejectedWith("data[0].fullUrl is not allowed");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], id: "different-cid" }],
    }))).to.be.rejectedWith("data[0].id must equal resource.meta.versionId");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ type: data[0].type, resource: data[0].resource }],
    }))).to.be.rejectedWith("data[0].id must equal resource.meta.versionId");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [] })))
      .to.be.rejectedWith("payload.data must be a non-empty array");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [null] })))
      .to.be.rejectedWith("data[0] must be an object");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [{ ...data[0], type: "Condition" }] })))
      .to.be.rejectedWith("data[0].type must equal resource.resourceType");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ id: data[0].id, resource: data[0].resource }],
    }))).to.be.rejectedWith("data[0].type must equal resource.resourceType");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({ data: [{ ...data[0], resource: null }] })))
      .to.be.rejectedWith("data[0].resource must be an object");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], resource: { ...data[0].resource, fullUrl: "urn:uuid:not-ledger-safe" } }],
    }))).to.be.rejectedWith("data[0].resource.fullUrl is not allowed");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], resource: { meta: data[0].resource.meta } }],
    }))).to.be.rejectedWith("data[0].resource.resourceType is required");
    await expect(contract.UpsertArtifacts(ctx, JSON.stringify({
      data: [{ ...data[0], resource: { resourceType: data[0].resource.resourceType } }],
    }))).to.be.rejectedWith("data[0].resource.meta.versionId is required");

    const minimalCid = "bafy-minimal";
    const minimal = {
      data: [{
        type: "Observation",
        id: minimalCid,
        resource: { resourceType: "Observation", meta: { versionId: minimalCid } },
      }],
    };
    const first = await contract.upsertArtifacts(ctx, JSON.stringify(minimal));
    const second = await contract.UpsertArtifacts(ctx, JSON.stringify(minimal));
    expect(first.data[0].resource.meta.audit.version).to.equal(1);
    expect(second.data[0].resource.meta.audit.version).to.equal(2);
  });

  it("creates through upsert when missing and rejects duplicates or invalid payloads", async () => {
    const missingCtx = createContractContext({ txSeconds: 33, txId: "TX-A-3" });
    const created = await contract.UpsertArtifact(missingCtx, ARTIFACT_ID, JSON.stringify(buildPayload()));
    expect(created.meta.audit.version).to.equal(1);
    const createdAlias = await contract.createArtifact(createContractContext({ txSeconds: 34, txId: "TX-A-4" }), "artifact_alias", JSON.stringify(buildPayload({ artifactId: "artifact_alias", cid: "cid-alias" })));
    expect(createdAlias.artifactId).to.equal("artifact_alias");

    await expect(contract.CreateArtifact(
      createContractContext({ existingState: { [ARTIFACT_ID]: buildPayload() } }),
      ARTIFACT_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith(`Artifact ${ARTIFACT_ID} already exists`);

    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, JSON.stringify("bad")))
      .to.be.rejectedWith("payload must be an object");
    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, JSON.stringify(buildPayload({ artifactId: "other" }))))
      .to.be.rejectedWith("Payload artifactId other does not match artifact_sha256_abc");
    await expect(contract.CreateArtifact(createContractContext(), ARTIFACT_ID, JSON.stringify({ artifactId: ARTIFACT_ID })))
      .to.be.rejectedWith("hash or cid is required");
    await expect(contract.readArtifact(createContractContext(), ARTIFACT_ID))
      .to.be.rejectedWith(`Artifact ${ARTIFACT_ID} does not exist`);
  });
});
