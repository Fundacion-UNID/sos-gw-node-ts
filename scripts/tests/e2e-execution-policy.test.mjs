// Flow contract: the complete Vet GW E2E suite runs sequentially so one release gate cannot exhaust a developer workstation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const packageJson = JSON.parse(readFileSync(`${repositoryRoot}/package.json`, 'utf8'))
const secureE2eScript = readFileSync(`${repositoryRoot}/scripts/run-secure-e2e-google-user.sh`, 'utf8')
const consentAccessDeployScript = readFileSync(
  `${repositoryRoot}/chaincode/scripts/consentaccess-local-devnet.sh`,
  'utf8',
)
const localFabricBootstrapScript = readFileSync(
  `${repositoryRoot}/scripts/bootstrap-local-fabric-stack.mjs`,
  'utf8',
)

test('runs the complete E2E suite in one Jest worker', () => {
  assert.match(packageJson.scripts['test:e2e'], /(?:^|\s)--runInBand(?:\s|$)/)
})

test('uses an ICA-supported jurisdiction for every secure local SDK journey', () => {
  assert.match(secureE2eScript, /E2E_JURISDICTION="\$\{LIVE_GW_E2E_JURISDICTION:-ES\}"/)
  assert.match(secureE2eScript, /ICA_JURISDICTION="\$E2E_JURISDICTION"[\s\\]*HOST_JURISDICTION="\$E2E_JURISDICTION"[\s\\]*npx dotenv/)
  assert.match(secureE2eScript, /JURISDICTION="\$E2E_JURISDICTION"/)
  assert.match(secureE2eScript, /HOST_JURISDICTION="\$E2E_JURISDICTION"/)
})

test('runs the VetChain release journey with the animal-care capability sector', () => {
  assert.match(secureE2eScript, /E2E_SECTOR="\$\{LIVE_GW_E2E_SECTOR:-animal-care\}"/)
  assert.match(secureE2eScript, /SECTOR="\$E2E_SECTOR"/)
})

test('uses the current ICA verification flow for the isolated destructive journey', () => {
  assert.match(secureE2eScript, /bootstrap_current_ica_tenant_for_individual_pass/)
  assert.match(secureE2eScript, /CONNECT_ICA_ROOT/)
  assert.match(secureE2eScript, /LIVE_GW_E2E_SUITE=professional/)
  assert.match(secureE2eScript, /RUN_LIVE_GW_E2E_IPS_INGESTION=0/)
  assert.match(secureE2eScript, /RUN_LIVE_GW_E2E_INDIVIDUAL_LIFECYCLE=0/)
  assert.match(secureE2eScript, /cleanup-secure-e2e-bootstrap-individual\.mjs/)
  assert.match(secureE2eScript, /RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION=1/)
  assert.match(secureE2eScript, /run_e2e_pass individual-cleanup individual 0 1 1 1/)
})

test('installs exact consentaccess dependencies before local Fabric tests', () => {
  const installIndex = consentAccessDeployScript.indexOf('(cd "${CHAINCODE_DIR}" && npm ci)')
  const testIndex = consentAccessDeployScript.indexOf('(cd "${CHAINCODE_DIR}" && npm test)')

  assert.ok(installIndex >= 0, 'consentaccess deploy must run npm ci')
  assert.ok(testIndex > installIndex, 'npm ci must precede consentaccess tests')
})

test('deploys artifact-sc on both local data and research channels', () => {
  assert.match(localFabricBootstrapScript, /fabric-deploy-data-artifact-chaincode/)
  assert.match(localFabricBootstrapScript, /CHANNEL_NAME: config\.dataChannel/)
  assert.match(localFabricBootstrapScript, /fabric-deploy-research-artifact-chaincode/)
  assert.match(localFabricBootstrapScript, /CHANNEL_NAME: config\.researchChannel/)
})
