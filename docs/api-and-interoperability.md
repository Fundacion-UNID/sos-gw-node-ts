# API and interoperability

The generated OpenAPI contract is the endpoint-level source of truth. Build it
with:

```bash
npm run build:swagger
```

This produces `swagger-spec.json` and generated profiles under
`docs/openapi-profiles/`. Do not hand-maintain a second endpoint inventory in
Markdown.

Routes are scoped by host or tenant, jurisdiction, API version, sector and data
section. Authentication proves the caller; request content identifies the
business subject or participant. Those identities are not interchangeable.

The `resource.meta.claims` field is an SOS/GW extension, not a standard FHIR
element. Standard FHIR exports must materialize valid resources and must not
leak internal claims or storage metadata.

## SDK and data repositories

- [fhir-data-utils-ts](https://github.com/Fundacion-UNID/fhir-data-utils-ts)
- [sos-data-utils-ts](https://github.com/Fundacion-UNID/sos-data-utils-ts)
- [sos-sdk-core-ts](https://github.com/Fundacion-UNID/sos-sdk-core-ts)
- [gdc-common-utils-ts](https://github.com/Global-DataCare/gdc-common-utils-ts)
- [gdc-sdk-core-ts](https://github.com/Global-DataCare/gdc-sdk-core-ts)
- [gdc-sdk-node-ts](https://github.com/Global-DataCare/gdc-sdk-node-ts)

Integrators should use published package versions and the generated gateway
OpenAPI contract. A client method never widens server-side authorization.
