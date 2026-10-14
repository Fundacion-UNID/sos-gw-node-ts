# SOSCHAIN Gateway documentation

This documentation describes SOSCHAIN Gateway v2. It intentionally does not
copy the inherited GW CORE manuals. Follow the upstream links when you need the
foundation's original design or version-specific reference.

## Reading order

1. [Architecture](architecture.md)
2. [Getting started](getting-started.md)
3. [API and interoperability](api-and-interoperability.md)
4. [Security and deployment](security-and-deployment.md)
5. [Upstream projects and history](upstream-and-history.md)

## Sources of truth

- Runtime API: the generated `swagger-spec.json` and `/api-docs` in a running
  gateway.
- Installed code: `package.json` and `package-lock.json`.
- Release history: `CHANGELOG.md`.
- Upstream GW behavior: the linked GW CORE v1/v2 documentation, not a copied
  local manual.

Documents should distinguish implemented behavior from planned behavior and
must not include tenant identities, credentials, private endpoints or copied
deployment evidence.
