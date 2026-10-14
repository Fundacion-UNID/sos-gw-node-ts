# subjectkeybinding-sc

This chaincode records an operational relationship between an identity subject
and a cryptographic key. It is an audit/index contract. It is not the canonical
identity record, a channel authorization mechanism, or a replacement for the
credentialSubject.hasCredential.material claim.

## Why this is not part of cryptographickey-sc

`cryptographickey-sc` owns one record per public key and its intrinsic
lifecycle: algorithm, use, thumbprint, owner organization, status and expiry.
It answers questions about the key itself, such as whether it is active or
revoked.

`subjectkeybinding-sc` owns the many-to-many relationships that use that key.
It answers a different question: which subject uses this key, in which
operational relationship, and whether that particular relationship is active?

Keeping those records separate prevents the key asset from becoming an
unbounded array that must be rewritten every time a device, role or subject is
added or removed. It also allows one key to have several independently audited
relationships and lets one subject rotate from one key to another without
rewriting either key's immutable identity.

Example:

    cryptographickey-sc
      key-2026-01 -> { thumbprint, alg, status: "active" }

    subjectkeybinding-sc
      urn:multibase:zActorHash:professional__device-a-signing-key -> professional-signing, active
      urn:multibase:zActorHash:professional__device-b-signing-key -> professional-signing, suspended
      urn:multibase:zPersonalHash:personal__personal-device-key -> personal-signing, revoked

The binding only stores `keyId`; it must not duplicate the JWK, thumbprint,
algorithm or key lifecycle. Consumers resolve those fields from
`cryptographickey-sc` in the same channel and must require both the key and the
specific binding to be active. A binding cannot reactivate or alter a revoked
key.

This separation is deliberately not authorization by itself. The applicable
credential, employee/member relationship, licence, consent and channel policy
still decide whether an operation is permitted.

## Channel ownership boundary

Deploy the contract in each channel that owns subjects with operational keys;
do not build one cross-sector key registry.

- identity-global owns natural-person individual identities, their personal
  user/device keys, identity evidence and identity events.
- identity-REGION owns legal organizations, employees/controllers, locations,
  keys, identity evidence/events, employment and licences that must be
  referenced across several sector or animal-species channels. Registration
  there grants no sector/species write by itself.
- health-care-REGION owns professional provider/employee relationships, their
  professional keys, human clinical certification and provider-index
  permissions for that region.
- animal-pet-REGION owns animal/animal-individual-organization identity,
  multiple ownership relationships, animal clinical certification and
  provider-index permissions. It references the multi-species veterinary
  professional registered once in identity-REGION and applies the employing
  organization's ICA VC plus host grant.

REGION is one of eu, na, asia, africa, pacific or latam. A professional employee
record references the person's global UUID without copying the global human
identity into the sector channel.

## Canonical bootstrap order

The governance bootstrap is ordered:

1. Register the legal organization designated by the rulebook to execute the
   data-space committee's decisions in organization-sc on identity-REGION.
2. Register its initial Root CA controller as an employee/person belonging to
   that organization in employee-sc on identity-REGION.
3. Store the controller's canonical operation-signing commitment on that
   identity as:

       credentialSubject.hasCredential.material =
         urn:jwk:<RFC-7638-thumbprint>

   The thumbprint uses the RFC 9278 URN representation.
4. Optionally derive cryptographickey-sc and subjectkeybinding-sc records for
   operational audit, key lifecycle and lookup.

Installing or committing chaincode does not perform these writes. The current
employee-sc cannot yet persist hasCredential.material and has no one-time
bootstrap transaction. BootstrapGovernanceController remains a production
TODO. Never substitute this chaincode for that missing canonical write.

## Current GW use cases

The GW currently writes bindings in two flows:

- organization onboarding: each public JWK in the organization's DID document
  is registered in cryptographickey-sc and linked to the organization;
- employee/person device registration and replacement: each device signing or
  encryption JWK is linked to the subject, and the key and binding are marked
  revoked during revocation.

The GW resolver keeps `person` bindings on identity-global and routes
organization/employee bindings to identity-REGION. Deployments must provision
the required regional channel and chaincodes before treating these bindings as
authoritative audit state.

Typical asset:

    {
      "bindingId": "employee_<stable-actor-urn>__<key-id>",
      "subjectType": "employee",
      "subjectId": "urn:multibase:<contact-hash>:professional",
      "parentOrgId": "<organization-uuid>",
      "keyId": "<RFC-7638-thumbprint-or-key-id>",
      "relationship": "employee-device-signing",
      "status": "active"
    }

The stable actor URN is the cross-portal subject. The portal-specific DID is
stored only in `meta.attributes.did`, so changing portals or rotating a DID
does not create a different person in the audit index.

For the canonical controller operation-signing key, any derived binding must
match hasCredential.material. A mismatch is an error; this chaincode must never
override the identity claim.

## What it does today

Transactions:

- CreateSubjectKeyBinding(bindingId, payloadJson)
- UpsertSubjectKeyBinding(bindingId, payloadJson)
- ReadSubjectKeyBinding(bindingId)
- UpdateBindingStatus(bindingId, status, timestamp, reason, metadataJson)
- GetSubjectKeyBindingHistory(bindingId)

Allowed statuses are active, suspended, revoked and expired.

The contract writes subject-binding and key-binding composite index entries,
but it does not currently expose transactions to query those indexes. The GW
also does not currently read this contract in an authorization path. Therefore
the implemented value today is binding-by-ID lifecycle and history; reverse
lookup and enforcement are future work.

## Trust and credential separation

- Fabric-CA/MSP X.509 credentials authenticate internal Fabric submissions.
- The controller's public post-quantum JWK verifies application-level
  governance operations.
- Seeds and private keys never enter this asset, Fabric proposals, blocks,
  DID/JWKS documents, logs or Kubernetes configuration.

The Fabric transaction identity and the public governance signer should both be
retained as audit evidence, while remaining different credential planes.

## Test

    npm test
