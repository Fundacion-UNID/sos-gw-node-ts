#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requiredNodeMajor = 24
const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(gatewayRoot, '..', '..')
const checkOnly = process.argv.includes('--check')
const publicCheckOnly = process.argv.includes('--public-check')

if (Number(process.versions.node.split('.')[0]) !== requiredNodeMajor) {
  fail(`Node ${requiredNodeMajor} is required; active runtime is ${process.versions.node}.`)
}

const targets = Object.freeze([
  portal('uhc-professional', 'professional-unidonline-next', numericEnvironment('SOS_MVP_UHC_PROFESSIONAL_PORT', 4182)),
  portal('vetchain-professional', 'vet-professional-next', numericEnvironment('SOS_MVP_VETCHAIN_PROFESSIONAL_PORT', 4282)),
  portal('soschain-professional', 'soschain-professional-next', numericEnvironment('SOS_MVP_PROFESSIONAL_PORT', 4318)),
  portal('soschain-personal', 'soschain-personal-next', numericEnvironment('SOS_MVP_PERSONAL_PORT', 4317)),
])

try {
  const prepared = []
  for (const target of targets) prepared.push(await prepare(target))

  if (publicCheckOnly) {
    console.log('[MVP-TEST-NETWORK] PASS web-apps=4 localhost=authorized secrets=not-requested')
    process.exit(0)
  }

  ensureApplicationDefaultCredentials()
  for (const item of prepared) resolveSecrets(item)

  if (checkOnly) {
    console.log('[MVP-TEST-NETWORK] PASS web-apps=4 localhost=authorized adc=ready staging-secrets=ready')
    process.exit(0)
  }

  startAll(prepared)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

async function prepare(target) {
  if (!existsSync(target.directory)) throw new Error(`repository missing: ${target.directory}`)
  if (!existsSync(target.appHostingFile)) throw new Error(`App Hosting configuration missing: ${target.appHostingFile}`)

  const configuration = parseAppHosting(readFileSync(target.appHostingFile, 'utf8'))
  const projectId = required(configuration.values.FIREBASE_PROJECT_ID || configuration.values.NEXT_PUBLIC_FIREBASE_PROJECT_ID, `${target.id}: Firebase project`)
  const apiKey = required(configuration.values.NEXT_PUBLIC_FIREBASE_API_KEY, `${target.id}: Firebase Web API key`)
  await assertLocalhostAuthorized(apiKey, target.id)

  console.log(`[MVP-TEST-NETWORK] ready ${target.id}=http://127.0.0.1:${target.port} firebase=${projectId}`)
  return { ...target, projectId, environment: { ...configuration.values }, secrets: configuration.secrets }
}

function parseAppHosting(source) {
  const values = {}
  const secrets = {}
  let variable
  for (const line of source.split(/\r?\n/)) {
    const variableMatch = line.match(/^\s*-\s+variable:\s*(\S+)\s*$/)
    if (variableMatch) {
      variable = variableMatch[1]
      continue
    }
    if (!variable) continue
    const valueMatch = line.match(/^\s+value:\s*(.*?)\s*$/)
    if (valueMatch) {
      values[variable] = unquote(valueMatch[1])
      variable = undefined
      continue
    }
    const secretMatch = line.match(/^\s+secret:\s*(\S+)\s*$/)
    if (secretMatch) {
      secrets[variable] = unquote(secretMatch[1])
      variable = undefined
    }
  }
  return { values, secrets }
}

async function assertLocalhostAuthorized(apiKey, portalId) {
  const endpoint = new URL('https://identitytoolkit.googleapis.com/v1/projects')
  endpoint.searchParams.set('key', apiKey)
  const response = await fetch(endpoint)
  if (!response.ok) throw new Error(`${portalId}: Firebase project lookup failed with HTTP ${response.status}`)
  const configuration = await response.json()
  if (!Array.isArray(configuration.authorizedDomains) || !configuration.authorizedDomains.includes('localhost')) {
    throw new Error(`${portalId}: localhost is not an authorized Firebase domain`)
  }
}

function ensureApplicationDefaultCredentials() {
  const probe = spawnSync('gcloud', ['auth', 'application-default', 'print-access-token'], { stdio: 'ignore' })
  if (probe.status === 0) return

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Application Default Credentials are missing; run this command once from a TTY so it can open the Google login flow')
  }
  console.log('[MVP-TEST-NETWORK] Opening the one-time Google Application Default Credentials login.')
  const login = spawnSync('gcloud', ['auth', 'application-default', 'login'], { stdio: 'inherit' })
  if (login.status !== 0) throw new Error('Google Application Default Credentials login did not complete')
}

function resolveSecrets(item) {
  for (const [variable, secretName] of Object.entries(item.secrets)) {
    const result = spawnSync(
      'gcloud',
      ['secrets', 'versions', 'access', 'latest', `--secret=${secretName}`, `--project=${item.projectId}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    if (result.status !== 0) {
      throw new Error(`${item.id}: staging secret access failed for ${variable}; request the normal staging developer role`)
    }
    item.environment[variable] = result.stdout.replace(/\r?\n$/, '')
  }
}

function startAll(prepared) {
  const children = prepared.map(start)
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(signal))
  for (const { child, item } of children) {
    child.once('exit', (code, signal) => {
      if (stopping) return
      console.error(`[MVP-TEST-NETWORK] ${item.id} stopped code=${code ?? 'none'} signal=${signal ?? 'none'}`)
      stop('SIGTERM', 1)
    })
  }

  console.log('[MVP-TEST-NETWORK] Four local frontends are using the deployed Test Network; no local gateway was started.')

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
}

function start(item) {
  const child = spawn(
    'npm',
    ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(item.port)],
    {
      cwd: item.directory,
      env: {
        ...process.env,
        ...item.environment,
        PORT: String(item.port),
        DEPLOYMENT_ENV: 'staging',
        NETWORK_MODE: 'test-network',
      },
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    },
  )
  child.once('error', error => console.error(`[MVP-TEST-NETWORK] ${item.id} failed: ${error.message}`))
  return { child, item }
}

function portal(id, repository, port) {
  const directory = resolve(workspaceRoot, 'custom', repository)
  return Object.freeze({ id, directory, port, appHostingFile: resolve(directory, 'apphosting.yaml') })
}

function numericEnvironment(name, fallback) {
  const value = Number(process.env[name] || fallback)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid TCP port`)
  return value
}

function required(value, label) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(`${label} is required`)
  return normalized
}

function unquote(value) {
  const normalized = String(value || '').trim()
  if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'"))) {
    return normalized.slice(1, -1)
  }
  return normalized
}

function fail(message) {
  console.error(`[MVP-TEST-NETWORK] FAIL ${message}`)
  process.exit(1)
}
