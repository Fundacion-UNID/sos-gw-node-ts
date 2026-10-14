// Flow contract: create, read, update, no-op/upsert, history and existence must preserve one sanitized claims-first ConsentAccess asset.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;

const contractModule = require("../index");
const ConsentAccessContract = contractModule.ConsentAccessContract;
const { CONSENT_ACCESS_CLAIMS, CONSENT_ACCESS_ASSET_TYPE } = require("../lib/constants");
const {
  sanitizeConsentAccessEntry,
  sanitizeConsentAccessPrimaryDocument,
} = require("../lib/consent-access-asset");
const { createContractContext } = require("./support/contract-test-context");
const {
  buildExpectedAudit,
  buildPrimaryDocumentPayload,
  buildRuleClaims,
  buildRuleEntry,
  buildStoredConsentAccessAsset,
  hashReference,
  TEST_IDENTIFIERS,
  TEST_REFERENCES,
  TEST_RULE_VALUES,
  TEST_TIMESTAMPS,
} = require("./support/consent-access-test-data");

const INVALID_PAYLOAD_LITERAL = "bad-payload";

/**
 * Returns a ready-to-use contract instance for each scenario.
 *
 * Keeping this helper explicit makes the test easier to scan for developers
 * who are not familiar with Fabric or Mocha.
 *
 * @returns {ConsentAccessContract}
 */
function createContract() {
  return new ConsentAccessContract();
}

/**
 * Creates the compact history fixtures consumed by the blockchain history test.
 *
 * @returns {Array<Record<string, unknown>>}
 */
function buildHistoryItems() {
  return [
    {
      txId: "TX-1",
      timestamp: { seconds: { toNumber: () => 101 } },
      isDelete: false,
      value: Buffer.from(JSON.stringify({ id: "A" })),
    },
    {
      txId: "TX-2",
      timestamp: { seconds: { low: 202 } },
      isDelete: false,
      value: Buffer.alloc(0),
    },
    {
      txId: "TX-3",
      timestamp: { seconds: 303 },
      isDelete: true,
      value: Buffer.from(JSON.stringify({ id: "C" })),
    },
    {
      txId: "TX-4",
      timestamp: {},
      isDelete: false,
      value: Buffer.from(JSON.stringify({ id: "D" })),
    },
  ];
}

describe("ConsentAccessContract", () => {
  let contract;

  beforeEach(() => {
    contract = createContract();
  });

  /**
   * Entrypoint smoke test.
   *
   * A junior developer should be able to confirm here that the package exports
   * exactly one Fabric contract and that the class under test is the same one
   * registered in `index.js`.
   */
  it("exports the contract entrypoint", () => {
    expect(contractModule.contracts).to.have.length(1);
    expect(contractModule.contracts[0]).to.equal(ConsentAccessContract);
  });

  /**
   * The consent-specific asset wrapper should stay tiny and predictable:
   * it reuses the generic primary-document sanitizer while injecting the
   * consent-specific configuration.
   */
  it("exposes thin consent-specific wrappers around the generic primary-document sanitizers", () => {
    const inputEntry = buildRuleEntry();

    expect(sanitizeConsentAccessEntry(inputEntry)).to.deep.equal(
      buildStoredConsentAccessAsset().data[0],
    );
    expect(sanitizeConsentAccessPrimaryDocument(buildPrimaryDocumentPayload())).to.deep.equal(
      buildStoredConsentAccessAsset().data,
    );
  });

  /**
   * Main happy path for `CreateConsentAccess`.
   *
   * This test documents the full contract in one place:
   * - the input is a primary document with `data[]`
   * - disallowed claims disappear
   * - plain references are hashed
   * - audit metadata is authored by the smart contract
   * - the final asset is written to world state
   */
  it("creates a sanitized consent access bundle and writes it to state", async () => {
    const ctx = createContractContext({
      txSeconds: TEST_TIMESTAMPS.Create,
      txId: TEST_IDENTIFIERS.NewTransactionId,
    });

    const asset = await contract.CreateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    );

    expect(asset.id).to.equal(TEST_IDENTIFIERS.AssetId);
    expect(asset.type).to.equal(CONSENT_ACCESS_ASSET_TYPE);
    expect(asset.data).to.have.length(1);
    expect(asset.data[0].resource.meta.claims).to.deep.equal({
      [CONSENT_ACCESS_CLAIMS.Context]: "org.hl7.fhir.api",
      [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.DefaultAction,
      [CONSENT_ACCESS_CLAIMS.ActorRole]: TEST_RULE_VALUES.ActorRole,
      [CONSENT_ACCESS_CLAIMS.EventBasedOn]: TEST_REFERENCES.ContentAddressed,
      [CONSENT_ACCESS_CLAIMS.SourceReference]: hashReference(TEST_REFERENCES.Url),
    });
    expect(asset.meta.audit).to.deep.equal(buildExpectedAudit());
    expect(ctx.writes).to.have.length(1);
    expect(ctx.readStoredAsset()).to.deep.equal(asset);
  });

  /**
   * Compatibility test for the lowercase create alias.
   */
  it("creates through the lowercase alias and preserves explicit revoked status", async () => {
    const ctx = createContractContext({
      txSeconds: { toNumber: () => TEST_TIMESTAMPS.CreateAlias },
      txId: TEST_IDENTIFIERS.AliasTransactionId,
    });

    const asset = await contract.createConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload({
        status: TEST_RULE_VALUES.RevokedStatus,
      })),
    );

    expect(asset.meta.audit.status).to.equal(TEST_RULE_VALUES.RevokedStatus);
    expect(asset.meta.audit.createdAt).to.equal(TEST_TIMESTAMPS.CreateAlias);
    expect(asset.meta.audit.version).to.equal(1);
  });

  /**
   * Duplicate protection must reject writes when the asset already exists.
   */
  it("rejects duplicate create requests", async () => {
    const ctx = createContractContext({
      existingState: {
        [TEST_IDENTIFIERS.AssetId]: buildPrimaryDocumentPayload(),
      },
      txSeconds: TEST_TIMESTAMPS.Create,
    });

    await expect(contract.CreateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    )).to.be.rejectedWith(`ConsentAccess ${TEST_IDENTIFIERS.AssetId} already exists`);
  });

  /**
   * Validation matrix for malformed payloads.
   *
   * This reads like a checklist for newcomers: each failing branch describes
   * one contract precondition.
   */
  it("rejects invalid payloads and unsupported entry shapes", async () => {
    const ctx = createContractContext({ txSeconds: TEST_TIMESTAMPS.Create });

    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, ""))
      .to.be.rejectedWith("payload is required");
    await expect(contract.CreateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(INVALID_PAYLOAD_LITERAL),
    )).to.be.rejectedWith("payload must be an object");
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify([])))
      .to.be.rejectedWith("payload.data must be a non-empty array");
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({ data: [] })))
      .to.be.rejectedWith("payload.data must be a non-empty array");
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({ data: [null] })))
      .to.be.rejectedWith("Each data entry must be an object");
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({
      data: [{ type: "ConsentAccessRule" }],
    }))).to.be.rejectedWith("Each data entry must have an id");
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({
      data: [{ id: TEST_IDENTIFIERS.RuleId }],
    }))).to.be.rejectedWith(`Entry ${TEST_IDENTIFIERS.RuleId} must have a type`);
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({
      data: [{ id: TEST_IDENTIFIERS.RuleId, type: TEST_RULE_VALUES.UnsupportedEntryType }],
    }))).to.be.rejectedWith(
      `Entry ${TEST_IDENTIFIERS.RuleId} has unsupported type ${TEST_RULE_VALUES.UnsupportedEntryType}`,
    );
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({
      data: [{ id: TEST_IDENTIFIERS.RuleId, type: "Consent" }],
    }))).to.be.rejectedWith(`Entry ${TEST_IDENTIFIERS.RuleId} must have a resource object`);
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({
      data: [{ id: TEST_IDENTIFIERS.RuleId, type: "Consent", resource: { meta: { claims: {} } } }],
    }))).to.be.rejectedWith(`${CONSENT_ACCESS_CLAIMS.Action} is required`);
    await expect(contract.CreateConsentAccess(ctx, TEST_IDENTIFIERS.AssetId, JSON.stringify({
      data: [{ id: TEST_IDENTIFIERS.RuleId, type: "Consent", resource: { meta: { claims: INVALID_PAYLOAD_LITERAL } } }],
    }))).to.be.rejectedWith(`${CONSENT_ACCESS_CLAIMS.Action} is required`);
    await expect(contract.CreateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload({ status: TEST_RULE_VALUES.InvalidStatus })),
    )).to.be.rejectedWith(`Invalid status ${TEST_RULE_VALUES.InvalidStatus}. Allowed: active, revoked`);
  });

  /**
   * Blank references are removed entirely and only the allowlisted claims stay.
   */
  it("drops blank references after trimming and keeps only allowed claims", async () => {
    const ctx = createContractContext({ txSeconds: TEST_TIMESTAMPS.Create });
    const payload = buildPrimaryDocumentPayload({
      data: [
        buildRuleEntry({
          resource: {
            meta: {
              claims: buildRuleClaims({
                [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.BlankReferenceAction,
                [CONSENT_ACCESS_CLAIMS.EventBasedOn]: TEST_REFERENCES.Empty,
                [CONSENT_ACCESS_CLAIMS.SourceReference]: TEST_REFERENCES.Empty,
                "Consent.identifier": TEST_RULE_VALUES.HiddenIdentifierSecondary,
              }),
            },
          },
        }),
      ],
    });

    const asset = await contract.CreateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(payload),
    );

    expect(asset.data[0].resource.meta.claims).to.deep.equal({
      [CONSENT_ACCESS_CLAIMS.Context]: "org.hl7.fhir.api",
      [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.BlankReferenceAction,
      [CONSENT_ACCESS_CLAIMS.ActorRole]: TEST_RULE_VALUES.ActorRole,
    });
  });

  /**
   * Numeric zero is currently treated as a falsy empty value by the contract.
   */
  it("drops numeric zero references because the smart contract treats falsy values as empty", async () => {
    const ctx = createContractContext({ txSeconds: TEST_TIMESTAMPS.Create });
    const payload = buildPrimaryDocumentPayload({
      data: [
        buildRuleEntry({
          resource: {
            meta: {
              claims: buildRuleClaims({
                [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.ZeroReferenceAction,
                [CONSENT_ACCESS_CLAIMS.SourceReference]: TEST_REFERENCES.NumericZero,
              }),
            },
          },
        }),
      ],
    });

    const asset = await contract.CreateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(payload),
    );

    expect(asset.data[0].resource.meta.claims[CONSENT_ACCESS_CLAIMS.SourceReference])
      .to.equal(undefined);
  });

  /**
   * Update rewrites the bundle and increments the audit version.
   */
  it("updates an existing bundle and increments audit version", async () => {
    const previousAsset = {
      id: TEST_IDENTIFIERS.AssetId,
      type: CONSENT_ACCESS_ASSET_TYPE,
      data: [
        buildRuleEntry({
          resource: {
            resourceType: "Consent",
            meta: {
              claims: {
                [CONSENT_ACCESS_CLAIMS.Context]: "org.hl7.fhir.api",
                [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.DefaultAction,
              },
            },
          },
        }),
      ],
      meta: {
        audit: {
          createdAt: TEST_TIMESTAMPS.PreviousCreatedAt,
          updatedAt: TEST_TIMESTAMPS.PreviousUpdatedAt,
          txId: TEST_IDENTIFIERS.ExistingTransactionId,
          txTime: TEST_TIMESTAMPS.PreviousUpdatedAt,
          status: "active",
          version: 1,
        },
      },
    };
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: previousAsset },
      txSeconds: TEST_TIMESTAMPS.Update,
      txId: TEST_IDENTIFIERS.UpdateTransactionId,
    });

    const nextPayload = buildPrimaryDocumentPayload({
      data: [
        buildRuleEntry({
          type: "Consent",
          resource: {
            meta: {
              claims: {
                [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.AlternativeAction,
              },
            },
          },
        }),
      ],
    });

    const asset = await contract.UpdateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(nextPayload),
    );

    expect(asset.data[0].type).to.equal("Consent");
    expect(asset.data[0].resource.resourceType).to.equal("Consent");
    expect(asset.data[0].resource.meta.claims).to.deep.equal({
      [CONSENT_ACCESS_CLAIMS.Context]: "org.hl7.fhir.api",
      [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.AlternativeAction,
    });
    expect(asset.meta.audit).to.deep.equal(buildExpectedAudit({
      createdAt: TEST_TIMESTAMPS.PreviousCreatedAt,
      updatedAt: TEST_TIMESTAMPS.Update,
      txId: TEST_IDENTIFIERS.UpdateTransactionId,
      txTime: TEST_TIMESTAMPS.Update,
      version: 2,
    }));
  });

  /**
   * Lowercase update alias plus status transition coverage.
   */
  it("updates through the lowercase alias and allows status transitions", async () => {
    const previousAsset = buildStoredConsentAccessAsset({
      meta: {
        audit: {
          createdAt: TEST_TIMESTAMPS.PreviousCreatedAt,
          updatedAt: TEST_TIMESTAMPS.PreviousUpdatedAt,
          txId: TEST_IDENTIFIERS.ExistingTransactionId,
          txTime: TEST_TIMESTAMPS.PreviousUpdatedAt,
          status: "active",
          version: 3,
        },
      },
    });
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: previousAsset },
      txSeconds: TEST_TIMESTAMPS.StatusTransition,
      txId: TEST_IDENTIFIERS.StatusTransitionTransactionId,
    });

    const asset = await contract.updateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload({ status: TEST_RULE_VALUES.RevokedStatus })),
    );

    expect(asset.meta.audit.status).to.equal(TEST_RULE_VALUES.RevokedStatus);
    expect(asset.meta.audit.version).to.equal(4);
  });

  /**
   * When the previous audit has no numeric version, the contract starts from 1
   * and increments to 2 on update.
   */
  it("updates with audit version fallback when the stored audit has no numeric version", async () => {
    const previousAsset = buildStoredConsentAccessAsset({
      meta: {
        audit: {
          createdAt: TEST_TIMESTAMPS.PreviousWithoutVersionCreatedAt,
          updatedAt: TEST_TIMESTAMPS.PreviousWithoutVersionUpdatedAt,
          txId: TEST_IDENTIFIERS.ExistingTransactionId,
          txTime: TEST_TIMESTAMPS.PreviousWithoutVersionUpdatedAt,
          status: "active",
        },
      },
    });
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: previousAsset },
      txSeconds: TEST_TIMESTAMPS.VersionFallback,
      txId: TEST_IDENTIFIERS.VersionFallbackTransactionId,
    });

    const asset = await contract.UpdateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    );

    expect(asset.meta.audit.version).to.equal(2);
    expect(asset.meta.audit.createdAt).to.equal(TEST_TIMESTAMPS.PreviousWithoutVersionCreatedAt);
  });

  /**
   * Update must fail when the asset does not exist yet.
   */
  it("rejects updates for missing assets", async () => {
    const ctx = createContractContext({ txSeconds: TEST_TIMESTAMPS.Update });

    await expect(contract.UpdateConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    )).to.be.rejectedWith(`ConsentAccess ${TEST_IDENTIFIERS.AssetId} does not exist`);
  });

  /**
   * `Upsert` creates when state is empty.
   */
  it("upserts by creating a new asset when state is empty", async () => {
    const ctx = createContractContext({ txSeconds: TEST_TIMESTAMPS.Create });

    const asset = await contract.UpsertConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    );

    expect(asset.meta.audit.version).to.equal(1);
    expect(ctx.writes).to.have.length(1);
  });

  /**
   * `Upsert` becomes a no-op when the sanitized bundle is unchanged.
   */
  it("upserts by returning the previous asset when the sanitized data is identical", async () => {
    const storedAsset = buildStoredConsentAccessAsset({
      meta: {
        audit: {
          createdAt: TEST_TIMESTAMPS.NoOpPreviousCreatedAt,
          updatedAt: TEST_TIMESTAMPS.NoOpPreviousUpdatedAt,
          txId: TEST_IDENTIFIERS.PreviousUpsertTransactionId,
          txTime: TEST_TIMESTAMPS.NoOpPreviousUpdatedAt,
          status: "active",
          version: 6,
        },
      },
    });
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: storedAsset },
      txSeconds: TEST_TIMESTAMPS.UpsertChanged,
      txId: TEST_IDENTIFIERS.UpsertTransactionId,
    });

    const asset = await contract.UpsertConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    );

    expect(asset).to.deep.equal(storedAsset);
    expect(ctx.writes).to.have.length(0);
  });

  /**
   * Equivalent JSON objects may arrive with a different property insertion
   * order after transport. That representation detail must not create a new
   * blockchain revision for an otherwise identical consent rule.
   */
  it("treats reordered but semantically identical claims as an upsert no-op", async () => {
    const storedAsset = buildStoredConsentAccessAsset();
    const claims = storedAsset.data[0].resource.meta.claims;
    storedAsset.data[0].resource.meta.claims = Object.fromEntries(
      Object.entries(claims).reverse(),
    );
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: storedAsset },
      txSeconds: TEST_TIMESTAMPS.UpsertChanged,
      txId: TEST_IDENTIFIERS.UpsertTransactionId,
    });

    const asset = await contract.UpsertConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(buildPrimaryDocumentPayload()),
    );

    expect(asset).to.deep.equal(storedAsset);
    expect(ctx.writes).to.have.length(0);
  });

  /**
   * `Upsert` writes when the sanitized data changes, and the lowercase alias
   * must behave exactly the same.
   */
  it("upserts by writing a new version when data changes and supports the lowercase alias", async () => {
    const storedAsset = buildStoredConsentAccessAsset({
      meta: {
        audit: {
          createdAt: TEST_TIMESTAMPS.NoOpPreviousCreatedAt,
          updatedAt: TEST_TIMESTAMPS.NoOpPreviousUpdatedAt,
          txId: TEST_IDENTIFIERS.PreviousUpsertTransactionId,
          txTime: TEST_TIMESTAMPS.NoOpPreviousUpdatedAt,
          status: "active",
          version: 1,
        },
      },
    });
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: storedAsset },
      txSeconds: TEST_TIMESTAMPS.UpsertChanged,
      txId: TEST_IDENTIFIERS.UpsertTransactionId,
    });
    const changedPayload = buildPrimaryDocumentPayload({
      data: [
        buildRuleEntry({
          resource: {
            meta: {
              claims: {
                [CONSENT_ACCESS_CLAIMS.Action]: TEST_RULE_VALUES.ZeroReferenceAction,
              },
            },
          },
        }),
      ],
    });

    const asset = await contract.upsertConsentAccess(
      ctx,
      TEST_IDENTIFIERS.AssetId,
      JSON.stringify(changedPayload),
    );

    expect(asset.data[0].resource.meta.claims[CONSENT_ACCESS_CLAIMS.Action])
      .to.equal(TEST_RULE_VALUES.ZeroReferenceAction);
    expect(asset.meta.audit.version).to.equal(2);
    expect(ctx.writes).to.have.length(1);
  });

  /**
   * Read/existence helpers should behave the same through uppercase and
   * lowercase method names.
   */
  it("reads assets and checks existence through both method names", async () => {
    const storedAsset = buildStoredConsentAccessAsset();
    const ctx = createContractContext({
      existingState: { [TEST_IDENTIFIERS.AssetId]: storedAsset },
      txSeconds: TEST_TIMESTAMPS.Create,
    });

    await expect(contract.ExistsConsentAccess(ctx, TEST_IDENTIFIERS.AssetId)).to.eventually.equal(true);
    await expect(contract.existsConsentAccess(ctx, "missing")).to.eventually.equal(false);
    await expect(contract.ReadConsentAccess(ctx, TEST_IDENTIFIERS.AssetId)).to.eventually.deep.equal(storedAsset);
    await expect(contract.readConsentAccess(ctx, TEST_IDENTIFIERS.AssetId)).to.eventually.deep.equal(storedAsset);
    await expect(contract.ReadConsentAccess(ctx, "missing"))
      .to.be.rejectedWith("ConsentAccess missing does not exist");
  });

  /**
   * History output should normalize Fabric timestamp variants and preserve the
   * same result through both history method names.
   */
  it("builds consent access history through both method names", async () => {
    const ctx = createContractContext({
      historyItems: buildHistoryItems(),
    });

    const history = await contract.GetConsentAccessHistory(ctx, TEST_IDENTIFIERS.AssetId);
    const historyAlias = await contract.getConsentAccessHistory(ctx, TEST_IDENTIFIERS.AssetId);

    expect(history).to.deep.equal([
      { txId: "TX-1", timestamp: 101, isDelete: false, value: { id: "A" } },
      { txId: "TX-2", timestamp: 202, isDelete: false, value: null },
      { txId: "TX-3", timestamp: 303, isDelete: true, value: { id: "C" } },
      { txId: "TX-4", timestamp: 0, isDelete: false, value: { id: "D" } },
    ]);
    expect(historyAlias).to.deep.equal(history);
  });
});
