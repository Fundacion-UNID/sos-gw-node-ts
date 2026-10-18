// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// 1) Submit the canonical host Organization request; 2) inspect
// every supported OperationOutcome envelope before polling; 3) stop on an
// error and only report the tenant ready after Organization and Order succeed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('VetChain local tenant bootstrap', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts/bootstrap-single-tenant.sh'), 'utf8');

  it('uses the bare Canadian Business Number and CA-BC route defaults', () => {
    expect(script).toContain('TENANT_ID="${TENANT_ID:-704457076}"');
    expect(script).toContain('ORGANIZATION_ID_TYPE="${ORGANIZATION_ID_TYPE:-BN}"');
    expect(script).toContain('ORGANIZATION_ID_VALUE="${ORGANIZATION_ID_VALUE:-$TENANT_ID}"');
    expect(script).toContain('JURISDICTION="${JURISDICTION:-CA-BC}"');
    expect(script).toContain('ADDRESS_COUNTRY="${ADDRESS_COUNTRY:-${JURISDICTION%%-*}}"');
    expect(script).toContain('ADDRESS_REGION="${ADDRESS_REGION:-$JURISDICTION}"');
    expect(script).toContain('/body/data/0/resource/meta/claims/org.schema.Organization.address.addressRegion');
    expect(script).toContain('SECTOR="${SECTOR:-animal-care}"');
    expect(script).not.toContain('TAX_ID=');
  });

  it('uses Organization transaction for a legal clinic and never the legacy Organization batch route', () => {
    expect(script).toContain('build-host-authorization-proof.mjs');
    expect(script).toContain('/registry/org.schema/Organization/_transaction"');
    expect(script).toContain('/registry/org.schema/Organization/_transaction-response"');
    expect(script).not.toContain('/registry/org.schema/Organization/_batch"');
    expect(script).not.toContain('/registry/org.schema/Organization/_batch-response"');
  });

  it('overrides canonical Organization resource claims rather than ignored entry siblings', () => {
    expect(script).toContain('/body/data/0/resource/meta/claims/org.schema.Service.category');
    expect(script).not.toContain('/body/data/0/meta/claims/');
  });

  it('signs host authorization with the gateway authority rather than the host-side smoke URL', () => {
    const proofBuilder = readFileSync(resolve(process.cwd(), 'scripts/build-host-authorization-proof.mjs'), 'utf8');
    const smokeScript = readFileSync(resolve(process.cwd(), 'scripts/smoke-docker-local-network.sh'), 'utf8');

    expect(script).toContain('HOST_AUTHORITY_BASE_URL="$HOST_AUTHORITY_BASE_URL"');
    expect(proofBuilder).toContain("process.env.HOST_AUTHORITY_BASE_URL");
    expect(smokeScript).toContain('HOST_AUTHORITY_BASE_URL="http://localhost:${CONTAINER_PORT}"');
    expect(smokeScript).toContain('SERVICE_URL="http://localhost:${CONTAINER_PORT}"');
  });

  it('owns the local Connect ICA dependency and injects its container-reachable URL', () => {
    const envScript = readFileSync(resolve(process.cwd(), 'scripts/prepare-consentaccess-local-fabric-env.sh'), 'utf8');
    const smokeScript = readFileSync(resolve(process.cwd(), 'scripts/smoke-docker-local-network.sh'), 'utf8');

    expect(smokeScript).toContain('CONNECT_ICA_ROOT');
    expect(smokeScript).toContain('ICA_PREAUTHORIZED_HOST_DID_DOCUMENTS_JSON');
    expect(smokeScript).toContain('CONNECT_ICA_PID');
    expect(smokeScript).toContain('ICA_URL_EXTERNAL_VALUE="$LOCAL_ICA_CONTAINER_URL"');
    expect(envScript).toContain('ICA_URL_EXTERNAL_VALUE');
    expect(envScript).toContain('ICA_URL_EXTERNAL=${ICA_URL_EXTERNAL_VALUE}');
    expect(envScript).toContain('ICA_JURISDICTION=${HOST_JURISDICTION_VALUE}');
  });

  it('uses the generic local-network profile when a private local-network profile is absent', () => {
    const stackScript = readFileSync(resolve(process.cwd(), 'scripts/bootstrap-local-fabric-stack.mjs'), 'utf8');
    const envScript = readFileSync(resolve(process.cwd(), 'scripts/prepare-consentaccess-local-fabric-env.sh'), 'utf8');

    expect(stackScript).toContain("resolve(repoRoot, 'env.local-network.example')");
    expect(stackScript).toContain('BASE_ENV_FILE: config.baseEnvFile');
    expect(envScript).toContain('BASE_ENV="${BASE_ENV_FILE:-${ROOT}/.env.local-network}"');
  });

  it('fails on an entry-level Organization OperationOutcome instead of reporting readiness', () => {
    expect(script).toMatch(/org_err=.*\.data\[0\]\.response\.outcome\.issue\[0\]\.diagnostics/);
  });

  it('requires the persisted Offer before attempting Order confirmation', () => {
    expect(script).toContain('.body.data[0].resource.meta.claims["org.schema.Offer.identifier"]');
    expect(script).toContain('ERROR: organization registration completed without an Offer identifier');
  });

  it('accepts an asynchronous already-existing tenant response without requiring a new Offer', () => {
    expect(script).toMatch(/org_poll_err=[\s\S]*?\.data\[0\]\.response\.outcome\.issue\[0\]\.diagnostics/);
    expect(script).toContain('INFO: tenant already exists, skipping order.');
    expect(script).toMatch(/if \[\[ -n "\$org_poll_err" && "\$org_poll_err" == \*"already exists"\* \]\]/);
  });
});

describe('VetChain immutable local image prerequisites', () => {
  it('builds and runs the service with Node 24', () => {
    const dockerfile = readFileSync(resolve(process.cwd(), 'Dockerfile'), 'utf8');
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      engines?: { node?: string };
    };
    const baseImages = dockerfile.match(/^FROM .+$/gm) ?? [];
    expect(baseImages).toEqual([
      'FROM node:24-alpine AS builder',
      'FROM node:24-alpine',
    ]);
    expect(manifest.engines?.node).toBe('^24.0.0');
  });

  it('exposes the canonical identity-chaincode parity gate before Fabric smoke', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.['check:identity-chaincode-parity'])
      .toBe('bash ./scripts/check-identity-chaincode-parity.sh');
    expect(() => readFileSync(resolve(process.cwd(), 'scripts/check-identity-chaincode-parity.sh'), 'utf8'))
      .not.toThrow();
  });
});
