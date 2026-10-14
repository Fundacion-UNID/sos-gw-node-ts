// Flow contract: the public SOSCHAIN Gateway v2 starts from a secret-free snapshot, documents its GDC Core foundation and historical SOSCHAIN source, and does not ship inherited documentation trees or product deployment profiles.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

test('declares the public v2 identity and canonical upstream documentation', () => {
  const readme = readFileSync('README.md', 'utf8')
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

  assert.equal(packageJson.version, '2.0.0')
  assert.equal(packageJson.repository?.url, 'https://github.com/Fundacion-UNID/sos-gw-node-ts.git')
  assert.match(readme, /SOSCHAIN Gateway/)
  assert.match(readme, /extends \*\*GW CORE\*\*/)
  assert.match(readme, /Global Data Care ecosystem/)
  assert.match(readme, /https:\/\/github\.com\/Global-DataCare\/gwtemplate-node-ts/)
  assert.match(readme, /https:\/\/github\.com\/Global-DataCare\/gwtemplate-node-ts\/tree\/main\/docs-v1/)
  assert.match(readme, /https:\/\/github\.com\/Global-DataCare\/gwtemplate-node-ts\/tree\/main\/docs-v2/)
  assert.match(readme, /https:\/\/github\.com\/soschain\/docs/)
  assert.match(readme, /https:\/\/github\.com\/Fundacion-UNID\/fhir-data-utils-ts/)
  assert.match(readme, /https:\/\/github\.com\/Fundacion-UNID\/sos-data-utils-ts/)
  assert.match(readme, /https:\/\/github\.com\/Fundacion-UNID\/sos-sdk-core-ts/)
  assert.match(readme, /https:\/\/github\.com\/Fundacion-UNID\/sos-sdk-node-ts/)
  assert.match(readme, /https:\/\/github\.com\/Global-DataCare\/gdc-common-utils-ts/)
  assert.match(readme, /https:\/\/github\.com\/Global-DataCare\/gdc-sdk-core-ts/)
  assert.match(readme, /https:\/\/github\.com\/Global-DataCare\/gdc-sdk-node-ts/)
})

test('ships only the new SOSCHAIN documentation set', () => {
  for (const path of [
    'docs/README.md',
    'docs/architecture.md',
    'docs/getting-started.md',
    'docs/api-and-interoperability.md',
    'docs/security-and-deployment.md',
    'docs/upstream-and-history.md',
  ]) {
    assert.equal(existsSync(path), true, path)
  }

  for (const path of [
    'docs-v2',
    'docs-end',
    'SYNC.md',
    'NARRATIVE-ALIGNMENT.md',
    'deploy/vetchain',
    'config/vetchain-runtime-common.env',
    'fabric-ca-server-ica/ca-key.pem',
    'fabric-ca-server-root/ca-key.pem',
  ]) {
    assert.equal(existsSync(path), false, path)
  }
})
