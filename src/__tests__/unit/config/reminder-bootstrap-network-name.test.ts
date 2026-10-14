/**
 * Flow contract:
 * 1. Every local bootstrap exposes exactly `hostRegistryNetwork` or `HOST_REGISTRY_NETWORK`.
 * 2. Vet reminder, tenant, discovery, and portal checks address the same network input.
 * 3. No sector-named fallback silently changes which registry network is addressed.
 */
import { readFile } from 'node:fs/promises';

describe('bootstrap registry network name', () => {
  it('uses only the canonical host registry network input in every supported bootstrap', async () => {
    const sources = await Promise.all([
      'e2e-reminder-bootstrap.sh',
      'bootstrap-single-tenant.sh',
      'bootstrap-alice-bob-discovery.sh',
      'portal-web-go-no-go.sh',
    ].map((scriptName) => readFile(
      new URL(`../../../../scripts/${scriptName}`, import.meta.url),
      'utf8',
    )));
    const source = sources.join('\n');

    expect(source).toContain("jq -r '.hostRegistryNetwork'");
    expect(source).toContain('HOST_REGISTRY_NETWORK=');
    expect(source).not.toContain('hostRegistrySector');
    expect(source).not.toContain('HOST_REGISTRY_SECTOR');
  });
});
