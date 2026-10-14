#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const EnvironmentTemplateViolation = Object.freeze({
  MissingTemplate: 'one or more canonical environment templates are missing',
  LegacyTemplate: '.env.example must not be versioned',
  UnexpectedTemplate: 'only one generic env template per supported network profile may be versioned',
  RuntimeFilesNotIgnored: '.gitignore must contain the exact .env* rule',
  PopulatedSecret: 'env.test.example contains a non-placeholder secret value',
  PopulatedOperationalIdentity: 'environment templates contain concrete operational identity metadata',
  LegacyTemplateInstruction: 'documentation must not instruct users to copy .env.example',
})

export const AllowedEnvironmentTemplates = Object.freeze([
  'env.demo.example',
  'env.local-network.example',
  'env.staging.example',
  'env.test.example',
])

const secretNamePattern = /(?:^|_)(?:API_KEY|AUTH_TOKEN|CLIENT_SECRET|CREDENTIALS?|PASS(?:WORD)?|PRIVATE_KEY|SECRET|SEED|TOKEN)(?:_|$)/
const placeholderValuePattern = /^(?:|0+|X0+X|<[^>]+>|\$\{[^}]+\}|(?:replace|example|dummy|placeholder|not[-_]?real|local[-_]?demo|test[-_]?only|dev[-_]?only|change[-_]?me)[A-Za-z0-9_./:@-]*)$/i
const nonSecretConfigurationNames = new Set([
  'AUTH_TOKEN_VERIFIER',
  'GOOGLE_APPLICATION_CREDENTIALS',
])
const privateIdentityMarkers = new RegExp([
  ['connect', 'health'].join(''),
  ['anti', 'fraud'].join(''),
  ['vet', 'chain'].join(''),
  ['pet', 'chain'].join(''),
  ['global', 'datacare'].join(''),
  ['u', 'h', 'c'].join(''),
  ['u', 'n', 'i', 'd'].join(''),
].join('|'), 'iu')
const operationalIdentityNamePattern = /(?:^|_)(?:ADMIN_EMAIL|BUCKET(?:_NAME)?|CLUSTER|CONTROLLER_EMAIL|DOMAIN|HOST_CN|ID_VALUE|LEGAL_ID_NUMBER|LEGAL_NAME|NAMESPACE|PROJECT_ID|SERVICE_ACCOUNT|TENANT_ID)(?:_|$)/u

export function validateEnvironmentTemplateFiles({ environmentTemplate, gitignore, legacyTemplateExists, legacyTemplateInstructionExists = false, trackedEnvironmentTemplates = AllowedEnvironmentTemplates }) {
  const violations = []
  if (legacyTemplateExists) violations.push(EnvironmentTemplateViolation.LegacyTemplate)
  if (
    trackedEnvironmentTemplates.length !== AllowedEnvironmentTemplates.length ||
    trackedEnvironmentTemplates.some((path, index) => path !== AllowedEnvironmentTemplates[index])
  ) violations.push(EnvironmentTemplateViolation.UnexpectedTemplate)
  if (!gitignore.split(/\r?\n/).includes('.env*')) violations.push(EnvironmentTemplateViolation.RuntimeFilesNotIgnored)

  const hasPopulatedSecret = environmentTemplate.split(/\r?\n/).some((line) => {
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!assignment || nonSecretConfigurationNames.has(assignment[1]) || !secretNamePattern.test(assignment[1])) return false
    return !placeholderValuePattern.test(assignment[2].trim())
  })
  if (hasPopulatedSecret) violations.push(EnvironmentTemplateViolation.PopulatedSecret)
  if (containsConcreteOperationalIdentity(environmentTemplate)) violations.push(EnvironmentTemplateViolation.PopulatedOperationalIdentity)
  if (legacyTemplateInstructionExists) violations.push(EnvironmentTemplateViolation.LegacyTemplateInstruction)
  return violations
}

export function validateEnvironmentTemplateRepository(repositoryRoot) {
  if (AllowedEnvironmentTemplates.some((path) => !existsSync(resolve(repositoryRoot, path)))) {
    return [EnvironmentTemplateViolation.MissingTemplate]
  }
  const trackedEnvironmentTemplates = listTrackedEnvironmentTemplates(repositoryRoot)
  const environmentTemplate = trackedEnvironmentTemplates
    .map((path) => readFileSync(resolve(repositoryRoot, path), 'utf8'))
    .join('\n')
  return validateEnvironmentTemplateFiles({
    environmentTemplate,
    gitignore: readFileSync(resolve(repositoryRoot, '.gitignore'), 'utf8'),
    legacyTemplateExists: existsSync(resolve(repositoryRoot, '.env.example')),
    legacyTemplateInstructionExists: hasLegacyTemplateInstruction(repositoryRoot),
    trackedEnvironmentTemplates,
  })
}

function containsConcreteOperationalIdentity(environmentTemplate) {
  if (privateIdentityMarkers.test(environmentTemplate)) return true
  return environmentTemplate.split(/\r?\n/).some((line) => {
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u)
    if (!assignment) return false
    const [, name, rawValue] = assignment
    const value = rawValue.trim()
    if (!operationalIdentityNamePattern.test(name)) return false
    return !placeholderValuePattern.test(value) &&
      !/(?:localhost|127\.0\.0\.1|example\.(?:com|org|net|invalid)|^example[-_])/iu.test(value)
  })
}

function listTrackedEnvironmentTemplates(repositoryRoot) {
  return execFileSync('git', ['-C', repositoryRoot, 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((path) => existsSync(resolve(repositoryRoot, path)) && /(?:^|\/)[^/]*env[^/]*example[^/]*$/iu.test(path))
    .sort()
}

function hasLegacyTemplateInstruction(repositoryRoot) {
  try {
    execFileSync('git', ['-C', repositoryRoot, 'grep', '-l', '-E', 'cp[[:space:]]+\\.env\\.example', '--', '*.md', 'package.json'], { stdio: 'pipe' })
    return true
  } catch (error) {
    if (error?.status === 1) return false
    throw error
  }
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (executedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(process.argv[2] ?? '.')
  const violations = validateEnvironmentTemplateRepository(repositoryRoot)
  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`)
    process.exitCode = 1
  }
}
