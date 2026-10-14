# GW UNID staging target

Verify these values live before every deployment because infrastructure can
change:

- GCP project: `uhc-unid`
- Region: `europe-west4`
- GKE cluster: `fabric-uhc-unid-staging`
- Expected context: `gke_uhc-unid_europe-west4_fabric-uhc-unid-staging`
- Namespace: `staging-test-network-unid-v2`
- Deployment and Service: `uhc-unid-gw`
- Artifact repository:
  `europe-west4-docker.pkg.dev/uhc-unid/uhc-unid/gdc-unid-node-ts`
- Reserved public address resource: `uhc-unid-gw-staging-ip`
- Current reserved public address: `34.158.165.169`
- Internal Service DNS:
  `uhc-unid-gw.staging-test-network-unid-v2.svc.cluster.local`

The public origin is the LoadBalancer or its future DNS/TLS front door. The
Service `CLUSTER-IP` and GKE control-plane endpoint are never public GW URLs.

Primary configuration:

- `.env.staging`, copied from `env.staging.example` and kept outside Git
- `deploy/uhc-staging/gke.config`
- `deploy/gke-gw/` and `scripts/deploy-gke-gw.sh`

Firebase project boundaries:

- `FIREBASE_PROJECT_ID=uhc-unid` selects the primary Firebase Admin project
  used by the GW data plane and its default Firebase token verifier.
- `FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS=uhc-unid-personal-staging` allows this
  GW to verify user ID tokens issued by the staging portal's Firebase project.
- Values are Firebase project IDs found in the token `aud` claim, never portal
  origins such as `https://uhc-personal-st.unid.online`.
- The additional allowlist does not redirect Firestore/GCS, initialize a
  second GW data plane or grant actor, subject, SMART or clinical permission.
  Full Firebase verification and the existing GW authorization checks remain
  mandatory.

Generic identity and ConsentAccess smart contracts are owned by GW CORE. The
UNID local-network deployer uses `../gwtemplate-node-ts/chaincode/` because
historical UNID compatibility copies may omit ignored `lib/` sources. Do not
create a VetChain-specific fork of those generic contracts without an explicit
contract change.

The single-peer devnet must commit generic identity chaincodes with
`OR('Org1MSP.member')`. A channel-default policy that expects an absent Org2
will let deployment finish but fail the first host bootstrap transaction with
`failed to collect enough transaction endorsements`.

Before mutation, inspect:

```bash
gcloud config list
kubectl config current-context
kubectl get namespace staging-test-network-unid-v2
gcloud compute addresses describe uhc-unid-gw-staging-ip \
  --region europe-west4 --project uhc-unid
kubectl -n staging-test-network-unid-v2 get service,deployment uhc-unid-gw -o wide
```

Cross-portal subject binding remains empty unless the exact verified issuer
`did:web` is approved. It is unrelated to exposing `/host/ping` or
`/api-docs/`. The standard GW UNID release smoke therefore keeps
`RUN_RESEARCH_SMART_SMOKE=false`; same-portal individual SMART access remains
mandatory.
