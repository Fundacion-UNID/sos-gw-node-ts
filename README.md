# SOSCHAIN Gateway

SOSCHAIN Gateway extends **GW CORE**, the open-source gateway infrastructure
developed within the **Global Data Care ecosystem**:

- [GW CORE source](https://github.com/Global-DataCare/gwtemplate-node-ts)
- [GW CORE v1 documentation](https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/docs-v1)
- [GW CORE v2 documentation](https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/docs-v2)

It implements the backend services and integrations required by SOSCHAIN,
building on the [original SOSCHAIN project documentation](https://github.com/soschain/docs).

SOSCHAIN is part of an integrated ecosystem that shares HL7 FHIR
interoperability components, SDKs, terminology contracts, identity and trust
services, and emergency-response capabilities. This repository contains the
SOSCHAIN-specific gateway; it does not duplicate GW CORE documentation or
claim ownership of the upstream Global Data Care data-space infrastructure.

This public repository starts at **v2.0.0**. Its Git history is intentionally a
clean SOSCHAIN baseline. Earlier GW CORE and product-specific history remains
in its owning repositories and is not part of this public source history.

## Related repositories

| Repository | Responsibility |
| --- | --- |
| [GW CORE](https://github.com/Global-DataCare/gwtemplate-node-ts) | Upstream gateway and data-space foundation |
| [gdc-common-utils-ts](https://github.com/Global-DataCare/gdc-common-utils-ts) | Shared Global Data Care utility and identity contracts still consumed by this gateway |
| [gdc-sdk-core-ts](https://github.com/Global-DataCare/gdc-sdk-core-ts) | Upstream SDK contracts present through the dependency graph |
| [gdc-sdk-node-ts](https://github.com/Global-DataCare/gdc-sdk-node-ts) | Node.js SDK and live gateway integration tooling |
| [fhir-data-utils-ts](https://github.com/Fundacion-UNID/fhir-data-utils-ts) | Product-neutral HL7 FHIR data utilities |
| [sos-data-utils-ts](https://github.com/Fundacion-UNID/sos-data-utils-ts) | Shared SOS domain data contracts |
| [sos-sdk-core-ts](https://github.com/Fundacion-UNID/sos-sdk-core-ts) | High-level SOS client SDK contracts |
| [sos-sdk-node-ts](https://github.com/Fundacion-UNID/sos-sdk-node-ts) | Node.js SOS SDK and BFF/runtime integrations |
| [SOSCHAIN documentation](https://github.com/soschain/docs) | Documentation for the original SOSCHAIN project |

SDK repositories are integration peers rather than direct application code
owned by this service. The exact installed dependency graph is authoritative in
[`package-lock.json`](package-lock.json).

## What the gateway provides

- multi-tenant SOS data ingestion, indexing, search and retrieval;
- claims-first FHIR R4/R5 interoperability and generated OpenAPI contracts;
- asynchronous request and response processing;
- verifiable identity, consent, DID and SMART-on-FHIR integration;
- configurable encrypted persistence, object storage and key custody;
- optional Hyperledger Fabric adapters for governed audit and trust flows;
- separate human and animal emergency profiles over shared infrastructure.

Browser-side role or card selection is never authorization. Production
deployments must validate trusted professional authority and fail closed when
the required identity, consent or subject scope is absent.

## Documentation

Start with [the documentation index](docs/README.md):

- [Architecture](docs/architecture.md)
- [Getting started](docs/getting-started.md)
- [API and interoperability](docs/api-and-interoperability.md)
- [Security and deployment](docs/security-and-deployment.md)
- [Upstream projects and history](docs/upstream-and-history.md)

The generated OpenAPI document is `swagger-spec.json`. A running gateway serves
its interactive API documentation under `/api-docs`.

## Quick start

Requirements:

- Node.js 24
- npm with lockfile support

```bash
npm ci
cp env.test.example .env.local-demo
npm run build
npm run api:local-demo
```

The templates contain only non-secret example values. Supply real credentials
through ignored `.env*` files or the deployment secret manager; never commit
them.

Run the public-baseline checks with:

```bash
npm run check:gateway-bootstrap
npm run type-check
npm test
```

## Versioning and releases

`v2.0.0` is the first public SOSCHAIN Gateway baseline. This repository is a
deployable service, not an npm package: `package.json` remains private and
`npm publish` is blocked. Release immutable container images from a validated
`main` commit and deploy them by digest.

See [CHANGELOG.md](CHANGELOG.md) for gateway changes and
[SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

Licensed under the [Apache License 2.0](LICENSE).
