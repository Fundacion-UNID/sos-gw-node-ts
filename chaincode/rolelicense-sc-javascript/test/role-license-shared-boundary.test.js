// Flow contract: shared organization role licences carry sector policy only; device registration remains outside the licence ledger asset.
"use strict";

const chai = require("chai");
chai.use(require("chai-as-promised"));
const { expect } = chai;
const { RoleLicenseContract } = require("../index");
const { createContractContext } = require("./contract-test-context.cjs");

const ID = "urn:multibase:zG9EU4AWxfuVgFj41YxQMzyo4Y9neV8zDtN9ZvevfwRaPxYvgFMAvjXsjty9TzEyZAA9r";
const ORGANIZATION_OFFICIAL_ID = "ES-B12345678";
const CONTACT = "urn:multibase:zQmWATW6YwRbc2Qfq5Qv7FpC18JNpDutLCRa14Q6gttxyP";

function payload(overrides = {}) {
  return {
    id: ID,
    organizationOfficialId: ORGANIZATION_OFFICIAL_ID,
    jurisdiction: "ES",
    stableContactIdentifier: CONTACT,
    licensedRole: "2250",
    data: [{ sector: "animal-care", active: true }],
    ...overrides,
  };
}

describe("RoleLicenseContract shared boundary", () => {
  it("omits device state while extending and deactivating one exact animal-care sector", async () => {
    const contract = new RoleLicenseContract();
    const created = await contract.CreateRoleLicense(createContractContext(), ID, JSON.stringify(payload()));
    expect(created).not.to.have.property("devices");
    const ctx = createContractContext({ existingState: { [ID]: created } });
    const updated = await contract.UpsertSectorPolicy(
      ctx,
      ID,
      JSON.stringify({ sector: "animal-care", active: false, maxDevices: 5 }),
      "30",
    );
    expect(updated.data).to.deep.include({ sector: "animal-care", active: false, maxDevices: 5 });
    expect(updated).not.to.have.property("devices");
  });

  it("omits maxDevices when the gateway owns the installation limit", async () => {
    const contract = new RoleLicenseContract();
    const existing = { ...payload(), jurisdiction: "es", status: "active", createdAt: 1, updatedAt: 1 };
    const ctx = createContractContext({ existingState: { [ID]: existing } });
    const updated = await contract.UpsertSectorPolicy(
      ctx,
      ID,
      JSON.stringify({ sector: "onehealth-research", active: true }),
      "20",
    );
    expect(updated.data.find((item) => item.sector === "onehealth-research")).to.deep.equal({
      sector: "onehealth-research",
      active: true,
    });
  });

  it("revokes only the shared licence and rejects clear or malformed identity data", async () => {
    const contract = new RoleLicenseContract();
    const existing = { ...payload(), jurisdiction: "es", status: "active", createdAt: 1, updatedAt: 1 };
    const ctx = createContractContext({ existingState: { [ID]: existing } });
    const revoked = await contract.RevokeRoleLicense(ctx, ID, "50");
    expect(revoked).not.to.have.property("devices");
    expect(revoked.status).to.equal("revoked");
    await expect(contract.UpsertSectorPolicy(ctx, ID, JSON.stringify({ sector: "animal-care", active: true }), "51"))
      .to.be.rejectedWith("revoked role licence");
    await expect(contract.CreateRoleLicense(createContractContext(), ID, JSON.stringify(payload({ email: "private@example.org" }))))
      .to.be.rejectedWith("email must not be stored");
    await expect(contract.CreateRoleLicense(createContractContext(), ID, JSON.stringify(payload({ organizationOfficialId: "urn:org:tax:ES-B12345678" }))))
      .to.be.rejectedWith("official identifier value");
  });
});
