/* SPDX-License-Identifier: Apache-2.0 */
"use strict";
const { Contract } = require("fabric-contract-api");
const { EVIDENCE_INDEX, ORGANIZATION_ASSET_LABEL } = require("./constants");
const exists = require("./exists");
const { buildHistory } = require("./history");
const { buildStoredOrganizationAsset, getEvidenceHashes } = require("./organization-asset");
const read = require("./read");
const { assertStatus, parseJson } = require("./utils");
const write = require("./write");
function validatePayload(orgId, payload) {
  if (payload.orgId && payload.orgId !== orgId) throw new Error(`Payload orgId ${payload.orgId} does not match ${orgId}`);
  if (!payload.vc || typeof payload.vc !== "object" || Array.isArray(payload.vc)) throw new Error("vc is required");
}
function evidenceFor(vc) { return vc.evidence || vc.credentialSubject?.evidence; }
class OrganizationContract extends Contract {
  async CreateOrganization(ctx, orgId, payloadJson) {
    if (await exists(ctx.stub, orgId)) throw new Error(`${ORGANIZATION_ASSET_LABEL} ${orgId} already exists`);
    const payload = parseJson(payloadJson, "payload");
    validatePayload(orgId, payload);
    const { docHash, signedHash } = getEvidenceHashes(evidenceFor(payload.vc));
    const index = docHash && signedHash ? ctx.stub.createCompositeKey(EVIDENCE_INDEX, [docHash, signedHash]) : undefined;
    if (index && await exists(ctx.stub, index)) throw new Error("EvidenceAlreadyRegistered");
    const asset = buildStoredOrganizationAsset(ctx, orgId, payload);
    await write(ctx.stub, orgId, asset);
    if (index) await ctx.stub.putState(index, Buffer.from(orgId));
    return asset;
  }
  async createOrganization(ctx, id, json) { return this.CreateOrganization(ctx, id, json); }
  async EnsureOrganization(ctx, orgId, payloadJson) {
    const payload = parseJson(payloadJson, "payload");
    validatePayload(orgId, payload);
    if (!(await exists(ctx.stub, orgId))) return { created: true, asset: await this.CreateOrganization(ctx, orgId, payloadJson) };
    const asset = await this.ReadOrganization(ctx, orgId);
    if (JSON.stringify(asset.vc) !== JSON.stringify(payload.vc)) throw new Error(`ORGANIZATION_CONFLICT:${orgId}`);
    return { created: false, asset };
  }
  async ensureOrganization(ctx, id, json) { return this.EnsureOrganization(ctx, id, json); }
  async ReadOrganization(ctx, id) { return read(ctx.stub, id, ORGANIZATION_ASSET_LABEL); }
  async readOrganization(ctx, id) { return this.ReadOrganization(ctx, id); }
  async GetOrganization(ctx, id) { return this.ReadOrganization(ctx, id); }
  async UpdateOrganizationStatus(ctx, id, status, timestampText) {
    assertStatus(status);
    const timestamp = Number(timestampText);
    if (!Number.isFinite(timestamp)) throw new Error("Invalid timestamp");
    const previous = await this.ReadOrganization(ctx, id);
    const asset = buildStoredOrganizationAsset(ctx, id, { ...previous, status }, previous);
    asset.updatedAt = timestamp;
    asset.meta.audit.updatedAt = timestamp;
    asset.meta.audit.txTime = timestamp;
    await write(ctx.stub, id, asset);
    return asset;
  }
  async updateOrganizationStatus(ctx, id, status, timestamp) { return this.UpdateOrganizationStatus(ctx, id, status, timestamp); }
  async GetOrganizationHistory(ctx, id) { return buildHistory(ctx, id); }
  async getOrganizationHistory(ctx, id) { return this.GetOrganizationHistory(ctx, id); }
  async UpsertDidBySector() { throw new Error("UpsertDidBySector is deprecated. Hosted DID routing does not belong in organization-sc"); }
  async upsertDidBySector(...args) { return this.UpsertDidBySector(...args); }
}
module.exports = OrganizationContract;
