// Flow contract: the trusted host BFF SDK submits and polls the real in-memory SOS Gateway Organization registry route, and reads back the exact tenant previously written to protected host storage as a paginated DIDComm Bundle; a different bearer subject cannot read it.
import { createServer, type Server } from 'node:http';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { initializeTenantServicesConfig } from '../../utils/services';
import { getTenantVaultId } from '../../utils/tenant';
import { getEnvSectionId } from '../../utils/section-env';
import { VaultMemRepository } from '../../database/repositories/vault/vault.mem.repository';
import { buildRestartableGateway } from './helpers/restartable-gateway';
import type { RestartableGatewayHarness } from './helpers/restartable-gateway';
import { SosGatewayHostOrganizationDirectoryClient } from 'sos-sdk-node-ts/host-organization-directory-client';

function bearer(sub: string): string {
  return [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from(JSON.stringify({ sub })).toString('base64url'), 'demo'].join('.');
}

describe('host organization directory SDK integration', () => {
  let server: Server | undefined;
  let harness: RestartableGatewayHarness | undefined;
  const previous = { security: process.env.SECURITY_MODE, insecure: process.env.DEMO_ALLOW_INSECURE_BEARER, plain: process.env.DIDCOMM_PLAIN };

  afterEach(async () => {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    server = undefined;
    harness?.queueAdapter.stop();
    harness = undefined;
    process.env.SECURITY_MODE = previous.security;
    process.env.DEMO_ALLOW_INSECURE_BEARER = previous.insecure;
    process.env.DIDCOMM_PLAIN = previous.plain;
  });

  it('reads the protected authoritative tenant through the published BFF contract', async () => {
    process.env.SECURITY_MODE = 'demo';
    process.env.DEMO_ALLOW_INSECURE_BEARER = 'true';
    process.env.DIDCOMM_PLAIN = 'true';
    const vaultRepository = new VaultMemRepository();
    harness = await buildRestartableGateway(vaultRepository);
    const claims = {
      [ClaimsOrganizationSchemaorg.alternateName]: 'clinic-one',
      [ClaimsOrganizationSchemaorg.legalName]: 'Clinic One',
      [ClaimsOrganizationSchemaorg.name]: 'Clinic One',
      [ClaimsOrganizationSchemaorg.identifierType]: 'TAX',
      [ClaimsOrganizationSchemaorg.identifierValue]: 'B12345678',
      [ClaimsOrganizationSchemaorg.addressCountry]: 'ES',
      [ClaimsServiceSchemaorg.category]: 'health-care',
    };
    const vaultId = getTenantVaultId('health-care', 'clinic-one');
    await harness.kmsService.provisionKeys(vaultId);
    const protectedTenant = await harness.kmsService.protectConfidentialData({
      id: vaultId,
      status: 'active',
      sequence: 0,
      content: {
        claims,
        didConfig: { service: initializeTenantServicesConfig('health-care' as any) },
        didDocument: { id: 'did:web:clinic-one.example', controller: ['did:web:controller.example'] },
      },
    } as any, 'host');
    (protectedTenant as any).indexed = { attributes: [
      { name: ClaimsOrganizationSchemaorg.identifierType, value: 'TAX' },
      { name: ClaimsOrganizationSchemaorg.identifierValue, value: 'B12345678' },
    ] };
    await harness.vaultRepository.put(harness.hostCollectionName, [protectedTenant as any], getEnvSectionId('tenants'));
    await harness.tenantManager.refreshTenant(vaultId);

    server = createServer(harness.app);
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Gateway address unavailable.');
    const client = new SosGatewayHostOrganizationDirectoryClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      bearerToken: bearer('host-admin-001'),
      appId: 'https://controller.local.invalid',
      appVersion: '0.1.0',
    });
    const page = await client.search({ jurisdiction: 'ES', network: 'test' }, { filters: { legalName: 'Clinic One' }, pollOptions: { intervalMs: 1, timeoutMs: 2_000 } });

    expect(page).toMatchObject({ total: 1, returned: 1, hasNext: false });
    expect(page.organizations[0]).toMatchObject({ legalName: 'Clinic One', identifierValue: 'B12345678', sector: 'health-care', status: 'active' });

    const target = { identifierType: page.organizations[0].identifierType, identifierValue: page.organizations[0].identifierValue, sameAs: page.organizations[0].sameAs };
    await expect(client.lifecycle({ jurisdiction: 'ES', network: 'test' }, '_disable', target, { intervalMs: 1, timeoutMs: 2_000 })).resolves.toMatchObject({ status: 'suspended' });
    await expect(client.lifecycle({ jurisdiction: 'ES', network: 'test' }, '_enable', target, { intervalMs: 1, timeoutMs: 2_000 })).resolves.toMatchObject({ status: 'active' });
    await client.lifecycle({ jurisdiction: 'ES', network: 'test' }, '_disable', target, { intervalMs: 1, timeoutMs: 2_000 });
    await expect(client.lifecycle({ jurisdiction: 'ES', network: 'test' }, '_purge', target, { intervalMs: 1, timeoutMs: 2_000 })).resolves.toMatchObject({ status: 'revoked', disposition: 'purged' });
    await expect(client.search({ jurisdiction: 'ES', network: 'test' }, { filters: { identifierValue: 'B12345678' }, pollOptions: { intervalMs: 1, timeoutMs: 2_000 } })).resolves.toMatchObject({ total: 0, returned: 0 });

    const forbidden = new SosGatewayHostOrganizationDirectoryClient({ baseUrl: `http://127.0.0.1:${address.port}`, bearerToken: bearer('tenant-controller'), appId: 'https://controller.local.invalid' });
    await expect(forbidden.search({ jurisdiction: 'ES', network: 'test' }, { pollOptions: { intervalMs: 1, timeoutMs: 2_000 } })).rejects.toThrow(/host operator/i);
  });
});
