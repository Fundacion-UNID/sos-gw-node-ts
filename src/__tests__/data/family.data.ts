
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
import { testDefaultTenantServiceTypeClaim } from "./organization.data";

/** Test Claims for example-payloads */
export const testFamilyRegisterExpanded = {
  "Organization.address.addressCountry": "ES",
  "Organization.identifier.additionalType": "UUID",
  "Organization.identifier.value": "<UUID>",
  "Organization.owner.email": "adult1@example.com",
  "Organization.owner.identifier.value": "<cert-serialnumber>",
  "Person.email": "child1@example.com",
  "Person.identifier.additionalType": "UUID",
  "Person.identifier.value": "<child1-ID>",
  "Service.category": "health-care",
  "Service.identifier": "did:web:api-provider.example.com",
  "Service.serviceType": testDefaultTenantServiceTypeClaim,
}
