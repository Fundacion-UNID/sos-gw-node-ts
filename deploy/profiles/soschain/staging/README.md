# SOSChain staging gateway example

This directory contains structure-only examples. It deliberately contains no
real project, cluster, namespace, service account, domain, bucket, KMS, MSP,
legal-identity or provider inventory.

Every deployable profile is private, per product and per environment. Keep its
real `.env` outside this repository. Runtime credentials remain in the private
operator workflow and the target secret manager or Kubernetes Secret.

The release sequence remains:

1. Complete unit, integration and unskipped local E2E gates.
2. Build and smoke-test the exact `linux/amd64` image locally.
3. Load the private target `.env` and provision its dedicated dependencies.
4. Run the deployer with `DEPLOY_DRY_RUN=true` and review the resolved target.
5. Publish the tested image and deploy its immutable digest.
6. Verify health, discovery and authenticated product journeys.
7. Run compatibility testing against the canary before migrating an existing
   consumer. Never replace a provider gateway as an implicit side effect.

Do not paste a resolved dry-run, deployment manifest, secret-key inventory or
cloud-resource listing into this public repository.
