#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

const requiredNodeMajor = 24
const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(gatewayRoot, '..', '..')
const dryRun = process.argv.includes('--dry-run')

if (Number(process.versions.node.split('.')[0]) !== requiredNodeMajor) {
  fail(`Node ${requiredNodeMajor} is required; active runtime is ${process.versions.node}.`)
}

const envFile = String(process.env.SOS_MVP_PORTAL_ENV_FILE || resolve(gatewayRoot, '.env.test')).trim()
if (existsSync(envFile)) loadEnvFile(envFile)

const portals = Object.freeze({
  soschainProfessional: portal('soschain-professional', 'soschain-professional-next'),
  soschainPersonal: portal('soschain-personal', 'soschain-personal-next'),
})
const portalScript = 'test:e2e:mvp'
const portalOrder = Object.freeze([
  portals.soschainProfessional,
  portals.soschainPersonal,
])

try {
  validatePortalScripts()
  await bootstrapTenantRegistration('health-care')
  await bootstrapTenantRegistration('animal-care')
  for (const target of portalOrder) await runPortalGate(target)
  console.log('[MVP-PLAYWRIGHT] PASS setup=seeded portals=2 skipped=0')
} catch (error) {
  console.error(`[MVP-PLAYWRIGHT] FAIL ${safeMessage(error)}`)
  process.exitCode = 1
}

async function bootstrapTenantRegistration(sector) {
  const suffix = sector === 'health-care' ? 'HEALTH' : 'ANIMAL'
  await runStep({
    name: `bootstrap:${sector}`,
    command: 'bash',
    args: ['./scripts/bootstrap-single-tenant.sh'],
    cwd: gatewayRoot,
    env: {
      ...process.env,
      BASE_URL: requiredEnvironment('SOS_MVP_GW_BASE_URL'),
      TENANT_ID: requiredEnvironment(`SOS_MVP_${suffix}_TENANT_ID`),
      JURISDICTION: requiredEnvironment(`SOS_MVP_${suffix}_JURISDICTION`),
      SECTOR: sector,
      HOST_NETWORK: process.env.SOS_MVP_NETWORK_KIND || 'test',
      HOST_REGISTRY_NETWORK: process.env.SOS_MVP_NETWORK_KIND || 'test',
    },
  })
}

async function runPortalGate(target) {
  await runStep({
    name: target.id,
    command: 'npm',
    args: ['run', portalScript],
    cwd: target.directory,
    env: { ...process.env, SOS_MVP_SETUP_MODE: 'seeded' },
    requireResult: true,
  })
}

function validatePortalScripts() {
  for (const target of portalOrder) {
    if (!existsSync(target.directory)) throw new Error(`portal repository missing: ${target.directory}`)
    const packageJson = JSON.parse(readFileSync(resolve(target.directory, 'package.json'), 'utf8'))
    if (!packageJson.scripts?.[portalScript]) {
      throw new Error(`${target.id} is missing ${portalScript}; fixture-only tests do not satisfy the MVP gate`)
    }
  }
}

async function runStep({ name, command, args, cwd, env, requireResult = false }) {
  console.log(`[MVP-PLAYWRIGHT] start ${name}`)
  if (dryRun) {
    console.log(`[MVP-PLAYWRIGHT] dry-run cwd=${cwd} command=${command} ${args.join(' ')}`)
    return
  }
  const output = await spawnWithOutput(command, args, cwd, env)
  if (requireResult) {
    if (/\b[1-9]\d*\s+(?:skipped|did not run)\b/i.test(output)) throw new Error(`${name} reported skipped or did not run tests`)
    if (/fixture-only/i.test(output)) throw new Error(`${name} reported fixture-only evidence`)
    if (!/\b[1-9]\d*\s+passed\b/i.test(output)) throw new Error(`${name} did not report a successful result`)
  }
  console.log(`[MVP-PLAYWRIGHT] pass ${name}`)
}

function spawnWithOutput(command, args, cwd, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] })
    let output = ''
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', chunk => {
        const text = chunk.toString()
        output += text
        ;(stream === child.stdout ? process.stdout : process.stderr).write(text)
      })
    }
    child.once('error', rejectPromise)
    child.once('exit', (code, signal) => {
      if (signal) rejectPromise(new Error(`${command} terminated by ${signal}`))
      else if (code !== 0) rejectPromise(new Error(`${command} exited with code ${code}`))
      else resolvePromise(output)
    })
  })
}

function portal(id, repository) { return Object.freeze({ id, directory: resolve(workspaceRoot, 'custom', repository) }) }
function requiredEnvironment(name) {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
function safeMessage(error) { return error instanceof Error ? error.message : String(error) }
function fail(message) { console.error(`[MVP-PLAYWRIGHT] FAIL ${message}`); process.exit(1) }
