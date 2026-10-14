// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.
// File: src/__tests__/data/example-payloads.ts

import { testClaimsOfferEntityExpanded, testClaimsOfferFamilyExpanded } from './offer.data';
import { testClaimsRegisterTenantExpanded } from './organization.data';
import { testFamilyRegisterExpanded } from './family.data';
import {
  HealthcareActorRoles,
  HealthcareConsentActions,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/index';
import {
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsPersonSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import {
  EXAMPLE_EMPLOYEE_DOCTOR_ACTIVE,
  buildExampleEmployeeClaims,
} from 'gdc-common-utils-ts/examples/employee';
import {
  EXAMPLE_RELATED_PERSON_DISABLE_BUNDLE_PAYLOAD,
  EXAMPLE_RELATED_PERSON_PURGE_BUNDLE_PAYLOAD,
} from 'gdc-common-utils-ts/examples/related-person';
import {
  EXAMPLE_INDIVIDUAL_ORGANIZATION_DISABLE_PAYLOAD,
  EXAMPLE_INDIVIDUAL_ORGANIZATION_PURGE_PAYLOAD,
  EXAMPLE_TENANT_DELETE_MESSAGE,
  EXAMPLE_TENANT_DISABLE_MESSAGE,
  EXAMPLE_TENANT_DISABLE_REQUEST_TYPE,
  EXAMPLE_TENANT_ENABLE_MESSAGE,
  EXAMPLE_TENANT_ENABLE_REQUEST_TYPE,
  EXAMPLE_TENANT_PURGE_REQUEST_TYPE,
} from 'gdc-common-utils-ts/examples/lifecycle';
import {
  EmployeeBatchEntryTypes,
  EmployeeBundleMethods,
  EmployeeResourceTypes,
} from 'gdc-common-utils-ts/utils/employee';
import { Format } from 'gdc-common-utils-ts/constants/Schemas';
import { DeviceAppTypes, DeviceUserClasses } from 'gdc-common-utils-ts/constants/device';
import { buildLicensePurchaseEntry } from 'gdc-common-utils-ts/utils/license';
import {
  EXAMPLE_API_ORGANIZATION_DID,
  EXAMPLE_LICENSE_PURCHASE_INPUT,
  EXAMPLE_SERVICE_PUBLIC_DID,
  EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
  LicenseListSearchEditor,
} from 'gdc-common-utils-ts';


/**
 * @file This file serves as the Single Source of Truth for all complex test payloads
 * and examples used across integration tests, cURL documentation, and Swagger specs.
 * It is designed to be a 1:1 representation of the payloads described in the
 * `docs/API_INTEGRATORS_GUIDE.md`, while also retaining other payloads used in tests.
 */

// --- Reusable Constants ---

const pdfEmbeddedData = "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKMTAwIDEwMCBUZAooSGVsbG8gUERGKSBUagoKRVQKZW5kc3RyZWFtCmVuZGiago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNTMgMDAwMDAgbiAKMDAwMDAwMDEwNiAwMDAwMCBuIAowMDAwMDAwMjU1IDAwMDAwIG4gCjAwMDAwMDAzNDMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDMKJSVFT0Y=";

const deviceKidMldsa = "thumbprint-public-sig-key-device";
// Canonical JWK thumbprint material (RFC 7638): do NOT include `kid` or `use`.
const deviceJwkMldsaThumbprint = {
  "alg": "ML-DSA-44",
  "kty": "AKP",
  "pub": "base64url-public-sig-key-device",
} as const;
// Full JWK as it appears in JWKS (kid/use are fine here for routing/selection).
export const deviceJwkMldsa = {
  ...deviceJwkMldsaThumbprint,
  "kid": deviceKidMldsa,
  "use": "sig",
} as const;

const deviceKidMlkem = "thumbprint-public-enc-key-device";
// Recipient encryption key id (resolved from the destination DID Document / JWKS).
const recipientKidMlkem = "thumbprint-public-enc-key-recipient";
// Canonical JWK thumbprint material (RFC 7638): do NOT include `kid` or `use`.
const deviceJwkMlkemThumbprint = {
  "crv": "ML-KEM-768",
  "kty": "OKP",
  "x": "base64url-public-enc-key-device",
} as const;
// Full JWK as it appears in JWKS (kid/use are fine here for routing/selection).
export const deviceJwkMlkem = {
  ...deviceJwkMlkemThumbprint,
  "kid": deviceKidMlkem,
  "use": "enc",
} as const;

const deviceJWKeySet = {
  "keys": [
    { ...deviceJwkMldsa },
    { ...deviceJwkMlkem }
  ]
};

/**
 * Meta object for a request where the client provides its full JWKs.
 * Used for initial registration. The top-level `kid` is mandatory alongside the
 * `jwk` so the server can cache the key for future use.
 */
export const metaRequestBodyFullJWK = {
  "jwe": {
    "header": {
      "typ": "application/didcomm-encrypted+json",
      // Nested JOSE: JWE wraps a compact JWS payload.
      "cty": "JWS",
      "enc": "A256GCM",
      "alg": "ML-KEM-768",
      // Recipient (target) key id.
      "kid": recipientKidMlkem,
      // Sender key id.
      "skid": deviceKidMlkem,
      // Bootstrap: provide the sender's public encryption key (without `kid`/`use`).
      "jwk": { ...deviceJwkMlkemThumbprint },
    }
  },    
  "jws": {
    "protected": {
      "typ": "application/didcomm-signed+json",
      // The JWS payload is a DIDComm plaintext JSON object.
      "cty": "application/didcomm-plain+json",
      "alg": deviceJwkMldsa.alg,
      "kid": deviceKidMldsa,
      // Bootstrap: provide the sender's public signing key (without `kid`/`use`).
      "jwk": { ...deviceJwkMldsaThumbprint },
    }
  }
};

/**
 * Removes an intentionally incomplete decoded-JWS marker from a canonical
 * fixture used after the cryptographic boundary. Real signed requests include
 * `meta.jws.signature` and are covered by encrypted-transport suites.
 */
export function withoutIncompleteJwsProof<
  T extends { meta?: Record<string, unknown> },
>(payload: T): T {
  if (!payload.meta) return payload;
  const { jws: _incompleteJws, ...verifiedTransportMetadata } = payload.meta;
  return { ...payload, meta: verifiedTransportMetadata };
}

/** Builds a structurally complete signed-envelope fixture for route tests. */
export function withCompleteFixtureJwsProof<
  T extends { jti: string; meta: { jws: Record<string, unknown> } },
>(payload: T): T {
  const signed = structuredClone(payload);
  signed.meta.jws.signature = signed.jti;
  return signed;
}

/**
 * Meta object for subsequent requests where the client's keys are already registered.
 * The client identifies its keys using the `kid` property.
 */
const metaRequestBodyOnlyKidHeader = {
  "jwe": {
    "header": {
      "typ": "application/didcomm-encrypted+json",
      "cty": "JWS",
      "enc": "A256GCM",
      "alg": "ML-KEM-768",
      "kid": recipientKidMlkem,
      "skid": deviceKidMlkem,
    }
  },    
  "jws": {
    "protected": {
      "typ": "application/didcomm-signed+json",
      "cty": "application/didcomm-plain+json",
      "alg": deviceJwkMldsa.alg,
      "kid": deviceKidMldsa,
    }
  }
};

const organizationVerificationTransactionBody = {
  resourceType: 'Bundle',
  type: 'collection',
  total: 1,
  data: [{
    type: 'Organization-verification-transaction-request-v1.0',
    resource: {
      meta: {
        claims: {
        '@context': 'org.schema',
        [ClaimsOrganizationSchemaorg.legalName]: 'ACME HEALTH SL',
        [ClaimsOrganizationSchemaorg.identifierType]: 'taxID',
        [ClaimsOrganizationSchemaorg.identifierValue]: 'VATES-B00112233',
        [ClaimsOrganizationSchemaorg.taxId]: 'VATES-B00112233',
        [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
        [ClaimsPersonSchemaorg.email]: 'controller@example.org',
        [ClaimsPersonSchemaorg.hasOccupationalRoleValue]: 'RESPRSN',
        [ClaimsServiceSchemaorg.category]: 'health-care',
        [ClaimsServiceSchemaorg.identifier]: 'did:web:tenant.example.org',
        [ClaimsServiceSchemaorg.url]: 'https://operator.example.net/acme/cds-es/v1/health-care',
        [ClaimsServiceSchemaorg.serviceType]:
          testClaimsRegisterTenantExpanded[ClaimsServiceSchemaorg.serviceType],
        },
      },
      controller: {
        did: 'did:web:controller.example.org',
        sameAs: 'urn:multibase:zExampleStableActorHash',
        publicKeyJwk: {
          kid: 'controller-signing-es384-001',
          kty: 'EC',
          crv: 'P-384',
          x: '<controller-sign-x>',
          y: '<controller-sign-y>',
          alg: 'ES384',
          use: 'sig',
        },
      },
      organization: {
        did: 'did:web:tenant.example.org',
        publicKeyJwk: {
          kid: 'organization-signing-es384-001',
          kty: 'EC',
          crv: 'P-384',
          x: '<organization-sign-x>',
          y: '<organization-sign-y>',
          alg: 'ES384',
          use: 'sig',
        },
      },
      legalRepresentativePayload: {
        email: 'controller@example.org',
      },
      verification: {
        resourceType: 'contract',
      },
    },
  }],
} as const;

const organizationVerificationTransactionAttachments = [{
  id: 'signed-terms-pdf-001',
  media_type: 'application/pdf',
  data: {
    links: ['https://portal.example.org/files/legal-organization-signed-terms.pdf'],
  },
}] as const;


// --- 1. Organization Onboarding ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.1
 * Initial request to register a new tenant organization.
 */
export const ORGANIZATION_REGISTRATION_REQUEST = {
  "jti": "org-registration-request-<test-id>",
  "thid": "org-registration-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Organization-registration-form-v1.0",
      "resource": {
        "resourceType": "Organization",
        "meta": { "claims": {
          "@context": "org.schema",
          "@type": "template",
          ...((({ "org.schema.Organization.alternateName": _alternateName, ...legalClaims }) => legalClaims)(testClaimsRegisterTenantExpanded)),
          "org.schema.Service.termsOfService": pdfEmbeddedData,
        } },
      },
    }],
  },
  "meta": { ...metaRequestBodyFullJWK }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.1
 * The response to a successful registration request, containing the Offer.
 */
export const ORGANIZATION_REGISTRATION_RESPONSE = {
  "jti": "org-registration-response-<test-id>",
  "thid": "org-registration-thread-<test-id>",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:host.example.com#v1_<network>_registry_org.schema_organization_batch",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Organization-registration-offer-v1.0",
      "resource": {
        "resourceType": "Offer",
        "meta": { "claims": {
          "@context": "org.schema",
          "@type": "receipt",
          "org.schema.Service.termsOfService": "<url-stored-pdf>",
          ...testClaimsOfferEntityExpanded,
        } }
      }
    }]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Request to accept the registration offer and create an order.
 * Use the Offer identifier returned by the Organization registration _batch-response.
 */
export const ORGANIZATION_ORDER_REQUEST = {
  "jti": "org-order-request-<test-id>",
  "thid": "org-order-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Organization-order-request-v1.0",
      "resource": {
        "resourceType": "Order",
        "meta": { "claims": {
          "@context": "org.schema",
          [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: "{{offerId}}",
        } }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * Canonical professional-seat Offer request shared by route tests and local
 * HTTP smoke. Serial numbers are created only after an accepted Order.
 */
export const ORGANIZATION_LICENSE_OFFER_REQUEST = {
  "jti": EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
  "thid": EXAMPLE_THREAD_IDENTIFIER_LICENSE_SEARCH,
  "iss": EXAMPLE_API_ORGANIZATION_DID,
  "aud": EXAMPLE_SERVICE_PUBLIC_DID,
  "type": "application/didcomm-plain+json",
  "body": {
    "resourceType": "Bundle",
    "type": "batch",
    "data": [buildLicensePurchaseEntry({
      quantity: EXAMPLE_LICENSE_PURCHASE_INPUT.quantity,
      userClass: DeviceUserClasses.Employee,
      type: DeviceAppTypes.Web,
    })],
  },
};

/** Canonical unfiltered professional-license inventory request. */
export const ORGANIZATION_LICENSE_SEARCH_REQUEST = {
  ...ORGANIZATION_LICENSE_OFFER_REQUEST,
  "body": {
    "resourceType": ORGANIZATION_LICENSE_OFFER_REQUEST.body.resourceType,
    "type": ORGANIZATION_LICENSE_OFFER_REQUEST.body.type,
    "entry": [new LicenseListSearchEditor().buildSearchEntry()],
  },
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Response to a successful order request, containing the payment communication bundle.
 */
export const ORGANIZATION_ORDER_RESPONSE = {
  "jti": "org-order-response-<test-id>",
  "thid": "org-order-thread-<test-id>",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "resourceType": "Bundle",
    "type": "batch-response",
    "total": 1,
    "data": [
      {
        "type": "Organization-order-response-v1.0",
        "resource": {
          "meta": { "claims": {
            "@context": "org.schema",
            "@type": "Order:Invoice",
            "org.schema.Order.acceptedOffer.identifier": "urn:cds:ES:v1:health-care:product:org.schema:Offer:<offer-uuid>",
            "org.schema.Order.partOfInvoice": "<invoice-id-or-url>",
            "org.schema.Order.paymentMethod": "Stripe",
            "org.schema.Order.paymentDueDate": "2025-10-22T14:30:00Z",
            "org.schema.Order.paymentUrl": "<payment-url>",
            "org.schema.Order.invoiceIssuedAt": "2025-10-15T14:30:00Z",
            "org.schema.IndividualProduct.serialNumber": "lic-activation-code-001",
            "org.schema.IndividualProduct.category": "professional"
          } }
        },
        "response": { "status": "201" }
      }
    ]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 6.2
 * Canonical ICA-first activation request.
 *
 * Contract priority:
 * - `vp_token` is the canonical proof carrier and should embed the ICA evidence
 * - the VP inside `vp_token` is assembled from the ICA-issued organization VC,
 *   ICA-issued legal-representative VC, presenter signing key id, and target
 *   host operator id before external signing
 * - `org.schema.Service.url` is the hosting URL selected by the controller
 *   during onboarding; it points to the chosen hosting operator/connector
 *   location and must not be confused with the tenant public `did:web`
 * - `controller.*` is explicit public key binding material for controller/person DID bootstrap
 * - `organizationCredential` / `representativeCredential` are deprecated compatibility fields
 */
export const ORGANIZATION_ACTIVATION_REQUEST = {
  "jti": "org-activation-request-<test-id>",
  "thid": "org-activation-thread-<test-id>",
  "iss": "urn:ietf:params:oauth:jwk-thumbprint:sha-256:<controller-signing-thumbprint>",
  "aud": "host:node-operator-es",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "vp_token": "<ica-proof-token>",
    "controller": {
      "did": "did:web:people.acme.org:controllers:primary",
      "sameAs": "urn:multibase:zControllerHash",
      "publicKeyJwk": {
        "kid": "controller-es384-001",
        "kty": "EC",
        "crv": "P-384",
        "x": "<x>",
        "y": "<y>",
        "alg": "ES384",
        "use": "sig"
      },
      "jwks": {
        "keys": [
          {
            "kid": "controller-didcomm-enc-001",
            "kty": "EC",
            "crv": "P-384",
            "x": "<enc-x>",
            "y": "<enc-y>",
            "use": "enc",
            "purposes": ["didcomm-enc"]
          }
        ]
      }
    },
    "organizationCredential": "<deprecated-legacy-compat>",
    "representativeCredential": "<deprecated-legacy-compat>",
    "data": [{
      "type": "Organization-activation-request-v1.0",
      "resource": {
        "meta": { "claims": {
          "@context": "org.schema",
          "@type": "template",
          ...testClaimsRegisterTenantExpanded,
          "org.schema.Service.url": "https://connector.example.net/acme/cds-es/v1/health-care",
          "org.schema.Service.serviceType": "organization/Composition.cruds,organization/Composition.rs,organization/ResearchSubject.rs",
          "org.schema.Service.termsOfService": pdfEmbeddedData
        } }
      }
    }]
  },
  "meta": { ...metaRequestBodyFullJWK }
};

/**
 * Canonical legacy `_activate-response` shape.
 *
 * The activation output must preserve the host continuation contract by
 * returning the generated Offer identifier required by `Order/_batch`.
 */
export const ORGANIZATION_ACTIVATION_RESPONSE = {
  "jti": "org-activation-response-<test-id>",
  "thid": "org-activation-thread-<test-id>",
  "aud": "urn:ietf:params:oauth:jwk-thumbprint:sha-256:<controller-signing-thumbprint>",
  "iss": "did:web:host.example.com",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "resourceType": "Bundle",
    "type": "batch-response",
    "total": 1,
    "data": [
      {
        "type": "Organization-activation-response-v1.0",
        "resource": {
          "meta": { "claims": {
            "@context": "org.schema",
            ...testClaimsRegisterTenantExpanded,
            "org.schema.Organization.alternateName": "acme-health",
            "org.schema.Offer.identifier": "urn:cds:ES:v1:health-care:product:org.schema:Offer:<offer-uuid>"
          } }
        },
        "response": { "status": "200" }
      }
    ]
  }
};

/**
 * Canonical `_issue-response` shape for controller recovery/rebind.
 */
export const ORGANIZATION_ISSUE_RESPONSE = {
  "jti": "organization-issue-response-<test-id>",
  "thid": "organization-issue-thread-<test-id>",
  "iss": "did:web:host.example.org",
  "aud": "did:web:portal.example.org",
  "type": "hosting-response",
  "body": {
    "resourceType": "Bundle",
    "type": "transaction-response",
    "total": 1,
    "data": [{
      "type": "Organization-issue-response-v1.0",
      "resource": {
        "meta": { "claims": {
          "@context": "org.schema",
          ...testClaimsRegisterTenantExpanded,
          "org.schema.Organization.alternateName": "acme-health",
          "org.schema.IndividualProduct.serialNumber": "lic-reactivation-code-001",
          "org.schema.IndividualProduct.category": "professional",
          "org.schema.IndividualProduct.additionalType": "mobile"
        } },
        "icaResponse": {
          "resourceType": "Bundle",
          "type": "batch-response",
          "total": 1,
          "data": [{
            "type": "VerifyResponse-v1.0",
            "resource": {
              "resourceType": "Bundle"
            }
          }]
        }
      },
      "response": { "status": "200" }
    }]
  }
};

// --- Async Polling (HTTP-level payloads) ---

export const ASYNC_POLL_REQUEST = {
  "thid": "action-thread-<test-id>",
};

export const ASYNC_POLL_PENDING_RESPONSE = {
  "thid": "action-thread-<test-id>",
  "status": "PENDING",
};

export const ORGANIZATION_REGISTRATION_POLL_REQUEST = {
  "thid": "org-registration-thread-<test-id>",
};

export const ORGANIZATION_ORDER_POLL_REQUEST = {
  "thid": "org-order-thread-<test-id>",
};

export const EMPLOYEE_POLL_REQUEST = {
  "thid": "employee-thread-<test-id>",
};

export const CONSENT_POLL_REQUEST = {
  "thid": "consent-thread-<test-id>",
};

export const COMMUNICATION_POLL_REQUEST = {
  "thid": "communication-thread-<test-id>",
};

export const COMPOSITION_POLL_REQUEST = {
  "thid": "composition-thread-<test-id>",
};

export const RELATED_PERSON_POLL_REQUEST = {
  "thid": "relatedperson-thread-<test-id>",
};

export const OBSERVATION_POLL_REQUEST = {
  "thid": "observation-thread-<test-id>",
};

export const TOKEN_EXCHANGE_POLL_REQUEST = {
  "thid": "token-exchange-thread-<test-id>",
};

export const DEVICE_REGISTRATION_POLL_REQUEST = {
  "thid": "device-registration-thread-<test-id>",
};

export const TENANT_ORGANIZATION_POLL_REQUEST = {
  "thid": "tenant-organization-thread-<test-id>",
};

export const TENANT_ORDER_POLL_REQUEST = {
  "thid": "tenant-order-thread-<test-id>",
};

// For legacy/plaintext submissions, the polling endpoint returns the decoded business `body` only.
export const ORGANIZATION_REGISTRATION_POLL_RESULT_BODY = ORGANIZATION_REGISTRATION_RESPONSE.body;
export const ORGANIZATION_ORDER_POLL_RESULT_BODY = ORGANIZATION_ORDER_RESPONSE.body;
export const ORGANIZATION_ACTIVATION_POLL_RESULT_BODY = ORGANIZATION_ACTIVATION_RESPONSE.body;
export const ORGANIZATION_ISSUE_POLL_RESULT_BODY = ORGANIZATION_ISSUE_RESPONSE.body;

// For secure submissions, the polling endpoint returns a form-encoded `response=<jwe>`.
export const ASYNC_POLL_SECURE_RESPONSE_FORM = {
  response: 'eyJ...<jwe>',
};


// --- 2. Device and Identity Registration ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The inner body of a Device Registration (DCR) request.
 */
export const DCR_REQUEST_BODY = {
  "application_type": "web",
  "client_name": "App for [email] as [role] on [iOS, Android, Web]",
  "code": "00000000-0000-0000-0000-000000000000",
  "redirect_uris": ["myapp://callback"],
  "token_endpoint_auth_method": "private_key_jwt",
  "ext_device_info": {
    "device_id": "iOS-17.1.2-ABC-123",
    "device_name": "User's iPhone 15 Pro",
    "os": "iOS",
    "os_version": "17.1.2",
    "push_provider": "expo",
    "push_token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
  },
  "jwks": { ...deviceJWKeySet },
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The full DIDComm message for a Device Registration (DCR) request.
 */
export const DEVICE_REGISTRATION_REQUEST = {
  "jti": "device-registration-request-<test-id>",
  "thid": "device-registration-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:api.acme.org#identity_openid_device_dcr",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": { ...DCR_REQUEST_BODY },
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1
 * The final response to a DCR request, containing the new client_id.
 */
export const DEVICE_REGISTRATION_RESPONSE = {
  "jti": "device-registration-response-<test-id>",
  "thid": "device-registration-thread-<test-id>",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "client_id": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>"
  }
};

/**
 * The final response to a successful activation-code exchange.
 */
export const INITIAL_ACCESS_TOKEN_EXCHANGE_RESPONSE = {
  "jti": "token-exchange-response-<test-id>",
  "thid": "token-exchange-thread-<test-id>",
  "aud": "urn:ietf:rfc:7638:thumbprint-public-enc-key-device",
  "iss": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "initial_access_token": "initial-access-token-001"
  }
};

export const INITIAL_ACCESS_TOKEN_VERIFIED_CLAIMS = {
  scope: 'dcr:register',
  act_code: DCR_REQUEST_BODY.code,
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.2
 * A request for a scoped SMART access token.
 *
 * Proof layers in this example:
 * - `client_assertion`: proves possession of the registered device private key
 * - `vp_token`: proves the prior OpenID4VP verification event used to bind
 *   the SMART request to `acr_values`
 * - bearer / external research token is a separate alternative used only in
 *   the inter-tenant research profile, not in this baseline professional flow
 */
export const SMART_TOKEN_REQUEST = {
  "jti": "smart-token-request-<test-id>",
  "thid": "smart-token-thread-<test-id>",
  "iss": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "client_id": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
    "redirect_uri": "https://app.acme.org/callback",
    "code_challenge": "b2MtY2hhbGxlbmdlLWJhc2U2NA",
    "code_challenge_method": "S256",
    "client_assertion": "<client-auth-jwt>",
    "client_assertion_type": "private_key_jwt",
    "acr_values": "urn:antifraud:acr:openid4vp:employee",
    "vp_token": "<vp-jws-or-jsonld>",
    "presentation_submission": {
      "id": "ps-001",
      "definition_id": "pd-001",
      "descriptor_map": [
        {
          "id": "vp-credential",
          "format": "jwt_vp",
          "path": "$.vp_token"
        }
      ]
    },
    "expires_in": 300,
    "token_type": "Bearer",
    "sub": "did:web:api.acme.org:employee:doctor1@acme.org:ISCO-08|2211",
    "purpose": HealthcareConsentPurposes.Treatment,
    "scope": `patient/Composition.rs?subject={{individualDid}}&section=${HealthcareConsentActions.AllergiesAndIntolerances} patient/Consent.cruds`
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.2
 * Exchange activation code + Firebase id_token for initial_access_token (DCR).
 *
 * Note: Authorization header carries the Firebase id_token; body carries `subject_token`.
 */
export const INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST = {
  "jti": "token-exchange-request-<test-id>",
  "thid": "token-exchange-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:api.acme.org#identity_openid_token_exchange",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "subject_token": "{{activationCode}}"
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.1 (tenant admin step)
 * Issue (reserve) a single employee activation code from the tenant license pool.
 *
 * Notes:
 * - This is a tenant-admin / IT operation (not done by the employee device).
 * - The response will return a `batch-response` entry with `id = <activationCode>` for copy/paste.
 */
export const LICENSE_ISSUE_REQUEST = {
  jti: 'license-issue-request-<test-id>',
  thid: 'license-issue-thread-<test-id>',
  iss: 'did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>',
  aud: 'did:web:api.acme.org#identity_openid_license_issue',
  type: 'application/api+json',
  body: {
    resourceType: 'Bundle',
    type: 'batch',
    data: [
      {
        type: 'EmployeeLicenseInvitation-v1.0',
        meta: {
          subjectId: 'employee-<uuid>',
        },
        resource: {
          meta: { claims: {
            '@context': 'org.schema',
            '@type': 'IndividualProduct:Issue',
            'org.schema.Person.email': 'doctor1@acme.org',
            'org.schema.Person.hasOccupation.identifier.value': 'ISCO-08|2211',
            'org.schema.IndividualProduct.category': 'professional',
            'org.schema.IndividualProduct.additionalType': 'mobile',
          } },
        },
        request: { method: 'POST', url: '/acme/cds-ES/v1/health-care/identity/openid/License/_issue' },
      },
    ],
  },
} as const;

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.1
 * Issue an activation code for an employee that already exists in the tenant.
 */
export const LICENSE_ISSUE_EXISTING_EMPLOYEE_REQUEST = {
  ...LICENSE_ISSUE_REQUEST,
  thid: 'license-issue-thread-<test-id>-existing-employee',
  jti: 'license-issue-request-<test-id>-existing-employee',
  body: {
    ...LICENSE_ISSUE_REQUEST.body,
    data: [
      {
        ...LICENSE_ISSUE_REQUEST.body.data[0],
        resource: {
          meta: { claims: {
            '@context': 'org.schema',
            '@type': 'IndividualProduct:Issue',
            'org.schema.Person.email': 'admin1@acme.org',
            'org.schema.Person.hasOccupation.identifier.value': 'ISCO-08|1120',
            'org.schema.IndividualProduct.category': 'professional',
            'org.schema.IndividualProduct.additionalType': 'mobile',
          } },
        },
      },
    ],
  },
} as const;

/**
 * @see API_INTEGRATORS_GUIDE.md section 7.1.1
 * Federate external OIDC id_token into Firebase custom token.
 */
export const FIREBASE_CUSTOM_TOKEN_REQUEST = {
  "jti": "firebase-custom-token-request-<test-id>",
  "thid": "firebase-custom-token-thread-<test-id>",
  "iss": "urn:ietf:rfc:7638:thumbprint-public-sig-key-device",
  "aud": "did:web:api.acme.org#identity_firebase_token_custom",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/json",
  "body": {
    "provider": "eidas",
    "id_token": "<external-oidc-id-token>"
  }
};


// --- 3. End-to-End Business Flows ---

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.1
 * Request to create a new employee role.
 */
export const EMPLOYEE_REGISTRATION_REQUEST = {
  "jti": "employeerole-registration-request-<test-id>",
  "thid": "employeerole-registration-thread-<test-id>",
  "iss": "did:web:api.acme.org:employee:admin1@acme.org:device:<uuid>",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Employee-form-v1.0",
      "resource": {
        "resourceType": "Employee",
        "meta": {
          "claims": {
            "org.schema.Person.identifier": "urn:uuid:11b2c3d4-e5f6-7890-1234-567890abcdef",
            "org.schema.Person.hasOccupation.identifier.value": "ISCO-08|4226",
            "org.schema.Person.email": "receptionist1@acme.org"
          }
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

const EMPLOYEE_LIFECYCLE_EXAMPLE_CLAIMS = buildExampleEmployeeClaims(EXAMPLE_EMPLOYEE_DOCTOR_ACTIVE);

/**
 * Current Employee v1 compatibility payload: FHIR-shaped Bundle DELETE means
 * GW soft disable, keeps the seat assigned and addresses one explicit id.
 */
export const EMPLOYEE_DISABLE_REQUEST = {
  thid: 'employee-disable-example-001',
  body: {
    resourceType: EmployeeResourceTypes.bundle,
    type: EmployeeResourceTypes.batch,
    data: [{
      type: EmployeeBatchEntryTypes.disable,
      request: { method: EmployeeBundleMethods.disable },
      resource: {
        resourceType: EmployeeResourceTypes.employee,
        id: EXAMPLE_EMPLOYEE_DOCTOR_ACTIVE.resourceId,
        meta: { claims: { ...EMPLOYEE_LIFECYCLE_EXAMPLE_CLAIMS } },
      },
    }],
  },
};

/** Explicit purge of the same inactive employee; this releases/disassociates its seat. */
export const EMPLOYEE_PURGE_REQUEST = {
  thid: 'employee-purge-example-001',
  body: {
    resourceType: EmployeeResourceTypes.bundle,
    type: EmployeeResourceTypes.batch,
    data: [{
      type: EmployeeBatchEntryTypes.purge,
      request: { method: EmployeeBundleMethods.purge },
      resource: {
        resourceType: EmployeeResourceTypes.employee,
        id: EXAMPLE_EMPLOYEE_DOCTOR_ACTIVE.resourceId,
        meta: { claims: { ...EMPLOYEE_LIFECYCLE_EXAMPLE_CLAIMS } },
      },
    }],
  },
};

/** Shared common-utils fixtures are the source of truth for member lifecycle examples. */
export const RELATED_PERSON_DISABLE_REQUEST = EXAMPLE_RELATED_PERSON_DISABLE_BUNDLE_PAYLOAD;
export const RELATED_PERSON_PURGE_REQUEST = EXAMPLE_RELATED_PERSON_PURGE_BUNDLE_PAYLOAD;

function buildTenantLifecycleExample(
  thid: string,
  type: string,
  claims: Record<string, unknown>,
) {
  return {
    thid,
    body: {
      data: [{
        type,
        request: { method: 'POST' },
        resource: { resourceType: 'Organization', meta: { claims: { ...claims } } },
      }],
    },
  };
}

export const TENANT_DISABLE_REQUEST = buildTenantLifecycleExample(
  'tenant-disable-example-001',
  EXAMPLE_TENANT_DISABLE_REQUEST_TYPE,
  EXAMPLE_TENANT_DISABLE_MESSAGE.claims,
);
export const TENANT_ENABLE_REQUEST = buildTenantLifecycleExample(
  'tenant-enable-example-001',
  EXAMPLE_TENANT_ENABLE_REQUEST_TYPE,
  EXAMPLE_TENANT_ENABLE_MESSAGE.claims,
);
export const TENANT_PURGE_REQUEST = buildTenantLifecycleExample(
  'tenant-purge-example-001',
  EXAMPLE_TENANT_PURGE_REQUEST_TYPE,
  EXAMPLE_TENANT_DELETE_MESSAGE.claims,
);
export const INDIVIDUAL_ORGANIZATION_DISABLE_REQUEST = EXAMPLE_INDIVIDUAL_ORGANIZATION_DISABLE_PAYLOAD;
export const INDIVIDUAL_ORGANIZATION_PURGE_REQUEST = EXAMPLE_INDIVIDUAL_ORGANIZATION_PURGE_PAYLOAD;

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.2
 * Initial request to register a new family organization.
 */
export const FAMILY_REGISTRATION_REQUEST = {
  "jti": "family-registration-request-<test-id>",
  "thid": "family-registration-thread-<test-id>",
  "iss": "adult1@example.com",
  "aud": "did:web:api.acme.org",
  "type": "application/api+json",
  "attachments": [{
    "id": "signed-individual-form-pdf",
    "media_type": "application/pdf",
    "data": {
      "links": ["{{signedIndividualFormPdfUrl}}"]
    }
  }],
  "body": {
    "data": [{
      "type": "Family-registration-form-v1.0",
      "resource": {
        "meta": {
          "claims": {
            "@context": "org.schema",
            "@type": "template",
            ...testFamilyRegisterExpanded,
            "Organization.owner.email": "adult1@example.com",
            "Service.termsOfService": "https://provider.example.com/terms.pdf",
          }
        }
      }
    }]
  },
  "meta": { ...metaRequestBodyFullJWK }
};

export const FAMILY_REGISTRATION_REQUEST_INLINE_BASE64 = {
  ...FAMILY_REGISTRATION_REQUEST,
  attachments: [{
    id: 'signed-individual-form-pdf',
    media_type: 'application/pdf',
    data: {
      base64: '{{signedIndividualFormPdfBase64}}',
    },
  }],
};

/**
 * Canonical successor of `FAMILY_REGISTRATION_REQUEST`.
 *
 * The transport payload is the same; the only difference is the route action:
 * `.../Organization/_transaction` instead of `.../Organization/_batch`.
 */
export const FAMILY_REGISTRATION_TRANSACTION_REQUEST = {
  ...FAMILY_REGISTRATION_REQUEST,
  jti: 'family-registration-transaction-request-<test-id>',
  thid: 'family-registration-transaction-thread-<test-id>',
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 8.2.1
 * Request to confirm the family registration via an Order.
 * Use the Offer identifier returned by the Family registration _batch-response.
 */
export const FAMILY_ORDER_REQUEST = {
  "jti": "family-order-request-<test-id>",
  "thid": "family-order-thread-<test-id>",
  "iss": "adult1@example.com",
  "aud": "did:web:api.acme.org",
  "type": "application/api+json",
  "body": {
    "data": [{
      "type": "Family-order-request-v1.0",
      "resource": { "meta": {
        "claims": {
          "@context": Format.SCHEMA,
          [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: "{{offerId}}"
        }
      } }
    }]
  },
  "meta": { ...metaRequestBodyOnlyKidHeader }
};

/**
 * Canonical host-side first step for legal organization onboarding via ICA
 * `_verify`.
 *
 * This is intentionally distinct from legacy compatibility `_activate`:
 * - `_transaction` carries the signed PDF evidence and controller business
 *   binding key
 * - `_transaction` is complete without requiring `_activate` as a follow-up
 * - `_activate` only exists for callers that already start from an ICA proof
 */
export const ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST = {
  jti: 'organization-verification-transaction-request-<test-id>',
  thid: 'organization-verification-transaction-thread-<test-id>',
  iss: 'did:web:portal.example.org',
  aud: 'did:web:host.example.org',
  type: 'application/api+json',
  body: organizationVerificationTransactionBody,
  attachments: organizationVerificationTransactionAttachments,
  meta: { ...metaRequestBodyFullJWK },
};

/**
 * Existing-tenant recovery request. The payload family intentionally matches
 * `_transaction` because GW forwards the same legal evidence set to ICA
 * `_verify`, but the continuation semantics differ: no new Offer is created.
 */
export const ORGANIZATION_ISSUE_REQUEST = {
  ...ORGANIZATION_VERIFICATION_TRANSACTION_REQUEST,
  jti: 'organization-issue-request-<test-id>',
  thid: 'organization-issue-thread-<test-id>',
};

/**
 * Canonical `_transaction-response` shape for host-side legal-organization
 * onboarding.
 *
 * The response must preserve two independent concerns:
 * - ICA verification output (`resource.icaResponse`)
 * - host-side continuation contract (`meta.claims` + `resource.next`) so the
 *   caller can submit `Order/_batch` with the generated Offer identifier
 */
export const ORGANIZATION_VERIFICATION_TRANSACTION_RESPONSE = {
  jti: 'organization-verification-transaction-response-<test-id>',
  thid: 'organization-verification-transaction-thread-<test-id>',
  iss: 'did:web:host.example.org',
  aud: 'did:web:portal.example.org',
  type: 'hosting-response',
  body: {
    resourceType: 'Bundle',
    type: 'transaction-response',
    total: 1,
    data: [{
      type: 'Organization-verification-transaction-response-v1.0',
      vc: [{
        resourceType: 'Organization',
        id: 'urn:uuid:org-vc-001',
        type: ['VerifiableCredential', 'OrganizationCredential'],
        credentialSubject: {
          id: 'did:web:globaldatacare.es:onehealth:organization:taxid:VATES-B00112233',
          taxID: 'VATES-B00112233',
        },
      }],
      resource: {
        meta: { claims: {
          '@context': 'org.schema',
          ...testClaimsRegisterTenantExpanded,
          'org.schema.Organization.alternateName': 'acme-health',
          'org.schema.Offer.identifier': 'urn:cds:ES:v1:health-care:product:org.schema:Offer:<offer-uuid>',
        } },
        icaResponse: {
          resourceType: 'Bundle',
          type: 'batch-response',
          total: 1,
          data: [{
            type: 'VerifyResponse-v1.0',
            resource: {
              resourceType: 'Bundle',
            },
          }],
        },
        next: {
          action: 'Order/_batch',
          acceptedOffer: {
            identifier: 'urn:cds:ES:v1:health-care:product:org.schema:Offer:<offer-uuid>',
            identifierClaim: 'org.schema.Order.acceptedOffer.identifier',
          },
        },
      },
      response: { status: '200' },
    }],
  },
};


// --- Other Payloads (Retained for existing tests) ---

export const CUSTOMER_ONBOARDING_MESSAGE = {
  jti: "unique-customer-onboard-message-<test-id>",
  thid: "thread-onboarding-customer-id",
  iss: "did:web:acme.org:employee:...",
  aud: "did:web:acme.org",
  type: "application/api+json",
  body: {
    data: [{
      type: "Individual-terms-v1.0",
      resource: {
        meta: { claims: {
          "org.schema.Person.alternateName": "Joe",
          "org.schema.Person.identifier": "urn:uuid:8e0d846a-2492-4b9c-8a4e-5e065fb6ba76",
          "org.schema.Person.email": "customer1@example.com",
          "org.schema.Service.category": "health-care",
          "org.schema.Service.serviceType": "http://terminology.hl7.org/CodeSystem/v3-ActReason|FAMRQT,PWATRNY,METAMGT,FRAUD,RECORDMGT,COVAUTH,TREAT,DISASTER,HPAYMT,MLTRAINING,ETREAT,HOPERAT,CAREMGT,HSYSADMIN,PATADMIN,PATSFTY",
          "org.schema.Service.termsOfService": pdfEmbeddedData,
        } },
      },
      request: {
        method: "POST",
        url: "individual/org.schema/Person/"
      },
    },
    {
      type: "Personal-identity-v1.0",
      resource: {
        meta: { claims: {
          "org.schema.Person.identifier": "urn:uuid:8e0d846a-2492-4b9c-8a4e-5e065fb6ba76",
          "org.schema.Person.identifierType": "NNES",
          "org.schema.Person.identifierValue": "12345678X",
        } },
      },
      request: {
        method: "POST",
        url: "individual/org.schema/Person/"
      },
    }],
  },
};

export const CONSENT_CREATION_MESSAGE = {
  jti: "unique-consent-fhir-message-<test-id>",
  thid: "thread-consent-fhir-batch-<test-id>",
  iss: "did:web:ehr-system.example.com",
  aud: "did:web:gateway.example.com",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      url: "https://ehr-system.example.com/fhir/r4/Consent/patient-consent-uuid",
      type: "Consent",
      request: {
        method: "POST",
        url: "/health-care/individual/org.hl7.fhir.api/Consent"
      },
      resource: {
        meta: {
          claims: {
            "@context": "org.hl7.fhir.api",
            "Consent.decision": "permit",
            "Consent.subject": "{{individualDid}}",
            "Consent.identifier": "urn:uuid:patient-consent-uuid",
            "Consent.grantee": "{{physicianOrg}}",
            "Consent.date": "2025-11-25",
            "Consent.purpose": HealthcareConsentPurposes.Treatment,
            "Consent.action": HealthcareConsentActions.AllergiesAndIntolerances,
            "Consent.actor-identifier": "{{physicianDid}}",
            "Consent.actor-role": HealthcareActorRoles.Physician,
            "Consent.attachment-contenttype": "application/odrl+json",
            "Consent.attachment-data": "eyAiQGNvbnRleHQiOiAiaHR0cDovL3d3dy53My5vcmcvbnMvb2RybC5qc29ubGQiLCAiQHR5cGUiOiAiQWdyZWVtZW50Ii...sgIlRSRUFUIiB9XSB9XSB9"
          }
        },
        identifier: "urn:uuid:patient-consent-uuid",
        resourceType: "Consent",
        status: "active",
        scope: {
          coding: [{
            system: "http://terminology.hl7.org/CodeSystem/consentscope",
            code: "patient-privacy"
          }]
        },
        category: [{
          coding: [{
            system: "http://terminology.hl7.org/CodeSystem/consentcategorycodes",
            code: HealthcareConsentPurposes.Treatment
          }]
        }],
        patient: { reference: "{{individualDid}}" },
        performer: [{ reference: "{{physicianDid}}" }],
        provision: { type: "permit" },
        sourceAttachment: {
          contentType: "application/odrl+json",
          data: "eyAiQGNvbnRleHQiOiAiaHR0cDovL3d3dy53My5vcmcvbnMvb2RybC5qc29ubGQiLCAiQHR5cGUiOiAiQWdyZWVtZW50Ii...sgIlRSRUFUIiB9XSB9XSB9"
        },
      },
    }]
  }
}

export const COMMUNICATION_CREATION_MESSAGE = {
  jti: "unique-communication-message-<test-id>",
  thid: "thread-communication-id",
  iss: "did:web:ehr-system.example.com",
  aud: "did:web:gateway.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      type: "Communication",
      request: {
        method: "POST",
        url: "individual/org.hl7.fhir.r4/Communication"
      },
      resource: {
        meta: {
          claims: {
            "@context": "org.hl7.fhir.api",
            "@type": "Communication:Appointment",
            "Communication.category": "http://terminology.hl7.org/CodeSystem/communication-category|reminder",
            "Communication.content-attachment-data": "QkVHSU4...5EQVI=",
            "Communication.content-attachment-title": "appointment-details.ics",
            "Communication.content-attachment-type": "text/calendar",
            "Communication.content-reference": "https://url-to-appointment-source.com/some-uuid",
            "Communication.part-of": "urn:uuid:communication-channel-id",
            "Communication.recipient": "{{individualDid}}",
            "Communication.sender": "{{physicianDid}}",
            "Communication.sent": "2025-10-15T14:30:00Z",
            "Communication.subject": "{{individualDid}}",
            "Communication.text": "This is your new appointment. Best regards."
          }
        },
        resourceType: "Communication",
        status: "completed",
        partOf: [{ reference: "urn:uuid:communication-channel-id" }],
        category: [{
          coding: [{
            code: "reminder",
            system: "http://terminology.hl7.org/CodeSystem/communication-category"
          }]
        }],
        recipient: [{ reference: "{{individualDid}}" }],
        sender: { reference: "{{physicianDid}}" },
        sent: "2025-10-15T14:30:00Z",
        note: [{ text: "This is your new appointment. Best regards." }],
        payload: [
          {
            contentReference: {
              reference: "https://url-to-appointment-source.com/some-uuid"
            }
          },
          {
            contentAttachment: {
              contentType: "text/calendar",
              data: "QkVHSU46VkNBTEVOREFSCgpWRVJTSU9OOjIuMApQUk9ESUQ6LS8vQWNtZS8vZGlkOndlYjphcGkuYWNtZS5vcmcvL0VTCkJFR0lOOlZFVkVOVApVSUQ6PHV1aWQtdjQ+CkRUU1BTVA6MjAyNTEwMTZUMTIwMDAwWgpEVFNUQVJUOjIwMjUxMDE3VDE1MDAwMFoKRF RFTkQ6MjAyNTEwMTdUMTYwMDAwWgpTVU1NQVJZOlJlc3VtZW4gZGUgY2l0YS4KREVTQ1JJUFRJT046RW5jdWVudHJvIHZpcnR1YWwuCkxPQ0FUSU9OOk9ubGluZQpFTkQ6VkVWRU5UCkVORDpWQ0FMRU5EQVI=",
              title: "appointment-details.ics"
            }
          }
        ]
      }
    }]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 9
 * Update the Unified Health Index (FHIR Composition) with a single entry.
 */
export const COMPOSITION_UPDATE_MESSAGE = {
  "jti": "composition-update-request-<test-id>",
  "thid": "composition-update-thread-<test-id>",
  "iss": "{{physicianDid}}",
  "aud": "did:web:api.acme.org",
  "exp": 1678886460,
  "iat": 1678886400,
  "nbf": 1678886400,
  "type": "org.hl7.fhir.r4.Bundle",
  "body": {
    "resourceType": "Bundle",
    "type": "batch",
    "entry": [{
      "type": "Composition",
      "resource": {
        "resourceType": "Composition",
        "status": "final",
        "meta": { "claims": {
          "@context": "org.hl7.fhir.api",
          "@type": "Composition:IndexEntry",
          "Composition.subject": "{{individualDid}}",
          "Composition.section": "LOINC|48765-2",
          "Composition.entry": "https://ehr.hospital.example.com/fhir/AllergyIntolerance/12345,https://ehr.hospital.example.com/fhir/DiagnosticReport/67890",
          "Composition.date": "2025-11-26T10:00:00Z",
          "Composition.author": "{{physicianDid}}",
          "Composition.title": "Allergies and Intolerances: hospital.example.com (2025-11-26T10:00:00Z)",
          "Composition.type": "LOINC|60591-5"
        } },
        "subject": { "reference": "{{individualDid}}" },
        "date": "2025-11-26T10:00:00Z",
        "author": [{ "reference": "{{physicianDid}}" }],
        "title": "Allergies and Intolerances: hospital.example.com (2025-11-26T10:00:00Z)",
        "type": { "coding": [{ "system": "http://loinc.org", "code": "60591-5" }] },
        "section": [{
          "title": "Allergies and Intolerances",
          "code": { "coding": [{ "system": "http://loinc.org", "code": "48765-2" }] },
          "entry": [
            { "reference": "https://ehr.hospital.example.com/fhir/AllergyIntolerance/12345" },
            { "reference": "https://ehr.hospital.example.com/fhir/DiagnosticReport/67890" }
          ]
        }]
      },
      "request": {
        "method": "POST",
        "url": "individual/org.hl7.fhir.r4/Composition"
      }
    }]
  }
};

/**
 * @see API_INTEGRATORS_GUIDE.md section 9.A
 * Research ingestion (digital twin) using claims-first Composition resources,
 * typically generated by adapter-ingestion-py from vendor exports (e.g., Qvet/Wakyma).
 *
 * Notes:
 * - This payload intentionally uses `body.data[]` (JSON:API primary document style).
 * - `resource.meta.claims` contains Composition flat claims.
 * - `resource.contained[].meta.claims` can carry source-level claims (DocumentReference, etc.).
 * - Current gateway manager persists only Composition-level claims for indexing.
 */
export const RESEARCH_COMPOSITION_INGESTION_MESSAGE = {
  jti: 'research-composition-request-<test-id>',
  thid: 'research-composition-thread-<test-id>',
  iss: 'did:web:clinic.example.com:employee:data-loader',
  aud: 'did:web:api.acme.org',
  type: 'application/api+json', // instead of 'org.hl7.fhir.api.Bundle' as "data" property is used (JSON:API Primary Document) but not "entry"
  body: {
    resourceType: 'Bundle',
    type: 'batch',
    data: [
      {
        type: 'Composition',
        resource: {
          resourceType: 'Composition',
          id: 'urn:uuid:0dbe2f39-3f6a-48a3-9807-2f9a102f1a11',
          meta: {
            claims: {
              '@context': 'org.hl7.fhir.api',
              '@type': 'Composition:ResearchDigitalTwin',
              'Composition.subject': 'did:web:connector.example.com:animal:multihash:z3vYh7w9q2p1k4m8n6a5b4c3d2e1f0',
              'Composition.section': 'LOINC|26436-6',
              'Composition.type': 'LOINC|60591-5',
              'Composition.date': '2026-01-31T10:45:00Z',
              'Composition.author': '',
              'Composition.entry': 'urn:uuid:c2b1f9ee-90d4-4f1d-8dc6-4c3f0b29621b,urn:uuid:aad1f0bc-5781-42dc-9d8f-30252fbce6a9',
            },
          },
          contained: [
            {
              resourceType: 'DocumentReference',
              id: 'urn:uuid:c2b1f9ee-90d4-4f1d-8dc6-4c3f0b29621b',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'DocumentReference:Lab',
                  'DocumentReference.subject': 'did:web:connector.example.com:animal:multihash:z3vYh7w9q2p1k4m8n6a5b4c3d2e1f0',
                  'DocumentReference.identifier': 'urn:uuid:c2b1f9ee-90d4-4f1d-8dc6-4c3f0b29621b',
                  'DocumentReference.type': 'http://loinc.org|26436-6',
                  'DocumentReference.category': 'http://loinc.org|26436-6',
                  'DocumentReference.status': 'current',
                  'DocumentReference.date': '2026-01-15T09:00:00Z',
                  'DocumentReference.description': 'Laboratorio propio',
                },
              },
            },
            {
              resourceType: 'DocumentReference',
              id: 'urn:uuid:aad1f0bc-5781-42dc-9d8f-30252fbce6a9',
              meta: {
                claims: {
                  '@context': 'org.hl7.fhir.api',
                  '@type': 'DocumentReference:Imaging',
                  'DocumentReference.subject': 'did:web:connector.example.com:animal:multihash:z3vYh7w9q2p1k4m8n6a5b4c3d2e1f0',
                  'DocumentReference.identifier': 'urn:uuid:aad1f0bc-5781-42dc-9d8f-30252fbce6a9',
                  'DocumentReference.type': 'http://loinc.org|18748-4',
                  'DocumentReference.category': 'http://loinc.org|18726-0',
                  'DocumentReference.status': 'current',
                  'DocumentReference.date': '2026-01-16T12:30:00Z',
                  'DocumentReference.description': 'Diagnostico por imagen propio',
                },
              },
            },
          ],
        },
        request: {
          method: 'POST',
          url: 'digitaltwin/org.hl7.fhir.api/Composition',
        },
      },
    ],
  },
};

// --- 8. Personal Observations (non-clinical) ---

export const PERSONAL_OBSERVATION_MESSAGE = {
  jti: "personal-observation-message-<test-id>",
  thid: "thid-personal-observation",
  iss: "{{individualDid}}:device:<uuid>",
  aud: "did:web:api.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      type: "Observation",
      resource: {
        resourceType: "Observation",
        status: "final",
        meta: { claims: {
          "@context": "org.hl7.fhir.api",
          "@type": "Observation:SelfReported",
          "Observation.subject": "{{individualDid}}",
          "Observation.category": "http://terminology.hl7.org/CodeSystem/observation-category|social-history",
          // User-selected code (e.g., from a picker based on a curated SNOMED IPS ValueSet).
          // NOTE:
          // - Keep observations atomic: one concept per Observation.
          // - SNOMED codes MUST be concept IDs (not description IDs). In the IPS release file, the "conceptId" is the code.
          "Observation.code": "SNOMED|48694002",
          "Observation.code-userselected": true,
          // FHIR: `issued` = when the Observation was created/recorded.
          // `effective[x]` = when the finding applies (e.g., NIGHT for recurring symptoms).
          "Observation.issued": "2025-11-27T10:00:00Z",
          // Flat claims follow the FHIR SearchParameter "date" concept (effective[x]) and custom extensions.
          // Canonical internal mapping can convert this to `effectiveTiming.repeat.when`.
          "Observation.date-when": "NIGHT",
          // Free text details (optional). If you want to capture "music preferences", emit separate Observations.
          // FHIR search-param style value key:
          "Observation.value-string": "Feels anxious at night.",
          // Optional short English tags for grouping/routing (comma-separated).
          "Observation.meta-tag": "Anxiety,Night",
        } }
      },
      request: { method: "POST", url: "individual/org.hl7.fhir.api/Observation" },
    }]
  }
};

export const PERSONAL_PREFERENCES_MDS_MESSAGE = {
  jti: "personal-preferences-mds-message-<test-id>",
  thid: "thid-personal-preferences-mds",
  iss: "{{individualDid}}:device:<uuid>",
  aud: "did:web:api.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [
      {
        type: "Observation",
        resource: {
          resourceType: "Observation",
          status: "final",
          meta: { claims: {
            "@context": "org.hl7.fhir.api",
            "@type": "Observation:SelfReported",
            "Observation.subject": "{{individualDid}}",
            "Observation.category": "http://terminology.hl7.org/CodeSystem/observation-category|social-history",
            "Observation.code": "LOINC|54728-1",
            "Observation.code-userselected": true,
            "Observation.issued": "2025-11-27T10:05:00Z",
            "Observation.value-concept": "http://terminology.hl7.org/CodeSystem/v2-0136|Y",
          } }
        },
        request: { method: "POST", url: "individual/org.hl7.fhir.api/Observation" },
      },
      {
        type: "Observation",
        resource: {
          resourceType: "Observation",
          status: "final",
          meta: { claims: {
            "@context": "org.hl7.fhir.api",
            "@type": "Observation:SelfReported",
            "Observation.subject": "{{individualDid}}",
            "Observation.category": "http://terminology.hl7.org/CodeSystem/observation-category|social-history",
            "Observation.code": "LOINC|54723-2",
            "Observation.code-userselected": true,
            "Observation.issued": "2025-11-27T10:05:05Z",
            "Observation.value-concept": "http://terminology.hl7.org/CodeSystem/v2-0136|Y",
          } }
        },
        request: { method: "POST", url: "individual/org.hl7.fhir.api/Observation" },
      }
    ]
  }
};

export const FAMILY_MEMBER_RELATIONSHIP_MESSAGE = {
  jti: "family-relationship-message-<test-id>",
  thid: "thid-family-relationship",
  iss: "{{individualControllerDid}}:device:<uuid>",
  aud: "did:web:api.acme.org",
  type: "org.hl7.fhir.r4.Bundle",
  body: {
    resourceType: "Bundle",
    type: "batch",
    entry: [{
      type: "RelatedPerson",
      resource: {
        resourceType: "RelatedPerson",
        meta: { claims: {
          "@context": "org.hl7.fhir.api",
          "@type": "RelatedPerson:EmergencyContact",
          "RelatedPerson.patient": "{{individualDid}}",
          "RelatedPerson.identifier": "urn:uuid:related-person-uuid",
          "RelatedPerson.relationship": "http://terminology.hl7.org/CodeSystem/v3-RoleCode|PRN",
          "RelatedPerson.role": "CAREGIVER,ECON,DEPEN,BILL",
          "RelatedPerson.telecom": "tel:+34600123456",
          "RelatedPerson.name": "Jane Doe",
        } }
      },
      request: { method: "POST", url: "individual/org.hl7.fhir.api/RelatedPerson" },
    }]
  }
};
