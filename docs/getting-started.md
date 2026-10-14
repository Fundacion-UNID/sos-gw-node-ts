# Getting started

## Prerequisites

- Node.js 24
- npm
- Docker only for container or optional local infrastructure workflows

## Install and build

```bash
git clone https://github.com/Fundacion-UNID/sos-gw-node-ts.git
cd sos-gw-node-ts
npm ci
npm run build
```

`npm ci` uses the committed lockfile. Do not replace registry dependencies
with `file:`, Git or workspace references in a committed public change.

## Local test profile

Choose one of the generic, secret-free templates: `env.test.example`,
`env.demo.example`, `env.local-network.example` or `env.staging.example`.

```bash
cp env.test.example .env.local-demo
npm run api:local-demo
```

Keep real values in ignored `.env*` files. Never add credentials or a concrete
tenant, cloud project, KMS key, service account or private endpoint to a public
template.

## Validation

```bash
npm run check:gateway-bootstrap
npm run type-check
npm test
```

Additional integration, E2E, local-network and deployment gates depend on the
adapters changed by a contribution. A later environment does not replace a
failed earlier gate.

## API discovery

After startup, open `/api-docs` on the configured local base URL. The raw
generated contract is available as `/swagger-spec.json` and in the repository
root as `swagger-spec.json` after a build.
