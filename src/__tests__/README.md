# API and Testing Strategy Overview
#
This test guide follows the shared narrative contract in
[docs-v2/01-narrative-contract.md](../../docs-v2/01-narrative-contract.md).

## Sectors: Network vs Business (Important!)

There are two distinct sector concepts in this platform:

- **Network sector (infrastructure):**
    - Typical values: `test`, `test-network`, `network`.
    - Used in host routes for organization registration and to select the blockchain/network where tenants are stored.
    - Example: `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`
- **Business sector (functional):**
    - Typical values: `health-care`, `animal-health`, etc.
    - Used in tenant routes, for resources, vaultId, and business operations.
    - Example: `/acme/cds-ES/v1/health-care/.well-known/ping`

**Never mix these two!** Using the wrong sector will cause errors like "Tenant not found" or inconsistent records.

- Always use `HOST_REGISTRY_NETWORK` for host/infrastructure operations.
- Always use `SECTOR` for tenant/business operations.

See comments in scripts and tests for more details and examples.

This document outlines the complete architecture and testing strategy for the API, focusing on its asynchronous FAPI-compliant nature, data models, and multi-tenant design. It also includes information about the specific tests for organization registration.

When a test is used as a 101 teaching artifact, it must still explain the
upstream story: `login -> loadProfile(...) -> loaded-profile workspace ->
security mode decision -> GW behavior`, even if the upstream steps are mocked.

## 1. Overall Architecture & FAPI Flow

The API is designed as a **non-blocking, asynchronous service** following the FAPI (Financial-grade API) pattern.

The flow is as follows:

1.  **Initial Request**: A client sends an `HTTP POST` to a specific action endpoint (e.g., `.../Practitioner/_batch`). The body contains a secure DIDComm envelope.
2.  **Immediate `202 Accepted`**: The server validates the request, queues the job, and immediately responds with `HTTP 202 Accepted` and a `thid` (thread ID).
3.  **Polling for Response**: The client then makes one or more `HTTP POST` requests to the **`_search`** action endpoint for that resource (e.g., `.../Practitioner/_search`). The body of this polling request contains the `thid`.
4.  **Final `200 OK`**: Once the job is complete, the `_search` endpoint responds with `HTTP 200 OK` and the final result.

## 2. API Path Structure

The API uses a structured, versioned, and multi-tenant path that explicitly declares the data format being used:

`/<tenant_id>/<cds>-<jurisdiction>/<version>/<sector>/<section>/<format>/<resourceType>/<_action>`

*   **`tenant_id`**: The `alternateName` of the tenant (e.g., `org1`).
*   **`cds-jurisdiction`**: Common Data Service and jurisdiction (e.g., `cds-es`).
*   **`version`**: API version (e.g., `v1`).
*   **`sector`**: Industry sector (e.g., `healthcare`).
*   **`section`**: Data domain within the sector (e.g., `entity`, `clinical`).
*   **`format`**: The data specification context (e.g., `org.schema.person`, `org.hl7.fhir.r4`).
*   **`resourceType`**: The type of resource being handled (e.g., `Practitioner`, `Group`).
*   **`_action`**: The operation (`_batch`, `_search`).

## 3. The DIDComm Envelope

All data is exchanged inside a secure DIDComm envelope, which is a signed JWT. This ensures the authenticity and integrity of every message.

*   **Header (`alg`, `kid`, `typ`):** Specifies the signing algorithm and the key ID of the sender.
*   **Payload (`iss`, `aud`, `thid`, `body`):**
    *   `iss`: The issuer (who sent the message).
    *   `aud`: The audience (the intended recipient, i.e., this API).
    *   `thid`: The unique ID for the request-response thread.
    *   `body`: The core payload of the message. For our API, this is a lean, command-style data, where `_batch` operations uses an `entry` with `meta.claims` with `@context`, `@type` and data.

## 4. Tenant & Admin Onboarding

The system bootstraps itself from the environment configuration. A user does not register the first tenant.

1.  **System Startup**: On startup, the service checks for the presence of `DEMO_ORG1_*` variables in the environment (`.env` file).
2.  **Automatic Bootstrapping**: If these variables exist, the service automatically calls the `TenantManager` to register the initial tenant (`ORG1`) and the `EmployeeManager` to create its designated administrator employee.
3.  **Further Tenants**: Subsequent tenants are registered by an authorized administrator from an existing, trusted tenant. The process is detailed in the [Organization Registration Process Documentation](src/docs/organization_registration.md).

## 5. Employee & Group Management (`_batch` Endpoint)

All entity management is done via a `_batch` endpoint.

*   **Offline-First:** This approach is designed for offline-first applications. A client app can batch any number of create/update/delete operations into a single `Bundle` and send it when a connection is available.
*   **Lean, Command-Style Bundle:** The `Bundle` sent by our applications is lean. Each `entry` contains:
    *   `fullUrl`: The URN of the entity.
    *   `meta.claims`: A self-contained object with `@context`, `@type`, and the actual data claims. The server is responsible for normalizing these claims for storage.
    *   `request`: The method, e.g., `{ "method": "PUT" }`.

## 6. Client-Centric Data Model

The architecture makes a critical distinction between organizational and personal data.

*   **Tenant Vaults:** A tenant (e.g., `ORG1`) has its own vault containing its operational data: employees, professional groups, roles, etc.
*   **Client Vaults:** A client (a person) has their own **independent vault**. Their ID is their vault ID. This vault is created for them by a custodian tenant (`ORG1`).
*   **Connection Channels (`List`):** To connect a client with professional groups, a `List` resource is created *inside the client's vault*. This list contains references to `Group` resources, which may exist in the client's own vault (e.g., "Family Group") or in a tenant's vault (e.g., on office with distinct professionals). This maintains the client's sovereignty over their own data connections.

## 7. Test-Driven Development (TDD) Principles

This project uses Test-Driven Development (TDD) to ensure high-quality and maintainable code. Here's how TDD is applied:

*   **Red-Green-Refactor Cycle:**
    *   **Red:** Write a test that expresses a desired behavior. This test will initially fail because the code doesn't exist yet.
    *   **Green:** Write the minimum amount of code to make the test pass. Focus on functionality, not optimization.
    *   **Refactor:** Clean up the code, improve its structure, and remove any duplication, while ensuring that all tests continue to pass.
*   **Test First:** Always write the test before writing the implementation.
*   **Small Increments:** Write small, focused tests and implement code in small, manageable chunks.
*   **Continuous Testing:** Run tests frequently to catch errors early.

By following these principles, we aim to create a robust and well-tested API.

## 8. Testing Strategy

The testing strategy encompasses both unit and integration tests to ensure the reliability and security of the API.

# API and Testing Strategy Overview

This document outlines the complete architecture and testing strategy for the API, focusing on its asynchronous FAPI-compliant nature, data models, and multi-tenant design. It also includes information about the specific tests for organization registration.

## 1. Overall Architecture & FAPI Flow

The API is designed as a **non-blocking, asynchronous service** following the FAPI (Financial-grade API) pattern.

The flow is as follows:

1.  **Initial Request**: A client sends an `HTTP POST` to a specific action endpoint (e.g., `.../Practitioner/_batch`). The body contains a secure DIDComm envelope.
2.  **Immediate `202 Accepted`**: The server validates the request, queues the job, and immediately responds with `HTTP 202 Accepted` and a `thid` (thread ID).
3.  **Polling for Response**: The client then makes one or more `HTTP POST` requests to the **`_search`** action endpoint for that resource (e.g., `.../Practitioner/_search`). The body of this polling request contains the `thid`.
4.  **Final `200 OK`**: Once the job is complete, the `_search` endpoint responds with `HTTP 200 OK` and the final result.

## 2. API Path Structure

The API uses a structured, versioned, and multi-tenant path that explicitly declares the data format being used:

`/<tenant_id>/<cds>-<jurisdiction>/<version>/<sector>/<section>/<format>/<resourceType>/<_action>`

*   **`tenant_id`**: The `alternateName` of the tenant (e.g., `org1`).
*   **`cds-jurisdiction`**: Common Data Service and jurisdiction (e.g., `cds-es`).
*   **`version`**: API version (e.g., `v1`).
*   **`sector`**: Industry sector (e.g., `healthcare`).
*   **`section`**: Data domain within the sector (e.g., `entity`, `clinical`).
*   **`format`**: The data specification context (e.g., `org.schema.person`, `org.hl7.fhir.r4`).
*   **`resourceType`**: The type of resource being handled (e.g., `Practitioner`, `Group`).
*   **`_action`**: The operation (`_batch`, `_search`).

## 3. The DIDComm Envelope

All data is exchanged inside a secure DIDComm envelope, which is a signed JWT. This ensures the authenticity and integrity of every message.

*   **Header (`alg`, `kid`, `typ`):** Specifies the signing algorithm and the key ID of the sender.
*   **Payload (`iss`, `aud`, `thid`, `body`):**
    *   `iss`: The issuer (who sent the message).
    *   `aud`: The audience (the intended recipient, i.e., this API).
    *   `thid`: The unique ID for the request-response thread.
    *   `body`: The core payload of the message. For our API, this is a lean, command-style data, where `_batch` operations uses an `entry` with `meta.claims` with `@context`, `@type` and data.

## 4. Tenant & Admin Onboarding

The system bootstraps itself from the environment configuration. A user does not register the first tenant.

1.  **System Startup**: On startup, the service checks for the presence of `DEMO_ORG1_*` variables in the environment (`.env` file).
2.  **Automatic Bootstrapping**: If these variables exist, the service automatically calls the `TenantManager` to register the initial tenant (`ORG1`) and the `EmployeeManager` to create its designated administrator employee.
3.  **Further Tenants**: Subsequent tenants are registered by an authorized administrator from an existing, trusted tenant. The process is detailed in the [Organization Registration Process Documentation](src/docs/organization_registration.md).

## 5. Employee & Group Management (`_batch` Endpoint)

All entity management is done via a `_batch` endpoint.

*   **Offline-First:** This approach is designed for offline-first applications. A client app can batch any number of create/update/delete operations into a single `Bundle` and send it when a connection is available.
*   **Lean, Command-Style Bundle:** The `Bundle` sent by our applications is lean. Each `entry` contains:
    *   `fullUrl`: The URN of the entity.
    *   `meta.claims`: A self-contained object with `@context`, `@type`, and the actual data claims. The server is responsible for normalizing these claims for storage.
    *   `request`: The method, e.g., `{ "method": "PUT" }`.

## 6. Client-Centric Data Model

The architecture makes a critical distinction between organizational and personal data.

*   **Tenant Vaults:** A tenant (e.g., `ORG1`) has its own vault containing its operational data: employees, professional groups, roles, etc.
*   **Client Vaults:** A client (a person) has their own **independent vault**. Their ID is their vault ID. This vault is created for them by a custodian tenant (`ORG1`).
*   **Connection Channels (`List`):** To connect a client with professional groups, a `List` resource is created *inside the client's vault*. This list contains references to `Group` resources, which may exist in the client's own vault (e.g., "Family Group") or in a tenant's vault (e.g., on office with distinct professionals). This maintains the client's sovereignty over their own data connections.

## 7. Test-Driven Development (TDD) Principles

This project uses Test-Driven Development (TDD) to ensure high-quality and maintainable code. Here's how TDD is applied:

*   **Red-Green-Refactor Cycle:**
    *   **Red:** Write a test that expresses a desired behavior. This test will initially fail because the code doesn't exist yet.
    *   **Green:** Write the minimum amount of code to make the test pass. Focus on functionality, not optimization.
    *   **Refactor:** Clean up the code, improve its structure, and remove any duplication, while ensuring that all tests continue to pass.
*   **Test First:** Always write the test before writing the implementation.
*   **Small Increments:** Write small, focused tests and implement code in small, manageable chunks.
*   **Continuous Testing:** Run tests frequently to catch errors early.

By following these principles, we aim to create a robust and well-tested API.

## 8. Testing Strategy

The testing strategy encompasses both unit and integration tests to ensure the reliability and security of the API.

```typescript
// src/utils/tenant.ts

/* Copyright (c) Connecting Solution & Applications Ltd. */
/* Apache License 2.0 */

/**
 * Validates a tenant's alternateName to ensure it doesn't conflict with the "host" name.
 * @param alternateName The alternateName to validate.
 * @returns True if the alternateName is valid, false otherwise.
 */
export function isValidTenantAlternateName(alternateName: string): boolean {
  if (!alternateName) {
    return false; // Or throw an error, depending on your requirements
  }
  const lowerName = alternateName.toLowerCase();
  if (lowerName === "host" || lowerName.startsWith("host") || lowerName.endsWith("host")) {
    return false; // Invalid name
  }
  return true; // Valid name
}
```

*   **Integration Tests:** Integration tests verify the interaction between multiple components (e.g., API endpoint, `OrganizationRegistrationManager`, and database). These tests are located in `src/__tests__/integration`.

### 8.1. Organization Registration Tests

The organization registration process is thoroughly tested with the following test cases:

*   **`src/__tests__/unit/OrganizationRegistrationManager.test.ts`:** Tests the `OrganizationRegistrationManager` class in isolation.
    *   Verifies that the manager correctly separates claims into different resource types (Organization, Person, Service).
    *   Validates the generation and validation of UUID v4 identifiers.
    *   Ensures that the "demo" environment is handled correctly.
    *   Handles different scenarios: existing valid UUID, invalid UUID, no UUID provided.
*   **`src/__tests__/integration/organizationRegistration.test.ts`:** Tests the complete organization registration flow, from API endpoint to data persistence (mocked database).
    *   Verifies that the API endpoint receives the request and calls the `OrganizationRegistrationManager`.
    *   Ensures that the data is correctly processed and persisted (mocked).
    *   Validates the FAPI compliance of the endpoint.
    *   Confirms correct handling of the `thid` for tracking the request.

## 9. Test Suite: Asynchronous FAPI Flow (`tenant.test.ts`)

This is the most critical integration test. It validates the entire secure, asynchronous communication protocol from end to end.

### 9.1. `describe('Asynchronous FAPI Flow (/tenant/cds-...)', ...)`

#### `it('should accept a new job, return 202, and then return the final result upon polling')`

*   **Purpose:** To simulate the complete "happy path" of a client submitting a secure, asynchronous job and successfully retrieving the result.
*   **Setup:**
    *   Mock the `decodeRequest` middleware to simulate a successful JWE/JWS decryption.
    *   Ensure the mock in-memory queue and response store are running.
*   **Steps:**

    1.  **Initial Request (Job Submission):**
        *   `POST` to a valid, complex CDS URL (e.g., `/test-tenant/.../Consent/_update`).
        *   Set `Content-Type` to `application/x-www-form-urlencoded`.
        *   Send a body containing a `request=` parameter and a test `thid`.
        *   **Assert:** The HTTP status is `202 Accepted`.
    2.  **Polling Request (Result Retrieval):**
        *   Wait a short period (> 100ms) for the mock worker to complete the job.
        *   `POST` to the **same** CDS URL.
        *   Set `Content-Type` to `application/x-www-form-urlencoded`.
        *   Send a body containing the `thid=` parameter from the first request.
        *   **Assert:** The HTTP status is `200 OK`.
    3.  **Response Validation:**
        *   **Assert:** The response `Content-Type` is `application/x-www-form-urlencoded`.
        *   **Assert:** The response body is a string that starts with `response=`.
        *   **Assert:** The content of the `response=` parameter is the expected JSON `Bundle`.

## 10. Test Suite: Well-Known Endpoints (`well-known.test.ts`)

This suite validates the public key and DID discovery endpoints, which are essential for clients to interact with the system.

### 10.1. `describe('/.well-known Endpoints', ...)`

#### `it('should return a valid JWKS for a known tenant')`

*   **Purpose:** To ensure that the JWKS endpoint correctly serves the public keys for a given tenant.
*   **Setup:**
    *   Mock the `DatabaseAdapter`.
    *   The mock should return a predefined array of public key objects when queried for a specific tenant's 'keys' section.
*   **Steps:**

    1.  `GET` `/test-tenant/.well-known/jwks.json`.
    2.  **Assert:** The HTTP status is `200 OK`.
    3.  **Assert:** The `Content-Type` is `application/json`.
    4.  **Assert:** The response body is a valid JSON object.
    5.  **Assert:** The JSON object contains a `keys` array.
    6.  **Assert:** The keys in the array match the ones provided by the mock database adapter and do **not** contain any private key material.

#### `it('should return a valid DID Document for a known tenant')`

*   **Purpose:** To ensure the DID Document is correctly constructed.
*   **Steps:**

    1.  `GET` `/test-tenant/.well-known/did.json`.
    2.  **Assert:** The HTTP status is `200 OK`.
    3.  **Assert:** The `Content-Type` is `application/json`.
    4.  **Assert:** The `id` field in the DID document correctly matches the format `did:web:hostname:tenantId`.
    5.  **Assert:** The `verificationMethod` and `keyAgreement` sections are present and contain the keys from the JWKS.

#### `it('should return a 404 for an unknown tenant')`

*   **Purpose:** To ensure the system correctly handles requests for tenants that do not exist.
*   **Setup:**
    *   The mock database adapter should be configured to return an empty array or `null` when queried for the unknown tenant.
*   **Steps:**

    1.  `GET` `/unknown-tenant/.well-known/jwks.json`.
    2.  **Assert:** The HTTP status is `404 Not Found`.
*   **Integration Tests:** Integration tests verify the interaction between multiple components (e.g., API endpoint, `OrganizationRegistrationManager`, and database). These tests are located in `src/__tests__/integration`.

### 8.1. Organization Registration Tests

The organization registration process is thoroughly tested with the following test cases:

*   **`src/__tests__/unit/OrganizationRegistrationManager.test.ts`:** Tests the `OrganizationRegistrationManager` class in isolation.
    *   Verifies that the manager correctly separates claims into different resource types (Organization, Person, Service).
    *   Validates the generation and validation of UUID v4 identifiers.
    *   Ensures that the "demo" environment is handled correctly.
    *   Handles different scenarios: existing valid UUID, invalid UUID, no UUID provided.
*   **`src/__tests__/integration/organizationRegistration.test.ts`:** Tests the complete organization registration flow, from API endpoint to data persistence (mocked database).
    *   Verifies that the API endpoint receives the request and calls the `OrganizationRegistrationManager`.
    *   Ensures that the data is correctly processed and persisted (mocked).
    *   Validates the FAPI compliance of the endpoint.
    *   Confirms correct handling of the `thid` for tracking the request.

## 9. Test Suite: Asynchronous FAPI Flow (`tenant.test.ts`)

This is the most critical integration test. It validates the entire secure, asynchronous communication protocol from end to end.

### 9.1. `describe('Asynchronous FAPI Flow (/tenant/cds-...)', ...)`

#### `it('should accept a new job, return 202, and then return the final result upon polling')`

*   **Purpose:** To simulate the complete "happy path" of a client submitting a secure, asynchronous job and successfully retrieving the result.
*   **Setup:**
    *   Mock the `decodeRequest` middleware to simulate a successful JWE/JWS decryption.
    *   Ensure the mock in-memory queue and response store are running.
*   **Steps:**

    1.  **Initial Request (Job Submission):**
        *   `POST` to a valid, complex CDS URL (e.g., `/test-tenant/.../Consent/_update`).
        *   Set `Content-Type` to `application/x-www-form-urlencoded`.
        *   Send a body containing a `request=` parameter and a test `thid`.
        *   **Assert:** The HTTP status is `202 Accepted`.
    2.  **Polling Request (Result Retrieval):**
        *   Wait a short period (> 100ms) for the mock worker to complete the job.
        *   `POST` to the **same** CDS URL.
        *   Set `Content-Type` to `application/x-www-form-urlencoded`.
        *   Send a body containing the `thid=` parameter from the first request.
        *   **Assert:** The HTTP status is `200 OK`.
    3.  **Response Validation:**
        *   **Assert:** The response `Content-Type` is `application/x-www-form-urlencoded`.
        *   **Assert:** The response body is a string that starts with `response=`.
        *   **Assert:** The content of the `response=` parameter is the expected JSON `Bundle`.

## 10. Test Suite: Well-Known Endpoints (`well-known.test.ts`)

This suite validates the public key and DID discovery endpoints, which are essential for clients to interact with the system.

### 10.1. `describe('/.well-known Endpoints', ...)`

#### `it('should return a valid JWKS for a known tenant')`

*   **Purpose:** To ensure that the JWKS endpoint correctly serves the public keys for a given tenant.
*   **Setup:**
    *   Mock the `DatabaseAdapter`.
    *   The mock should return a predefined array of public key objects when queried for a specific tenant's 'keys' section.
*   **Steps:**

    1.  `GET` `/test-tenant/.well-known/jwks.json`.
    2.  **Assert:** The HTTP status is `200 OK`.
    3.  **Assert:** The `Content-Type` is `application/json`.
    4.  **Assert:** The response body is a valid JSON object.
    5.  **Assert:** The JSON object contains a `keys` array.
    6.  **Assert:** The keys in the array match the ones provided by the mock database adapter and do **not** contain any private key material.

#### `it('should return a valid DID Document for a known tenant')`

*   **Purpose:** To ensure the DID Document is correctly constructed.
*   **Steps:**

    1.  `GET` `/test-tenant/.well-known/did.json`.
    2.  **Assert:** The HTTP status is `200 OK`.
    3.  **Assert:** The `Content-Type` is `application/json`.
    4.  **Assert:** The `id` field in the DID document correctly matches the format `did:web:hostname:tenantId`.
    5.  **Assert:** The `verificationMethod` and `keyAgreement` sections are present and contain the keys from the JWKS.

#### `it('should return a 404 for an unknown tenant')`

*   **Purpose:** To ensure the system correctly handles requests for tenants that do not exist.
*   **Setup:**
    *   The mock database adapter should be configured to return an empty array or `null` when queried for the unknown tenant.
*   **Steps:**

    1.  `GET` `/unknown-tenant/.well-known/jwks.json`.
    2.  **Assert:** The HTTP status is `404 Not Found`.
