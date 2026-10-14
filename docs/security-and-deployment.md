# Security and deployment

SOSCHAIN Gateway is fail-closed. Production startup and protected operations
must reject missing or untrusted authentication, tenant authority, subject
scope, consent, key custody or persistence configuration.

## Secrets

- Never commit private keys, bearer tokens, cloud credentials or populated
  environment files.
- Public templates contain placeholders only.
- Use the deployment platform's secret manager and workload identity.
- Treat test private keys as disposable fixtures and keep them isolated from
  any real trust domain.

## Key custody

Production key-encryption keys are unwrapped through the configured KMS during
process bootstrap. Tenant operations use the process-owned runtime resource;
they must not silently fall back to demo secrets or infer custody from a
selected tenant or index provider.

## Deployment

The service is released as an immutable container image, not as an npm package.
Validate the complete affected local matrix before building an image. Promote
the same verified source through local-network and later environments, and
deploy by image digest.

Environment-specific domains, tenant identifiers, cloud projects, service
accounts, ledger channels and KMS identifiers are deployment configuration.
They do not belong in this public repository.

Follow [SECURITY.md](../SECURITY.md) to report vulnerabilities. Do not open a
public issue containing a credential, exploit payload or tenant information.
