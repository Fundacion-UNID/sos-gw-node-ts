#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsNodeEnvironment = {
  ...process.env,
  TS_NODE_TRANSPILE_ONLY: '1',
  TS_NODE_SKIP_IGNORE: '1',
  TS_NODE_COMPILER_OPTIONS: JSON.stringify({
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    allowImportingTsExtensions: true,
  }),
}
const tsNodeArguments = ['--loader', 'ts-node/esm', '--experimental-specifier-resolution=node']

run([...tsNodeArguments, 'scripts/generate-swagger-spec.mts'], tsNodeEnvironment)
run(['scripts/generate-openapi-profiles.mjs'])
run([...tsNodeArguments, 'scripts/generate-core-flow-examples.mjs'], tsNodeEnvironment)

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
