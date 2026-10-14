// Flow contract: one subject-key binding remains role-scoped, independently revocable, and linked to canonical assignment evidence.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

/**
 * Flow contract: a subject-key binding is a derived relationship that keeps
 * only a keyId reference and relationship lifecycle. The canonical JWK and key
 * lifecycle remain in cryptographickey-sc, and unrelated key fields must never
 * be copied into this asset.
 */

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const SubjectKeyBindingContract = contractModule.SubjectKeyBindingContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const BINDING_ID = "organization_acme__key1";
const ASSIGNMENT_LINK = "zG9G9MsjjKK3cqYznAg72qrQNQ4gr3EycS8eDSbVya9ymkUfp4wbagzcmJVPqLqarka3b";
const EMPLOYEE_LINK = "zG9EU4AWxfuVgFj41YxQMzyo4Y9neV8zDtN9ZvevfwRaPxYvgFMAvjXsjty9TzEyZAA9r";
const ORGANIZATION_LINK = "zG9LkpGXgpJx42X9w4BYP3FFM9AD8Lunh56NUQcbgfnddnFvU3JUc1iWJ1eNDW6AVE7c2";

function createContract() {
  return new SubjectKeyBindingContract();
}

function buildPayload(overrides = {}) {
  return {
    bindingId: BINDING_ID,
    subjectType: "organization",
    subjectId: "acme",
    parentOrgId: "acme",
    keyId: "key1",
    relationship: "organization-signing",
    meta: { attributes: { channel: "identity-local" } },
    ...overrides,
  };
}

describe("SubjectKeyBindingContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(SubjectKeyBindingContract);
  });

  it("creates, upserts, reads, updates status and returns history", async () => {
    const createCtx = createContractContext({ txSeconds: 10, txId: "TX-B-1" });
    const created = await contract.CreateSubjectKeyBinding(createCtx, BINDING_ID, JSON.stringify(buildPayload()));
    expect(created.meta.audit.version).to.equal(1);
    const aliasCreated = await contract.createSubjectKeyBinding(
      createContractContext({ txSeconds: 11, txId: "TX-B-1A" }),
      "organization_acme__key2",
      JSON.stringify(buildPayload({ bindingId: "organization_acme__key2", keyId: "key2" })),
    );
    expect(aliasCreated.bindingId).to.equal("organization_acme__key2");
    const upsertCreated = await contract.upsertSubjectKeyBinding(
      createContractContext({ txSeconds: 12, txId: "TX-B-1B" }),
      "organization_acme__key3",
      JSON.stringify(buildPayload({ bindingId: "organization_acme__key3", keyId: "key3" })),
    );
    expect(upsertCreated.bindingId).to.equal("organization_acme__key3");

    const ctx = createContractContext({
      txSeconds: 20,
      txId: "TX-B-2",
      existingState: {
        [BINDING_ID]: created,
        [`subject~binding\u0000organization\u0000acme\u0000${BINDING_ID}`]: "",
        [`key~binding\u0000key1\u0000${BINDING_ID}`]: "",
      },
      historyByKey: {
        [BINDING_ID]: [{
          txId: "TX-H-1",
          timestamp: { seconds: { low: 77 } },
          isDelete: false,
          value: Buffer.from(JSON.stringify(created)),
        }],
      },
    });

    const upserted = await contract.upsertSubjectKeyBinding(ctx, BINDING_ID, JSON.stringify(buildPayload({
      status: "suspended",
      meta: { attributes: { reason: "rotation" } },
    })));
    expect(upserted.status).to.equal("suspended");
    expect(upserted.meta.audit.version).to.equal(2);
    expect(upserted.meta.attributes).to.deep.equal({ channel: "identity-local", reason: "rotation" });

    const read = await contract.readSubjectKeyBinding(ctx, BINDING_ID);
    expect(read.bindingId).to.equal(BINDING_ID);
    const readAlias = await contract.ReadSubjectKeyBinding(ctx, BINDING_ID);
    expect(readAlias.bindingId).to.equal(BINDING_ID);

    const updated = await contract.updateBindingStatus(ctx, BINDING_ID, "expired", "300", "sunset", JSON.stringify({ by: "admin" }));
    expect(updated.status).to.equal("expired");
    expect(updated.reason).to.equal("sunset");
    expect(updated.meta.attributes.by).to.equal("admin");
    const revokedWithoutMetadata = await contract.UpdateBindingStatus(ctx, BINDING_ID, "revoked", "301", "offboard");
    expect(revokedWithoutMetadata.status).to.equal("revoked");
    expect(revokedWithoutMetadata.reason).to.equal("offboard");
    const metadataFallbackCtx = createContractContext({
      txSeconds: 21,
      txId: "TX-B-3",
      existingState: {
        binding_plain: { ...created, bindingId: "binding_plain", metadata: "legacy" },
        binding_weird_meta: { ...created, bindingId: "binding_weird_meta", meta: "legacy-meta" },
        binding_weird_attributes: { ...created, bindingId: "binding_weird_attributes", meta: { audit: created.meta.audit, attributes: "legacy-attrs" } },
      },
    });
    const patchedLegacyMetadata = await contract.UpdateBindingStatus(
      metadataFallbackCtx,
      "binding_plain",
      "active",
      "302",
      "",
      JSON.stringify({ patched: true }),
    );
    expect(patchedLegacyMetadata.meta.attributes).to.deep.equal({
      channel: 'identity-local',
      patched: true,
    });
    const patchedWeirdMeta = await contract.UpdateBindingStatus(
      metadataFallbackCtx,
      "binding_weird_meta",
      "active",
      "303",
      "",
      JSON.stringify({ patchedAgain: true }),
    );
    expect(patchedWeirdMeta.meta.attributes).to.deep.equal({ patchedAgain: true });
    const patchedWeirdAttributes = await contract.UpdateBindingStatus(
      metadataFallbackCtx,
      "binding_weird_attributes",
      "active",
      "304",
      "",
      JSON.stringify({ patchedThird: true }),
    );
    expect(patchedWeirdAttributes.meta.attributes).to.deep.equal({ patchedThird: true });
    const historyAlias = await contract.GetSubjectKeyBindingHistory(ctx, BINDING_ID);
    expect(historyAlias).to.have.length(1);

    const history = await contract.getSubjectKeyBindingHistory(ctx, BINDING_ID);
    expect(history[0].timestamp).to.equal(77);
  });

  it("stores a key reference without duplicating cryptographic-key state", async () => {
    const ctx = createContractContext({ txSeconds: 10, txId: "TX-REFERENCE-ONLY" });
    const created = await contract.CreateSubjectKeyBinding(
      ctx,
      BINDING_ID,
      JSON.stringify(buildPayload({
        publicKeyJwk: { kty: "AKP", alg: "ML-DSA-44", pub: "must-not-be-copied" },
        thumbprint: "urn:jwk:must-not-be-copied",
        alg: "ML-DSA-44",
        use: "sig",
        keyStatus: "revoked",
      })),
    );

    expect(created.keyId).to.equal("key1");
    expect(created).not.to.have.property("publicKeyJwk");
    expect(created).not.to.have.property("thumbprint");
    expect(created).not.to.have.property("alg");
    expect(created).not.to.have.property("use");
    expect(created).not.to.have.property("keyStatus");
    expect(created.status).to.equal("active");
  });

  it("joins a professional key binding to the opaque assignment graph", async () => {
    const contract = createContract();
    const ctx = createContractContext({ txSeconds: 10, txId: "TX-PROFESSIONAL-LINK" });
    const created = await contract.CreateSubjectKeyBinding(ctx, BINDING_ID, JSON.stringify(buildPayload({
      professionalAssignmentLink: ASSIGNMENT_LINK,
      employeeLink: EMPLOYEE_LINK,
      organizationLink: ORGANIZATION_LINK,
    })));
    expect(created.professionalAssignmentLink).to.equal(ASSIGNMENT_LINK);
    expect(created.employeeLink).to.equal(EMPLOYEE_LINK);
    expect(created.organizationLink).to.equal(ORGANIZATION_LINK);

    for (const field of ["professionalAssignmentLink", "employeeLink", "organizationLink"]) {
      await expect(contract.CreateSubjectKeyBinding(
        createContractContext(),
        `${BINDING_ID}-${field}`,
        JSON.stringify(buildPayload({ bindingId: `${BINDING_ID}-${field}`, [field]: "urn:uuid:41b2c3d4-e5f6-4890-9234-567890abcdef" })),
      )).to.be.rejectedWith(`${field} must be an opaque multibase or CID value`);
    }

    const existingCtx = createContractContext({ existingState: { [BINDING_ID]: created }, txSeconds: 20 });
    await expect(contract.UpsertSubjectKeyBinding(
      existingCtx,
      BINDING_ID,
      JSON.stringify(buildPayload({ professionalAssignmentLink: EMPLOYEE_LINK })),
    )).to.be.rejectedWith("professionalAssignmentLink cannot change for an existing subject-key binding");

    const optional = await contract.CreateSubjectKeyBinding(
      createContractContext({ txSeconds: 30 }),
      `${BINDING_ID}-optional`,
      JSON.stringify(buildPayload({ bindingId: `${BINDING_ID}-optional`, professionalAssignmentLink: "", employeeLink: null })),
    );
    expect(optional.professionalAssignmentLink).to.equal(undefined);
    expect(optional.employeeLink).to.equal(undefined);
  });

  it("rejects duplicates, malformed payloads and invalid status operations", async () => {
    await expect(contract.CreateSubjectKeyBinding(
      createContractContext({ existingState: { [BINDING_ID]: buildPayload() } }),
      BINDING_ID,
      JSON.stringify(buildPayload()),
    )).to.be.rejectedWith(`SubjectKeyBinding ${BINDING_ID} already exists`);

    await expect(contract.CreateSubjectKeyBinding(createContractContext(), BINDING_ID, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.CreateSubjectKeyBinding(createContractContext(), BINDING_ID, JSON.stringify("bad")))
      .to.be.rejectedWith("payload must be an object");
    await expect(contract.CreateSubjectKeyBinding(createContractContext(), BINDING_ID, JSON.stringify(buildPayload({ bindingId: "other" }))))
      .to.be.rejectedWith(`Payload bindingId other does not match ${BINDING_ID}`);
    await expect(contract.CreateSubjectKeyBinding(createContractContext(), BINDING_ID, JSON.stringify({ bindingId: BINDING_ID })))
      .to.be.rejectedWith("subjectType, subjectId, and keyId are required");
    await expect(contract.readSubjectKeyBinding(createContractContext(), BINDING_ID))
      .to.be.rejectedWith(`SubjectKeyBinding ${BINDING_ID} does not exist`);

    const ctx = createContractContext({ existingState: { [BINDING_ID]: buildPayload() } });
    await expect(contract.UpdateBindingStatus(ctx, BINDING_ID, "bad", "1"))
      .to.be.rejectedWith("Invalid status bad. Allowed: active, suspended, revoked, expired");
    await expect(contract.UpdateBindingStatus(ctx, BINDING_ID, "active", "nan"))
      .to.be.rejectedWith("Invalid timestamp");
    await expect(contract.UpdateBindingStatus(ctx, BINDING_ID, "active", "1", "", "{"))
      .to.be.rejected;
  });
});
