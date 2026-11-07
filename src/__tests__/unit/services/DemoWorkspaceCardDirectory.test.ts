import { VaultMemRepository } from '../../../database/repositories/vault/vault.mem.repository';
import { DemoWorkspaceCardDirectory } from '../../../services/demo/DemoWorkspaceCardDirectory';
import { buildDemoWorkspaceScope } from 'sos-data-utils-ts/demo-workspace-scope';

describe('DemoWorkspaceCardDirectory', () => {
  it('shares one scoped synthetic locator through the gateway memory adapter and revokes its generation', async () => {
    const repository = new VaultMemRepository();
    await repository.createNewVault({ id: 'host' });
    const directory = new DemoWorkspaceCardDirectory(repository, () => Date.parse('2026-11-07T12:00:00.000Z'));
    const scope = buildDemoWorkspaceScope({ deployment: 'test', network: 'demo', portalFamily: 'soschain', tenantId: 'demo-soschain' });
    await directory.register({ scope, generationId: '123e4567-e89b-42d3-a456-426614174000', cardNumber: '123456789012345678901',
      subjectIdentifier: 'urn:uuid:animal', displayName: 'Demo animal', controllerActorIdentifier: 'urn:uuid:controller',
      subjectKind: 'animal', sourceSector: 'animal-research' });
    await expect(directory.resolve(scope, '123456789012345678901')).resolves.toMatchObject({ subjectIdentifier: 'urn:uuid:animal' });
    await directory.revoke(scope, '123e4567-e89b-42d3-a456-426614174000');
    await expect(directory.resolve(scope, '123456789012345678901')).resolves.toBeUndefined();
  });
});
