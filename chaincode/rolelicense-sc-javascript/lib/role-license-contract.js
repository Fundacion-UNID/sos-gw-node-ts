/* SPDX-License-Identifier: Apache-2.0 */
"use strict";

const { Contract } = require("fabric-contract-api");
const MULTIBASE_URN = /^urn:multibase:z[1-9A-HJ-NP-Za-km-z]+$/;
const SECTOR = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ORGANIZATION_INDEX = "rolelicense~organization";

function now(ctx) {
  const seconds = ctx.stub.getTxTimestamp().seconds;
  return typeof seconds === "object" && typeof seconds.toNumber === "function" ? seconds.toNumber() : Number(seconds);
}

async function readOptional(ctx, id) {
  const value = await ctx.stub.getState(id);
  return value?.length ? JSON.parse(value.toString("utf8")) : undefined;
}

async function readRequired(ctx, id) {
  const value = await readOptional(ctx, id);
  if (!value) throw new Error(`RoleLicense ${id} does not exist`);
  return value;
}

function parseObject(input, label) {
  const value = typeof input === "string" ? JSON.parse(input) : input;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function validatePolicy(policy, allowLegacyEmptySector = false) {
  if (!(allowLegacyEmptySector && policy.sector === "") && !SECTOR.test(String(policy.sector || ""))) {
    throw new Error("sector must be a canonical sector");
  }
  if (policy.maxDevices === null && !allowLegacyEmptySector) {
    throw new Error("maxDevices must be omitted or a positive integer");
  }
  if (policy.maxDevices !== undefined && !(allowLegacyEmptySector && policy.maxDevices === null)
    && (!Number.isInteger(Number(policy.maxDevices)) || Number(policy.maxDevices) <= 0)) {
    throw new Error("maxDevices must be a positive integer");
  }
  return {
    sector: policy.sector,
    active: policy.active === true || policy.active === "true",
    ...(policy.maxDevices === undefined || (allowLegacyEmptySector && policy.maxDevices === null)
      ? { ...(allowLegacyEmptySector ? { maxDevices: null } : {}) }
      : { maxDevices: Number(policy.maxDevices) }),
  };
}

function validatePayload(id, payload) {
  for (const field of ["email", "phone", "telephone", "name"]) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) throw new Error(`${field} must not be stored`);
  }
  if (!MULTIBASE_URN.test(String(id || "")) || !MULTIBASE_URN.test(String(payload.stableContactIdentifier || ""))) {
    throw new Error("id and stableContactIdentifier must be canonical urn:multibase values");
  }
  if (payload.id && payload.id !== id) throw new Error(`Payload id ${payload.id} does not match ${id}`);
  if (payload.organizationOfficialId && String(payload.organizationOfficialId).startsWith("urn:")) {
    throw new Error("organizationOfficialId must be an official identifier value");
  }
  if (!payload.organizationOfficialId && !payload.organizationId) throw new Error("organization official identifier is required");
  if (!Array.isArray(payload.data) || payload.data.length === 0) throw new Error("data must contain at least one sector policy");
  const legacyDeviceProfile = Boolean(payload.organizationId && !payload.organizationOfficialId);
  return payload.data.map((policy) => validatePolicy(policy, legacyDeviceProfile));
}

function immutableConflict(existing, payload) {
  const organization = payload.organizationOfficialId || payload.organizationId;
  const existingOrganization = existing.organizationOfficialId || existing.organizationId;
  return organization !== existingOrganization
    || String(payload.jurisdiction || "").toLowerCase() !== existing.jurisdiction
    || payload.stableContactIdentifier !== existing.stableContactIdentifier
    || payload.licensedRole !== existing.licensedRole;
}

async function write(ctx, id, asset) {
  await ctx.stub.putState(id, Buffer.from(JSON.stringify(asset)));
}

class RoleLicenseContract extends Contract {
  async CreateRoleLicense(ctx, id, payloadJson) {
    if (await readOptional(ctx, id)) throw new Error(`RoleLicense ${id} already exists`);
    const payload = parseObject(payloadJson, "payload");
    const data = validatePayload(id, payload);
    const timestamp = now(ctx);
    const legacyDeviceProfile = Boolean(payload.organizationId && !payload.organizationOfficialId);
    const asset = {
      id,
      ...(payload.organizationOfficialId
        ? { organizationOfficialId: payload.organizationOfficialId }
        : { organizationId: payload.organizationId }),
      jurisdiction: String(payload.jurisdiction || "").toLowerCase(),
      stableContactIdentifier: payload.stableContactIdentifier,
      licensedRole: payload.licensedRole,
      data,
      ...(legacyDeviceProfile ? { devices: [] } : {}),
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      revokedAt: null,
    };
    await write(ctx, id, asset);
    const organization = asset.organizationOfficialId || asset.organizationId;
    await ctx.stub.putState(ctx.stub.createCompositeKey(ORGANIZATION_INDEX, [organization, id]), Buffer.from(""));
    return asset;
  }

  async createRoleLicense(ctx, id, json) { return this.CreateRoleLicense(ctx, id, json); }

  async EnsureRoleLicense(ctx, id, payloadJson) {
    const payload = parseObject(payloadJson, "payload");
    validatePayload(id, payload);
    const existing = await readOptional(ctx, id);
    if (!existing) return { created: true, asset: await this.CreateRoleLicense(ctx, id, payloadJson) };
    if (immutableConflict(existing, payload)) throw new Error(`ROLE_LICENSE_CONFLICT:${id}`);
    return { created: false, asset: existing };
  }

  async ensureRoleLicense(ctx, id, json) { return this.EnsureRoleLicense(ctx, id, json); }
  async ReadRoleLicense(ctx, id) { return readRequired(ctx, id); }
  async readRoleLicense(ctx, id) { return this.ReadRoleLicense(ctx, id); }

  async UpsertSectorPolicy(ctx, id, policyOrSector, activeOrTimestamp, maxDevices, legacyTimestamp) {
    const existing = await readRequired(ctx, id);
    if (existing.status === "revoked") throw new Error("revoked role licence");
    const sharedSignature = typeof policyOrSector === "string" && policyOrSector.trim().startsWith("{");
    const policy = sharedSignature
      ? validatePolicy(parseObject(policyOrSector, "policy"))
      : validatePolicy({ sector: policyOrSector, active: activeOrTimestamp, maxDevices: maxDevices === "" ? undefined : Number(maxDevices) });
    const timestamp = Number(sharedSignature ? activeOrTimestamp : legacyTimestamp);
    const data = [...existing.data.filter((item) => item.sector !== policy.sector), policy];
    const devices = existing.devices?.map((device) => (
      !policy.active && device.sector === policy.sector && device.status === "active"
        ? { ...device, status: "revoked", revokedAt: timestamp }
        : device
    ));
    const updated = { ...existing, data, ...(devices ? { devices } : {}), updatedAt: timestamp };
    await write(ctx, id, updated);
    return updated;
  }

  async upsertSectorPolicy(...args) { return this.UpsertSectorPolicy(...args); }

  async RegisterDevice(ctx, id, deviceJson, limitText, timestampText) {
    const existing = await readRequired(ctx, id);
    if (existing.status === "revoked") throw new Error("revoked role licence");
    if (!Array.isArray(existing.devices)) throw new Error("device registration is not owned by this shared role licence");
    const device = parseObject(deviceJson, "device");
    if (!device.host) throw new Error("device.host is required");
    const timestamp = Number(timestampText);
    const sameInstallation = existing.devices.find((item) => item.sector === device.sector && item.clientInstanceId === device.clientInstanceId);
    if (sameInstallation?.clientId === device.clientId && sameInstallation.status === "active") return existing;
    let devices = existing.devices.map((item) => (
      item.sector === device.sector && item.clientInstanceId === device.clientInstanceId && item.status === "active"
        ? { ...item, status: "revoked", revokedAt: timestamp }
        : item
    ));
    const activeCount = devices.filter((item) => item.sector === device.sector && item.status === "active").length;
    if (activeCount >= Number(limitText)) throw new Error("device limit reached");
    devices.push({ ...device, status: "active", activatedAt: timestamp });
    const updated = { ...existing, devices, updatedAt: timestamp };
    await write(ctx, id, updated);
    return updated;
  }

  async registerDevice(...args) { return this.RegisterDevice(...args); }

  async RevokeDevice(ctx, id, sector, clientId, clientInstanceId, timestampText) {
    const existing = await readRequired(ctx, id);
    const index = existing.devices?.findIndex((item) => item.sector === sector && item.clientId === clientId && item.clientInstanceId === clientInstanceId) ?? -1;
    if (index < 0) throw new Error("device does not exist");
    const timestamp = Number(timestampText);
    const devices = [...existing.devices];
    devices[index] = { ...devices[index], status: "revoked", revokedAt: timestamp };
    const updated = { ...existing, devices, updatedAt: timestamp };
    await write(ctx, id, updated);
    return updated;
  }

  async revokeDevice(...args) { return this.RevokeDevice(...args); }

  async RevokeRoleLicense(ctx, id, timestampText) {
    const existing = await readRequired(ctx, id);
    const timestamp = Number(timestampText);
    const devices = existing.devices?.map((device) => device.status === "active"
      ? { ...device, status: "revoked", revokedAt: timestamp }
      : device);
    const updated = {
      ...existing,
      ...(devices ? { devices } : {}),
      status: "revoked",
      revokedAt: timestamp,
      updatedAt: timestamp,
    };
    await write(ctx, id, updated);
    return updated;
  }

  async listRoleLicensesByOrganization(ctx, organizationId) {
    const iterator = await ctx.stub.getStateByPartialCompositeKey(ORGANIZATION_INDEX, [organizationId]);
    const items = [];
    while (true) {
      const result = await iterator.next();
      if (result.value) {
        const id = ctx.stub.splitCompositeKey(result.value.key).attributes[1];
        if (id) items.push(await readRequired(ctx, id));
      }
      if (result.done) { await iterator.close(); break; }
    }
    return items;
  }

  async getRoleLicenseHistory(ctx, id) {
    const iterator = await ctx.stub.getHistoryForKey(id);
    const items = [];
    while (true) {
      const result = await iterator.next();
      if (result.value) {
        const seconds = result.value.timestamp?.seconds;
        items.push({
          txId: result.value.txId,
          timestamp: typeof seconds === "object" && typeof seconds.toNumber === "function" ? seconds.toNumber() : Number(seconds || 0),
          isDelete: result.value.isDelete,
          value: result.value.value?.length ? JSON.parse(result.value.value.toString("utf8")) : null,
        });
      }
      if (result.done) { await iterator.close(); break; }
    }
    return items;
  }
}

module.exports = RoleLicenseContract;
