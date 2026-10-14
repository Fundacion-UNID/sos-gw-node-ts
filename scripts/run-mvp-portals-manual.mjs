#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const requiredNodeMajor = 24
const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(gatewayRoot, '..', '..')
const checkOnly = process.argv.includes('--check')
if (Number(process.versions.node.split('.')[0]) !== requiredNodeMajor) {
  throw new Error(`Node ${requiredNodeMajor} is required; active runtime is ${process.versions.node}.`)
}

const envFile = String(process.env.SOS_MVP_PORTAL_ENV_FILE || resolve(gatewayRoot, '.env.test')).trim()
if (existsSync(envFile)) loadEnvFile(envFile)

const gatewayPort = numericEnvironment('SOS_MVP_GW_PORT', 3500)
const services = Object.freeze([
  service('sos-gw', 'sos-gw-node-ts', gatewayPort, ['run', 'api:local-demo']),
  service('uhc-professional', 'professional-unidonline-next', numericEnvironment('SOS_MVP_UHC_PROFESSIONAL_PORT', 4182)),
  service('vetchain-professional', 'vet-professional-next', numericEnvironment('SOS_MVP_VETCHAIN_PROFESSIONAL_PORT', 4282)),
  service('soschain-professional', 'soschain-professional-next', numericEnvironment('SOS_MVP_PROFESSIONAL_PORT', 4318)),
  service('soschain-personal', 'soschain-personal-next', numericEnvironment('SOS_MVP_PERSONAL_PORT', 4317)),
])

for (const target of services) {
  if (!existsSync(target.directory)) throw new Error(`repository missing: ${target.directory}`)
  console.log(`[MVP-MANUAL] ${target.id}=http://127.0.0.1:${target.port}`)
}
if (checkOnly) process.exit(0)

const children = services.map(start)
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal))
for (const { child, target } of children) {
  child.once('exit', (code, signal) => {
    if (stopping) return
    console.error(`[MVP-MANUAL] ${target.id} stopped code=${code ?? 'none'} signal=${signal ?? 'none'}`)
    stop('SIGTERM', 1)
  })
}

console.log('[MVP-MANUAL] No tenants were created. Complete onboarding and workforce setup in UHC/Vet, then inspect both SOSChain portals.')

function start(target) {
  const gatewayBaseUrl = `http://127.0.0.1:${gatewayPort}`
  const args = target.args || ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(target.port)]
  const child = spawn('npm', args, {
    cwd: target.directory,
    env: {
      ...process.env,
      PORT: String(target.port),
      NETWORK_MODE: process.env.SOS_MVP_NETWORK_KIND || 'test',
      PROFESSIONAL_TEST_HOST_URL: process.env.SOS_MVP_GW_BASE_URL || gatewayBaseUrl,
      SOSCHAIN_GW_BASE_URL: process.env.SOS_MVP_GW_BASE_URL || gatewayBaseUrl,
    },
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  })
  child.once('error', error => {
    console.error(`[MVP-MANUAL] ${target.id} failed: ${error.message}`)
    stop('SIGTERM', 1)
  })
  return { child, target }
}

function stop(signal, exitCode = signal === 'SIGINT' ? 130 : 143) {
  if (stopping) return
  stopping = true
  for (const { child } of children) {
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch { /* already stopped */ }
  }
  process.exitCode = exitCode
}

function service(id, repository, port, args) { return Object.freeze({ id, directory: resolve(workspaceRoot, 'custom', repository), port, args }) }
function numericEnvironment(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid TCP port`)
  return value
}
