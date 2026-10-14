# Architecture

SOSCHAIN Gateway is a specialized gateway built on the architecture and
contracts established by GW CORE in the Global Data Care data-space ecosystem.
SOSCHAIN owns its emergency-domain behavior; GW CORE remains the upstream
source for the generic gateway foundation.

```text
Global Data Care data-space foundation
  ├─ GW CORE --------------------------> SOSCHAIN Gateway service
  └─ gdc-common-utils-ts --------------> shared utility/identity contracts

FHIR and SOS interoperability libraries
  └─ fhir-data-utils-ts
       └─ sos-data-utils-ts
            └─ sos-sdk-core-ts --------> application/BFF integrations
                         \-------------> SOSCHAIN Gateway API

Node integration and upstream compatibility
  ├─ gdc-sdk-core-ts ------------------> inherited SDK contracts
  ├─ gdc-sdk-node-ts ------------------> upstream gateway integration tooling
  └─ sos-sdk-node-ts ------------------> SOS Node.js/BFF integrations
```

The diagram describes ownership and integration direction, not a claim that
every repository is a direct npm dependency of this service. Check the lockfile
for the exact runtime dependency graph.

## Gateway boundary

The gateway validates authenticated tenant-scoped requests, applies
claims-first resource contracts, routes governed operations to configured
adapters and generates OpenAPI for its implemented routes. Applications and
BFFs own user interaction, wallet/device coordination and presentation. A UI
selection does not grant gateway authority.

## Interoperability boundary

HL7 FHIR resource names and coding systems are used where the selected FHIR
version defines them. SOS claims carried in `resource.meta.claims` are a
project extension and are not part of base FHIR. Translation between the
claims-first operational model and strict FHIR belongs at explicit import or
export boundaries.

## Human and animal emergency profiles

SOSCHAIN supports emergency continuity for people and animals through shared
gateway infrastructure and separate policy profiles. Those profiles must not
merge subject indexes, tenant data, cryptographic custody, ledger identities,
deployment configuration or authorization evidence.
