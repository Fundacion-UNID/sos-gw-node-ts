# GW VetChain adaptation boundary

Use the separate `gw-vetchain-local-image-release` skill. Reuse the release
mechanism, never the UNID target values.

Revalidate and replace:

- repository and package name
- Docker image repository
- GCP project or other cloud account
- region, cluster, context and namespace
- Deployment, Service and Secret names
- reserved IP, DNS and TLS front door
- `MAINSECTOR`, `SUBSECTORSALLOWED` and routed sector
- Fabric MSP, identity/data channels and chaincodes
- host legal identity, jurisdiction and controller
- public DID Web domains and service endpoints
- PETD/card resolution profile
- credential issuer allowlists and consent policy
- smoke fixtures for animal, veterinarian, breeder, farm and owner roles

Keep these invariants:

- support/passport DID, animal DID, controller DID, index-service DID and
  concrete endpoints remain distinct
- no sensitive health or owner data is stored on PETD
- build and validate one local immutable `linux/amd64` image
- publish that exact image and deploy by digest
- isolate cloud, Docker and kube client state
- verify public health/API-docs endpoints and the effective pod digest

Do not copy UHC emergency-country restrictions into VetChain without an
explicit veterinary policy decision. Do not expose owner personal data merely
because emergency animal access is allowed.
