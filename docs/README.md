# SOSCHAIN Gateway documentation

This repository owns the SOS gateway-facing BFF and portal composition
documentation, as GW CORE did for the original integration. SDK documentation
describes reusable APIs and runtime mechanics only. Start with the
[BFF beginner contract](101-PORTAL_BFF_CONTRACT.md), continue with the
[complete portal API reference](PORTAL_API_TO_GW_CORE.md), then the
[host and tenant administration reference](HOST_AND_TENANT_ADMINISTRATION.md)
and [BFF Node runtime integration](BFF_NODE_RUNTIME.md).

This documentation describes SOSCHAIN Gateway v2. It intentionally does not
copy the inherited GW CORE manuals. Follow the upstream links when you need the
foundation's original design or version-specific reference.

## Reading order

1. [Architecture](architecture.md)
2. [BFF beginner contract](101-PORTAL_BFF_CONTRACT.md)
3. [Complete portal API reference](PORTAL_API_TO_GW_CORE.md)
4. [Host and tenant administration](HOST_AND_TENANT_ADMINISTRATION.md)
5. [Portal and demo deployment scope](PORTAL_DEPLOYMENT_SCOPE.md)
6. [BFF integration profile](bff-integration.md)
7. [BFF Node runtime integration](BFF_NODE_RUNTIME.md)
8. [Getting started](getting-started.md)
9. [API and interoperability](api-and-interoperability.md)
10. [Identifier-free public-health statistics](PUBLIC_HEALTH_STATISTICS.md)
11. [Security and deployment](security-and-deployment.md)
12. [Upstream projects and history](upstream-and-history.md)

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
