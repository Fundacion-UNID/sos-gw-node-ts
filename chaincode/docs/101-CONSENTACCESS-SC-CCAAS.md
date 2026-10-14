# 101. Consent Access Smart Contract As External Service

## Purpose

This document explains how the `consentaccess-sc-javascript` package was prepared as a Fabric v2+ Chaincode as a Service (CCAAS) package.

It is intentionally written for developers who do not know the previous chaincode packages yet.

## Package Location

The smart contract package lives in:

- [consentaccess-sc-javascript](https://github.com/Global-DataCare/gwtemplate-node-ts/tree/main/chaincode/consentaccess-sc-javascript)

## What This Smart Contract Stores

The package stores a sanitized primary document with mandatory `data[]`.

The smart contract accepts a bundle-like payload and persists a sanitized bundle-like payload:

- input: primary document with `data[]`
- output: stored asset with `data[]`

The persisted asset adds `meta.audit` and removes non-allowed claims.

Important current write model:

- each `data[i]` is one atomic consent-access rule
- GW CORE submits one blockchain write per rule
- each write still uses a primary document payload, but with `data.length = 1`
- `assetId = data[0].id`
- `data[0].id` is the `CIDv1` `base58btc` identifier built from the canonical logical `ruleId`
- the clear-text logical `ruleId` never travels to the smart contract
- the link back to the source consent lives in `Consent.event-basedon`

## Why This Package Uses CCAAS

Fabric v2+ supports the chaincode lifecycle separately from the runtime process.

In this repository, this package is prepared to run as an external service instead of being launched inside the peer container.

That means:

- the peer approves and commits the chaincode definition
- the chaincode process runs outside the peer
- the peer connects to the chaincode service through `CHAINCODE_SERVER_ADDRESS`

## Files Added Or Updated

The package was prepared with these files:

- [package.json](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/consentaccess-sc-javascript/package.json)
- [metadata.json](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/consentaccess-sc-javascript/metadata.json)
- [Dockerfile](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/consentaccess-sc-javascript/Dockerfile)
- [docker/docker-entrypoint.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/consentaccess-sc-javascript/docker/docker-entrypoint.sh)

## How The Package Was Generated

The package already existed as a tested JavaScript Fabric contract. To make it usable as CCAAS, the following steps were applied.

### 1. Keep The Smart Contract Package Self-Contained

The chaincode package already contained:

- `index.js`
- `lib/`
- `test/`

The runtime is JavaScript only, so no `dist/` step is required.

### 2. Add CCAAS Scripts To `package.json`

The package now exposes these scripts:

- `npm test`
- `npm run metadata`
- `npm run docker`
- `npm run package:caas`
- `npm run package:k8s`
- `npm run start:server-nontls`
- `npm run start:server-debug`
- `npm run start:server`

These scripts follow the same pattern used by the older Fabric chaincode packages in `old/`.

### 3. Generate `metadata.json`

The metadata file was generated from the contract itself with:

```bash
npm run metadata
```

That command runs:

```bash
fabric-chaincode-node metadata generate --file metadata.json
```

This file is useful for inspection, packaging and operational documentation.

### 4. Add A Docker Image For External Service Runtime

The package now contains a multi-stage [Dockerfile](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/consentaccess-sc-javascript/Dockerfile).

It has these stages:

- `builder`
- `prod-builder`
- `ccaas`
- `k8s`

The important runtime stage for local Fabric CCAAS testing is `ccaas`.

### 5. Add A Runtime Entrypoint

The file [docker/docker-entrypoint.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/consentaccess-sc-javascript/docker/docker-entrypoint.sh) decides how the chaincode starts:

- debug mode if `DEBUG=true`
- in-process peer mode if `CHAINCODE_SERVER_ADDRESS` is missing
- TLS server mode if `CORE_PEER_TLS_ENABLED=true`
- non-TLS server mode otherwise

This matches the pattern already used by the older chaincode packages.

## Current Validation Status

The package was validated locally with:

```bash
npm test
npm run metadata
```

Results:

- unit tests pass
- coverage is 100%
- `metadata.json` is generated successfully
- the local CCAAS package archive can be generated even without `weft`
- the local Fabric devnet can install, approve and commit the chaincode

## What Was Actually Fixed In Local Development

This part is important because the final working state was not reached by a
single change.

The difficult part was not the smart contract itself. The difficult part was
making the local Docker devnet consume the deterministic CA material with the
same semantics every time.

These were the real local blockers that had to be corrected:

1. The local helper scripts were pointing developers at legacy paths that are
   no longer the source of truth.
2. The Fabric CA bootstrap was mixing deterministic CA files with stale sqlite
   CA databases from previous runs.
3. The original local bootstrap relied on intermediate-CA assumptions that were
   fine historically but were not stable in the current Docker-only dev flow.
4. `configtx.yaml` was too minimal for the current runtime and was missing:
   - channel/orderer/application policies
   - org policies
   - correct MSP relative paths
   - an orderer section in the channel profile
   - runtime-compatible capabilities
5. Orderer admin mTLS was incomplete because the admin endpoint had no
   `ClientRootCAs`.
6. The orderer identity could end up with an invalid OU combination in the
   local fallback path, which later made the peer reject blocks.
7. The original local CCAAS deploy script assumed `weft` was available even
   though Fabric only needs the standard `metadata.json` + `code.tar.gz`
   archive shape.

## Final Local Rule

The local deterministic source is:

- `fabric-multicloud/fabric-ca-server-root`
- `fabric-multicloud/fabric-ca-server-ica`

The local devnet must:

- copy those files into `../fabric-multicloud/devnet/fabric-v3/crypto/ca/*`
- remove stale CA sqlite databases
- remove stale Docker ledger volumes before a truly clean retry
- regenerate TLS server certs when SAN assumptions change
- rebuild MSPs and channel artifacts from scratch

If those steps are skipped, local retries are not deterministic anymore even if
the CA key material itself is deterministic.

## Commands Used During Preparation

From the chaincode package directory:

```bash
npm test
npm run metadata
```

The package also exposes these operational commands:

```bash
npm run docker
npm run package:caas
npm run package:k8s
```

## Environment Variables Used By The External Service

The server-based scripts rely on the standard Fabric Node chaincode variables:

- `CHAINCODE_SERVER_ADDRESS`
- `CHAINCODE_ID`
- `CORE_PEER_TLS_ENABLED`

TLS mode also expects:

- `/hyperledger/privatekey.pem`
- `/hyperledger/rootcert.pem`
- `/hyperledger/cert.pem`

## What Is Done Now

This is already working locally:

- `consentaccess-sc` tests
- `metadata.json` generation
- CCAAS package archive generation
- Docker image build
- local Fabric install
- `approveformyorg`
- `commit`

The chaincode is now deployed locally on:

- channel: `health-care-eu`
- chaincode name: `consentaccess-sc`
- runtime mode: external service / CCAAS
- local endorsement policy: `OR('Org1MSP.member')`

## What Was Also Required In GW CORE

The smart contract lifecycle was not the only moving part. The final local
smoke test also required three GW CORE fixes so the request reaching Fabric was
the same request the developers thought they were sending.

### 1. `local-network` Had To Be A First-Class Network Mode

The local Docker Fabric network is not the same thing as the shared
`test-network` in Kubernetes.

GW CORE and the helper scripts now treat `NETWORK_MODE=local-network` as a real
mode, not as an alias for cloud integration.

### 2. Plaintext FHIR Requests Had To Be Wrapped Under `content.body`

The managers expect the business payload under `job.content.body`.

Secure DIDComm flows already had that shape, but direct
`application/json` / `application/fhir+json` requests were being forwarded with
their payload only at the top level of `job.content`.

That meant the `ConsentManager` could receive an accepted async job and still
see:

- `entries = []`
- empty `_batch-response`
- no blockchain write

GW CORE now normalizes legacy plaintext requests so the same payload is
available both:

- at the top level for compatibility
- under `content.body` for managers

### 3. The Gateway Submit Path Had To Pin Endorsement To Org1

In the local devnet there is only one real endorsing org/peer combination for
this chaincode.

Even after committing a one-org chaincode policy, the generic
`contract.submitTransaction(...)` path could still fail through discovery with:

```text
FAILED_PRECONDITION: no combination of peers can be derived which satisfy the endorsement policy
```

The fix was to build the Fabric proposal explicitly and submit it with:

- `endorsingOrganizations: [mspId]`

for the local GW CORE Fabric wrapper.

## What Is Still Pending

The remaining work is no longer about basic local viability.

Still pending:

- broader automated integration coverage beyond the one successful smoke path
- optional cleanup of older bootstrap scripts once the canonical path is fully frozen

## Recommended Next Steps

1. Run GW CORE against `.env.local-fabric`.
2. Bootstrap the canonical local tenant with the existing onboarding script:
   - `TENANT_ID=acme-id`
   - `JURISDICTION=ES`
   - `SECTOR=health-care`
3. Create the canonical individual and the baseline medication resources with the
   existing demo script before testing consents.
4. Submit the consent payload only after that baseline state exists.
5. Confirm that `ConsentManager` reaches `registerConsentAccessBundle(...)`.
6. Confirm that the ledger receives `upsertConsentAccess(...)`.
7. Confirm direct peer reads against `health-care-eu` for every stored rule id.

## Canonical Local Smoke Test

The canonical local smoke test now uses the same shared consent fixtures that
already exist in `gdc-common-utils-ts`.

Scripts:

- [render-demo-consentaccess-payload.mts](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/render-demo-consentaccess-payload.mts)
- [smoke-consentaccess-local-network.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/smoke-consentaccess-local-network.sh)

The renderer reuses:

- `EXAMPLE_CONSENT_ACCESS_RULES`
- shared consent attachment fixtures

The smoke script verifies the complete contract:

1. build one consent bundle with three canonical consent entries
2. derive three atomic rules
3. submit the bundle to GW CORE
4. confirm three successful `_batch-response` entries
5. read three independent on-chain assets by hashed rule entry id

This is the expected local result:

- `3 consents`
- `3 derived rules`
- `3 blockchain writes`
- `3 on-chain assets`

## Canonical Local Jurisdictions

There are two different jurisdiction concepts in the current local setup and
they must not be mixed:

- host jurisdiction:
  - `EU`
  - this is the local node operator / ledger coverage scope
  - it is what leads to the local Fabric channel `health-care-eu`
- tenant legal jurisdiction:
  - `ES`
  - this is the jurisdiction used by the canonical single-tenant bootstrap for
    `acme-id`
  - it is the legal/provider onboarding data of the tenant, not the Fabric
    channel name

In other words:

- the local Fabric consent-access channel is still `health-care-eu`
- the canonical demo tenant is still `acme-id` in `ES`

Both are correct at the same time because they refer to different layers.

## Canonical Local Flow Before Consent Smoke

For local developer validation, do not invent a new isolated tenant bootstrap
for the consent smoke. Reuse the existing documented flow:

1. Deploy the chaincode and prepare `.env.local-fabric`.
2. Start GW CORE with that environment.
3. Bootstrap the tenant with:
   - [bootstrap-single-tenant.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/bootstrap-single-tenant.sh)
   - canonical local overrides:
     - `TENANT_ID=acme-id`
     - `JURISDICTION=ES`
     - `SECTOR=health-care`
4. Create the individual baseline first with:
   - [demo-create-individual-organization.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/demo-create-individual-organization.sh)
   - canonical local overrides:
     - `TENANT_ID=acme-id`
     - `JURISDICTION=ES`
     - `SECTOR=health-care`
   - route contract:
     - `individual/org.schema/Organization/_batch`
   - note:
     - `individual/org.schema/Person` is only a legacy compatibility alias
5. Create the baseline medication resources with:
   - [demo-communication-medications-ips.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/demo-communication-medications-ips.sh)
   - canonical local overrides:
     - `TENANT_ID=acme-id`
     - `JURISDICTION=ES`
     - `SECTOR=health-care`
   - optional negative-path flag:
     - `--no-create-individual`
6. Only after that, submit the consent flow that should write to
   `consentaccess-sc`.

This order avoids false negatives where consent fails only because the tenant or
subject baseline state was not prepared first.

## Local Fabric Environment Rule For GW CORE

The local consent-access smoke environment is intentionally not the same as a
generic "all ledgers on Fabric" environment.

For `.env.local-fabric` the canonical rule is:

- disable generic host organization ledger registration:
  - `LEDGER_ENABLED=false`
- keep consent-access Fabric writes enabled through:
  - `CONSENT_ACCESS_LEDGER_CHAINCODE=consentaccess-sc`
- `LEDGER_PROVIDER_MAP=test=mem,local-network=fabric,test-network=fabric,network=fabric`

Why this matters:

- if `LEDGER_ENABLED=true`, `HostingManager.bootstrapHost(...)` attempts to
  register the host organization on the generic organization ledger during API
  startup
- that is not required for the consent-access smoke
- and it can make the API crash before the real `acme-id -> individual ->
  medications -> consent` flow even starts

So the local consent-access smoke uses:

- host bootstrap in local in-memory mode
- consent-access writes in Fabric mode

That split is intentional.

## Consent Rule Lifecycle Rule

The current consent-access lifecycle contract is intentionally small:

- one atomic rule = one on-chain asset
- `assetId = ruleIdCidV1`
- lifecycle is carried by payload `status`
  - `active`
  - `revoked`

GW CORE currently derives that status from the source consent claims:

- default: `active`
- if `Consent.period-end` exists and is already in the past (or exactly now):
  - `revoked`
- if the same consent rule is later submitted again without an elapsed
  `Consent.period-end`, the same on-chain asset is reactivated

This means:

- revoke/reactivate changes the same blockchain asset
- it does not create a second rule id
- the history length should grow from `1 -> 2 -> 3`

Local lifecycle smoke:

- [smoke-consentaccess-lifecycle-local-network.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/smoke-consentaccess-lifecycle-local-network.sh)
- prints timing metrics for:
  - activate
  - revoke
  - reactivate

## Local-Network Script Rule

The existing bootstrap and smoke shell scripts historically defaulted to the
host registry selector `test`.

That is correct for plain demo/test runtime, but not for the local Fabric devnet.

For local Fabric devnet:

- `NETWORK_MODE=local-network`
- host onboarding must use:
  - `HOST_NETWORK=local-network`
  - `HOST_REGISTRY_SECTOR=local-network`

This is now derived automatically by the scripts:

- [bootstrap-single-tenant.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/bootstrap-single-tenant.sh)
- [bootstrap-alice-bob-discovery.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/bootstrap-alice-bob-discovery.sh)
- [smoke-alice-bob-autodiscovery.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/smoke-alice-bob-autodiscovery.sh)

So if `.env.local-fabric` exports `NETWORK_MODE=local-network`, those
scripts no longer need manual overrides just to hit the correct host onboarding
surface.

## Shared Test Data Rule

When adding consent-access developer smoke tests or integration tests, reuse the
shared fixtures that already exist in `gdc-common-utils-ts` whenever possible.

That means:

- prefer shared identifiers, actor roles, subject DIDs and reference examples
  from:
  - [gdc-common-utils-ts/src/examples/shared.ts](https://github.com/Global-DataCare/gdc-common-utils-ts/blob/main/src/examples/shared.ts)
- do not create new ad hoc literals for the same semantic values unless the test
  is explicitly about a different value
- keep local smoke scripts aligned with the same canonical sample data that the
  unit tests already use

This is important because it reduces drift between:

- common utils
- GW CORE
- chaincode payload expectations

## Local Fabric Devnet Checklist

This repository already includes a deterministic local Fabric v3 devnet under:

- `../fabric-multicloud/devnet/fabric-v3`

Use that sibling workspace path as the source of truth.

Do not use these legacy reference folders for this flow:

- `gwtemplate-node-ts/fabric-multicloud` (removed; use `../fabric-multicloud`)
- `gwtemplate-node-ts/devnet` (removed; use `../fabric-multicloud/devnet/fabric-v3`)

## Recommended One-Shot Script

The fastest local path is the dedicated script:

- [consentaccess-local-devnet.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/chaincode/scripts/consentaccess-local-devnet.sh)
- [prepare-consentaccess-local-fabric-env.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/prepare-consentaccess-local-fabric-env.sh)

Run it like this:

```bash
cd $HOME/GITS/gdc-workspace/gwtemplate-node-ts
bash ./chaincode/scripts/consentaccess-local-devnet.sh
bash ./scripts/prepare-consentaccess-local-fabric-env.sh
npm run api:local-fabric
```

What the first script now does in practice:

1. verifies the local devnet env
2. runs chaincode tests
3. regenerates `metadata.json`
4. packages a CCAAS archive
5. builds the external service image
6. installs the package on `peer0-org1`
7. restarts the external service container with the resolved `PACKAGE_ID`
8. approves the definition
9. commits the definition

The second script expects this exact generated file:

```text
$HOME/GITS/gdc-workspace/fabric-multicloud/devnet/fabric-v3/.env.fabric-devnet
```

It does not look for `.env.fabric-devnet` in the root of `fabric-multicloud`.

If that file does not exist yet, the scripts now generate it automatically by
calling:

- [ensure-fabric-devnet-env.sh](https://github.com/Global-DataCare/gwtemplate-node-ts/blob/main/scripts/ensure-fabric-devnet-env.sh)

You do not need to call that helper manually because:

- `chaincode/scripts/consentaccess-local-devnet.sh` calls it
- `scripts/prepare-consentaccess-local-fabric-env.sh` calls it

Important defaults:

- `CHANNEL_NAME=health-care-eu`
- `CHAINCODE_SERVER_ADDRESS=consentaccess-sc:9999`
- `CHAINCODE_NAME=consentaccess-sc`

Override them only when your consent smoke test uses a different `sector` or `jurisdiction`.

### Important Channel Rule

`ConsentManager` does not write to the default identity channel.

It builds the target channel as:

```text
${sector}-${jurisdiction}
```

That means the devnet channel name must match the test payload you send through GW CORE.

Example:

- `sector=health-care`
- `jurisdiction=eu`
- channel: `health-care-eu`

### Local-Network Scope

For the simplified local devnet, assume only these two channels exist:

- `identity`
- `health-care-eu`

## Important Troubleshooting Notes

If the local network breaks again, check these first:

1. `docker volume ls | rg '^gdc-fabric-v3-devnet_'`
   If volumes still exist from an older failed run, the ledger is not clean.
2. `fabric-multicloud/devnet/fabric-v3/crypto/ca/root/fabric-ca-server.db`
   and `.../ica/fabric-ca-server.db`
   These must not carry stale state into a "clean" retry.
3. `docker logs gdc-orderer`
   If the orderer admin endpoint lacks client root CAs, `osnadmin channel join`
   will fail in confusing ways.
4. `docker logs gdc-peer0-org1`
   If blocks are rejected because of OU or policy mismatches, the problem is
   usually MSP/configtx alignment, not the chaincode.
5. `docker logs consentaccess-sc`
   If install passed but invoke fails, check the external service first before
   changing the lifecycle commands.
- `health-care-eu`

For this smart contract:

- `consentaccess-sc` is deployed on `health-care-eu`
- `identity` remains available for identity-ledger flows only

### 1. Bootstrap The Devnet With The Consent Channel Name

From:

```bash
cd $HOME/GITS/gdc-workspace/fabric-multicloud/devnet/fabric-v3
```

Run:

```bash
export SINGLE_HOST=true
export HLF_CHANNEL_NAME=health-care-eu
./scripts/00-copy-dev-cas.sh
./scripts/01-up-cas.sh
./scripts/02-bootstrap-network.sh
```

### 2. Build The CCAAS Package Archive

From:

```bash
cd $HOME/GITS/gdc-workspace/gwtemplate-node-ts/chaincode/consentaccess-sc-javascript
```

Choose the service address that the peer will use inside the Docker network:

```bash
export CHAINCODE_SERVER_ADDRESS=consentaccess-sc:9999
```

Then build the package archive:

```bash
npm run package:caas
```

Expected output archive:

```text
consentaccess-sc-caas.tgz
```

### 3. Install The CCAAS Package On The Peer

The generic devnet deploy script currently packages source code from `--path`, so it is not the correct script for a prebuilt CCAAS archive.

Use the Fabric tools container directly instead.

Copy the archive into the devnet workspace:

```bash
cp $HOME/GITS/gdc-workspace/gwtemplate-node-ts/chaincode/consentaccess-sc-javascript/consentaccess-sc-caas.tgz \
   $HOME/GITS/gdc-workspace/fabric-multicloud/devnet/fabric-v3/channel-artifacts/
```

Then install it:

```bash
docker exec -w /workspace gdc-fabric-tools env \
  CORE_PEER_LOCALMSPID=Org1MSP \
  CORE_PEER_ADDRESS=peer0-org1:7051 \
  CORE_PEER_MSPCONFIGPATH=/workspace/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/workspace/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  peer lifecycle chaincode install /workspace/channel-artifacts/consentaccess-sc-caas.tgz
```

Resolve the package id:

```bash
docker exec -w /workspace gdc-fabric-tools env \
  CORE_PEER_LOCALMSPID=Org1MSP \
  CORE_PEER_ADDRESS=peer0-org1:7051 \
  CORE_PEER_MSPCONFIGPATH=/workspace/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/workspace/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  peer lifecycle chaincode queryinstalled
```

Save the package id shown for label `consentaccess-sc`.

### 4. Start The External Chaincode Service

The external chaincode service must use the installed package id as `CHAINCODE_ID`.

Run:

```bash
docker run -d \
  --name consentaccess-sc \
  --network gdc-fabric-v3-devnet \
  -e CHAINCODE_SERVER_ADDRESS=consentaccess-sc:9999 \
  -e CHAINCODE_ID='<PACKAGE_ID_FROM_QUERYINSTALLED>' \
  -p 9999:9999 \
  consentaccess-sc:latest
```

If the image does not exist yet, build it first:

```bash
cd $HOME/GITS/gdc-workspace/gwtemplate-node-ts/chaincode/consentaccess-sc-javascript
docker build --target ccaas -f ./Dockerfile -t consentaccess-sc:latest .
```

### 5. Approve And Commit The Chaincode Definition

Approve:

```bash
docker exec -w /workspace gdc-fabric-tools env \
  CORE_PEER_LOCALMSPID=Org1MSP \
  CORE_PEER_ADDRESS=peer0-org1:7051 \
  CORE_PEER_MSPCONFIGPATH=/workspace/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/workspace/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  peer lifecycle chaincode approveformyorg \
  -o orderer:7050 \
  --ordererTLSHostnameOverride orderer \
  --tls \
  --cafile /workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt \
  --channelID health-care-eu \
  --name consentaccess-sc \
  --version 1.0 \
  --package-id '<PACKAGE_ID_FROM_QUERYINSTALLED>' \
  --sequence 1
```

Commit:

```bash
docker exec -w /workspace gdc-fabric-tools env \
  CORE_PEER_LOCALMSPID=Org1MSP \
  CORE_PEER_ADDRESS=peer0-org1:7051 \
  CORE_PEER_MSPCONFIGPATH=/workspace/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp \
  CORE_PEER_TLS_ENABLED=true \
  CORE_PEER_TLS_ROOTCERT_FILE=/workspace/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt \
  peer lifecycle chaincode commit \
  -o orderer:7050 \
  --ordererTLSHostnameOverride orderer \
  --tls \
  --cafile /workspace/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt \
  --channelID health-care-eu \
  --name consentaccess-sc \
  --version 1.0 \
  --sequence 1 \
  --peerAddresses peer0-org1:7051 \
  --tlsRootCertFiles /workspace/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
```

### 6. Configure GW CORE To Use Fabric Writes

In the GW CORE environment:

```bash
export LEDGER_ENABLED=true
export LEDGER_PROVIDER_DEFAULT=fabric
export LEDGER_MSP_ID=Org1MSP
export LEDGER_FABRIC_MSP_ID=Org1MSP
export CONSENT_ACCESS_LEDGER_CHAINCODE=consentaccess-sc
export FHIR_VERSION_LEDGER_CHAINCODE=fhir-versioning
export HOST_JURISDICTION=au-nsw
export JURISDICTION=au-nsw
```

### 7. Smoke Test

Run GW CORE with the Fabric devnet env and send a consent bundle whose:

- `sector` is `health-care`
- `jurisdiction` is `eu`

Then check:

- the request succeeds in GW CORE
- `ConsentManager` writes to vault
- `ConsentManager` invokes `registerConsentAccessBundle(...)`
- the service container `consentaccess-sc` stays healthy
- `readConsentAccess(<assetId>)` returns the sanitized bundle with `data[]`
> 101 note
> - Teach here: the chaincode-side consent-access logic only after the caller already came through an SDK/app profile runtime and GW route.
> - Do not present chaincode docs as the first user/login/profile entrypoint.
> - Read [../../docs/01-OVERVIEW-AND-GUIDES/101-README.md](../../docs/01-OVERVIEW-AND-GUIDES/101-README.md) for the ordered path and upstream runtime entrypoints.
