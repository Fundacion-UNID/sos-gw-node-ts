// Flow contract: each supported tier has one generic, secret-free env.*.example while ignored .env* files hold runtime values.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  AllowedEnvironmentTemplates,
  EnvironmentTemplateViolation,
  validateEnvironmentTemplateFiles,
  validateEnvironmentTemplateRepository,
} from '../validate-environment-template.mjs'

const SAFE_TEMPLATE = [
  'PUBLIC_BASE_URL=https://service.example',
  'CLIENT_SECRET=replace-in-ignored-env-file',
  '',
].join('\n')

test('accepts the canonical template and ignored runtime environment contract', () => {
  assert.deepEqual(validateEnvironmentTemplateFiles({
    environmentTemplate: SAFE_TEMPLATE,
    gitignore: '.env*\n',
    legacyTemplateExists: false,
    legacyTemplateInstructionExists: false,
    trackedEnvironmentTemplates: AllowedEnvironmentTemplates,
  }), [])
})

test('rejects the legacy filename, unignored runtime files and populated secrets', () => {
  assert.deepEqual(validateEnvironmentTemplateFiles({
    environmentTemplate: 'CLIENT_SECRET=real-secret-value\nHOST_ADMIN_EMAIL=admin@real-company.test\n',
    gitignore: '.env.local\n',
    legacyTemplateExists: true,
    legacyTemplateInstructionExists: true,
    trackedEnvironmentTemplates: ['env.test.example', 'env.customer.example'],
  }), [
    EnvironmentTemplateViolation.LegacyTemplate,
    EnvironmentTemplateViolation.UnexpectedTemplate,
    EnvironmentTemplateViolation.RuntimeFilesNotIgnored,
    EnvironmentTemplateViolation.PopulatedSecret,
    EnvironmentTemplateViolation.PopulatedOperationalIdentity,
    EnvironmentTemplateViolation.LegacyTemplateInstruction,
  ])
})

test('keeps the gateway compliant with the environment template contract', () => {
  const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
  assert.deepEqual(validateEnvironmentTemplateRepository(repositoryRoot), [])
})
