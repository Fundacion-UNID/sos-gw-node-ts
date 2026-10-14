# Upstream projects and history

## GW CORE

SOSCHAIN Gateway extends the open-source GW CORE gateway developed in the
Global Data Care ecosystem:

- [GW CORE repository](https://github.com/Global-DataCare/gwtemplate-node-ts)
- [GW CORE v1 documentation](https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/docs-v1)
- [GW CORE v2 documentation](https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/docs-v2)

These links are the canonical reference for the inherited foundation. Their
content is not copied here because copied manuals drift and blur ownership.

## Original SOSCHAIN project

The earlier SOSCHAIN documentation remains in its owning repository:

- [SOSCHAIN documentation](https://github.com/soschain/docs)

That historical documentation provides context; it is not proof that every
earlier design is implemented by the current gateway.

## Shared repositories

- [gdc-common-utils-ts](https://github.com/Global-DataCare/gdc-common-utils-ts)
- [gdc-sdk-core-ts](https://github.com/Global-DataCare/gdc-sdk-core-ts)
- [gdc-sdk-node-ts](https://github.com/Global-DataCare/gdc-sdk-node-ts)
- [fhir-data-utils-ts](https://github.com/Fundacion-UNID/fhir-data-utils-ts)
- [sos-data-utils-ts](https://github.com/Fundacion-UNID/sos-data-utils-ts)
- [sos-sdk-core-ts](https://github.com/Fundacion-UNID/sos-sdk-core-ts)
- [sos-sdk-node-ts](https://github.com/Fundacion-UNID/sos-sdk-node-ts)

Each repository owns its contracts and release history. This gateway records
only the exact package versions it consumes in its lockfile.

## Public v2 reset

The public `v2.0.0` repository begins with a clean source snapshot. It does not
publish the former private push history, inherited GW CORE documentation,
private deployment evidence or deprecated product-specific deployment
profiles. `CHANGELOG.md` is retained for technical traceability, but its older
entries do not recreate Git history or transfer ownership of upstream work.
