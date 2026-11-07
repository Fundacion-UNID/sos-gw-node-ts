// Flow contract: Demo and Test Network execute the same GW managers through IVaultRepository; all-local injects VaultMemRepository and Expo may inject SQLite without copying use cases.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Demo/Test Network adapter parity', () => {
  it('keeps the invariant synchronized across README, AGENTS and skill', () => {
    const root = process.cwd();
    const contract = [
      'README.md',
      'AGENTS.md',
      '.codex/skills/preserve-demo-test-network-adapter-parity/SKILL.md',
    ].map(path => readFileSync(join(root, path), 'utf8')).join('\n');
    expect(contract).toMatch(/Demo and Test Network.*same.*managers/is);
    expect(contract).toMatch(/Expo.*SQLite/is);
    expect(contract).toMatch(/Firestore must not.*Demo/is);
  });

  it('selects the memory vault only from the infrastructure composition root', () => {
    const source = readFileSync(join(process.cwd(), 'src/bootstrap/build-infrastructure.ts'), 'utf8');
    expect(source).toContain("import { VaultMemRepository }");
    expect(source).toContain('vaultRepository = new VaultMemRepository()');
  });
});
