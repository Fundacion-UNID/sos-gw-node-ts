// Flow contract: one professional assignment anchors the same opaque PractitionerRole,
// employee and legal-organization links later written by artifact-sc and key bindings.
/*
 * SPDX-License-Identifier: Apache-2.0
 */

"use strict";

const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");

chai.use(chaiAsPromised);

const { expect } = chai;
const contractModule = require("../index");
const EmployeeContract = contractModule.EmployeeContract;
const { createContractContext } = require("../../test-support/contract-test-context");

const ASSIGNMENT_LINK = "zG9G9MsjjKK3cqYznAg72qrQNQ4gr3EycS8eDSbVya9ymkUfp4wbagzcmJVPqLqarka3b";
const EMPLOYEE_LINK = "zG9EU4AWxfuVgFj41YxQMzyo4Y9neV8zDtN9ZvevfwRaPxYvgFMAvjXsjty9TzEyZAA9r";
const ORGANIZATION_LINK = "zG9LkpGXgpJx42X9w4BYP3FFM9AD8Lunh56NUQcbgfnddnFvU3JUc1iWJ1eNDW6AVE7c2";

function payload(overrides = {}) {
  return {
    assignmentLink: ASSIGNMENT_LINK,
    employeeLink: EMPLOYEE_LINK,
    organizationLink: ORGANIZATION_LINK,
    role: "isco-08|2212",
    status: "active",
    ...overrides,
  };
}

describe("EmployeeContract professional assignment", () => {
  it("upserts an opaque assignment graph without storing raw FHIR or operational identities", async () => {
    const contract = new EmployeeContract();
    const createdCtx = createContractContext({ txSeconds: 100, txId: "TX-EMPLOYEE-1" });

    const created = await contract.UpsertProfessionalAssignment(
      createdCtx,
      ASSIGNMENT_LINK,
      JSON.stringify(payload()),
    );

    expect(created).to.deep.equal({
      assignmentLink: ASSIGNMENT_LINK,
      employeeLink: EMPLOYEE_LINK,
      organizationLink: ORGANIZATION_LINK,
      role: "isco-08|2212",
      status: "active",
      validFrom: 100,
      validUntil: null,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(createdCtx.readJson(ASSIGNMENT_LINK)).to.deep.equal(created);
    expect(JSON.stringify(created)).not.to.match(/urn:|did:|PractitionerRole\//);

    const revokedCtx = createContractContext({
      txSeconds: 200,
      txId: "TX-EMPLOYEE-2",
      existingState: { [ASSIGNMENT_LINK]: created },
    });
    const revoked = await contract.UpsertProfessionalAssignment(
      revokedCtx,
      ASSIGNMENT_LINK,
      JSON.stringify(payload({ status: "revoked" })),
    );
    expect(revoked.validFrom).to.equal(100);
    expect(revoked.validUntil).to.equal(200);
    expect(revoked.updatedAt).to.equal(200);
  });

  it("rejects identity disclosure and reassignment of an existing assignment link", async () => {
    const contract = new EmployeeContract();
    const ctx = createContractContext({ txSeconds: 100, txId: "TX-EMPLOYEE-3" });

    for (const [field, value] of [
      ["assignmentLink", "urn:uuid:41b2c3d4-e5f6-4890-9234-567890abcdef"],
      ["employeeLink", "did:web:professional.example"],
      ["organizationLink", "urn:cds-es:v1:organization:tax:ES-B00112233"],
    ]) {
      await expect(contract.UpsertProfessionalAssignment(
        ctx,
        field === "assignmentLink" ? value : ASSIGNMENT_LINK,
        JSON.stringify(payload({ [field]: value })),
      )).to.be.rejectedWith(`${field} must be an opaque multibase or CID value`);
    }

    const created = await contract.UpsertProfessionalAssignment(
      ctx,
      ASSIGNMENT_LINK,
      JSON.stringify(payload()),
    );
    const mismatchCtx = createContractContext({
      txSeconds: 200,
      txId: "TX-EMPLOYEE-4",
      existingState: { [ASSIGNMENT_LINK]: created },
    });
    await expect(contract.UpsertProfessionalAssignment(
      mismatchCtx,
      ASSIGNMENT_LINK,
      JSON.stringify(payload({ employeeLink: ORGANIZATION_LINK })),
    )).to.be.rejectedWith("cannot change employeeLink or organizationLink");
  });
});
