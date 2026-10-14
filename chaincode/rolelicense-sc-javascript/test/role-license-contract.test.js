// Flow contract: legacy Vet role licences keep sector-isolated installation behavior while shared licences keep personal data opaque.
/* SPDX-License-Identifier: Apache-2.0 */
"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
const { expect } = chai;
const moduleUnderTest = require("../index");
const { createContractContext } = require("./contract-test-context.cjs");

const ID = "urn:multibase:zLicenseHash";
const ORG = "urn:org:TAX:ES-B12345678";
const CONTACT = "urn:multibase:z3mJr7AoUXx2Wqd";

function payload(overrides = {}) {
  return {
    id: ID,
    organizationId: ORG,
    jurisdiction: "ES",
    stableContactIdentifier: CONTACT,
    licensedRole: "RESPRSN",
    data: [{ sector: "", active: true, maxDevices: null }],
    ...overrides,
  };
}

describe("RoleLicenseContract", () => {
  let contract;
  beforeEach(() => { contract = new moduleUnderTest.RoleLicenseContract(); });

  it("exports and creates a privacy-preserving organization licence", async () => {
    expect(moduleUnderTest.contracts).to.deep.equal([moduleUnderTest.RoleLicenseContract]);
    const ctx = createContractContext({ txSeconds: 10 });
    const asset = await contract.CreateRoleLicense(ctx, ID, JSON.stringify(payload()));
    expect(asset).to.include({ id: ID, organizationId: ORG, jurisdiction: "es", licensedRole: "RESPRSN", status: "active" });
    expect(asset.devices).to.deep.equal([]);
    expect(ctx.readJson(ID)).to.deep.equal(asset);
    expect(ctx.writes).to.have.length(2);
  });

  it("ensures the deterministic identity without creating a duplicate", async () => {
    const createCtx = createContractContext({ txSeconds: 10 });
    const created = await contract.ensureRoleLicense(createCtx, ID, JSON.stringify(payload()));
    expect(created.created).to.equal(true);
    const retryCtx = createContractContext({ existingState: { [ID]: created.asset }, txSeconds: 20 });
    expect(await contract.EnsureRoleLicense(retryCtx, ID, JSON.stringify(payload()))).to.deep.equal({ created: false, asset: created.asset });
    await expect(contract.EnsureRoleLicense(retryCtx, ID, JSON.stringify(payload({ licensedRole: "2211" }))))
      .to.be.rejectedWith(`ROLE_LICENSE_CONFLICT:${ID}`);
  });

  it("extends and deactivates one exact sector while preserving another sector", async () => {
    const existing = { ...payload(), jurisdiction: "es", status: "active", devices: [
      { clientId: "animal", clientInstanceId: "a", sector: "animal-care", host: "https://vet.example", status: "active", activatedAt: 1 },
      { clientId: "human", clientInstanceId: "h", sector: "health-care", host: "https://health.example", status: "active", activatedAt: 1 },
    ], createdAt: 1, updatedAt: 1, revokedAt: null };
    const ctx = createContractContext({ existingState: { [ID]: existing } });
    await contract.upsertSectorPolicy(ctx, ID, "animal-care", "true", "5", "20");
    const updated = await contract.UpsertSectorPolicy(ctx, ID, "animal-care", "false", "5", "30");
    expect(updated.data).to.deep.include({ sector: "animal-care", active: false, maxDevices: 5 });
    expect(updated.devices.find((item) => item.clientId === "animal").status).to.equal("revoked");
    expect(updated.devices.find((item) => item.clientId === "human").status).to.equal("active");
  });

  it("registers DCR installations per sector, is idempotent and enforces the effective limit", async () => {
    const existing = { ...payload(), jurisdiction: "es", status: "active", devices: [], createdAt: 1, updatedAt: 1, revokedAt: null };
    const ctx = createContractContext({ existingState: { [ID]: existing } });
    const device = { clientId: "client-1", clientInstanceId: "install-1", sector: "health-care", host: "https://one.example" };
    const first = await contract.registerDevice(ctx, ID, JSON.stringify(device), "1", "20");
    expect(first.devices).to.have.length(1);
    expect((await contract.RegisterDevice(ctx, ID, JSON.stringify(device), "1", "21")).devices).to.have.length(1);
    const replaced = await contract.RegisterDevice(ctx, ID, JSON.stringify({ ...device, clientId: "client-replacement" }), "1", "21");
    expect(replaced.devices.filter((item) => item.status === "active")).to.have.length(1);
    expect(replaced.devices.find((item) => item.clientId === "client-1").status).to.equal("revoked");
    await expect(contract.RegisterDevice(ctx, ID, JSON.stringify({ ...device, clientId: "client-2", clientInstanceId: "install-2" }), "1", "22"))
      .to.be.rejectedWith("device limit reached");
    const revoked = await contract.revokeDevice(ctx, ID, "health-care", "client-replacement", "install-1", "23");
    expect(revoked.devices.find((item) => item.clientId === "client-replacement").status).to.equal("revoked");
  });

  it("globally revokes the licence and every active DCR installation", async () => {
    const existing = { ...payload(), jurisdiction: "es", status: "active", devices: [
      { clientId: "one", clientInstanceId: "one", sector: "health-care", host: "https://one.example", status: "active", activatedAt: 1 },
      { clientId: "old", clientInstanceId: "old", sector: "animal-care", host: "https://two.example", status: "revoked", activatedAt: 1, revokedAt: 2 },
    ], createdAt: 1, updatedAt: 1, revokedAt: null };
    const ctx = createContractContext({ existingState: { [ID]: existing } });
    const revoked = await contract.RevokeRoleLicense(ctx, ID, "50");
    expect(revoked.status).to.equal("revoked");
    expect(revoked.devices.every((item) => item.status === "revoked")).to.equal(true);
    await expect(contract.registerDevice(ctx, ID, JSON.stringify({}), "5", "51")).to.be.rejectedWith("revoked");
  });

  it("lists by organization and returns Fabric history", async () => {
    const asset = { ...payload(), jurisdiction: "es", status: "active", devices: [], createdAt: 1, updatedAt: 1, revokedAt: null };
    const index = `rolelicense~organization\u0000${ORG}\u0000${ID}`;
    const history = [{ txId: "TX-1", timestamp: { seconds: { toNumber: () => 9 } }, isDelete: false, value: Buffer.from(JSON.stringify(asset)) }];
    const ctx = createContractContext({ existingState: { [ID]: asset, [index]: "" }, historyByKey: { [ID]: history } });
    expect(await contract.listRoleLicensesByOrganization(ctx, ORG)).to.deep.equal([asset]);
    expect((await contract.getRoleLicenseHistory(ctx, ID))[0]).to.include({ txId: "TX-1", timestamp: 9 });
    expect(await contract.readRoleLicense(ctx, ID)).to.deep.equal(asset);
  });

  it("rejects clear personal data, invalid identities, policies and operations", async () => {
    await expect(contract.createRoleLicense(createContractContext(), ID, JSON.stringify(payload({ email: "private@example.org" }))))
      .to.be.rejectedWith("email must not be stored");
    await expect(contract.CreateRoleLicense(createContractContext(), ID, JSON.stringify(payload({ stableContactIdentifier: "private@example.org" }))))
      .to.be.rejectedWith("canonical urn:multibase");
    await expect(contract.CreateRoleLicense(createContractContext(), ID, JSON.stringify(payload({ data: [] }))))
      .to.be.rejectedWith("at least one");
    await expect(contract.CreateRoleLicense(createContractContext({ existingState: { [ID]: payload() } }), ID, JSON.stringify(payload())))
      .to.be.rejectedWith("already exists");
    await expect(contract.ReadRoleLicense(createContractContext(), ID)).to.be.rejectedWith("does not exist");
    const existing = { ...payload(), jurisdiction: "es", status: "active", devices: [], createdAt: 1, updatedAt: 1, revokedAt: null };
    const ctx = createContractContext({ existingState: { [ID]: existing } });
    await expect(contract.UpsertSectorPolicy(ctx, ID, "health-care", "true", "0", "2")).to.be.rejectedWith("positive integer");
    await expect(contract.RegisterDevice(ctx, ID, JSON.stringify({ clientId: "x", clientInstanceId: "x", sector: "health-care", host: "" }), "5", "2"))
      .to.be.rejectedWith("device.host is required");
    await expect(contract.RevokeDevice(ctx, ID, "health-care", "missing", "missing", "2")).to.be.rejectedWith("does not exist");
  });
});
