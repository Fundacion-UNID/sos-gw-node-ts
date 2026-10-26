// Flow contract: the deployable gateway cleans and generates build artifacts through Node entrypoints that work on Windows, macOS and Linux.
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)

test('gateway build scripts contain no POSIX-only cleanup or inline environment assignment', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(manifest.scripts.clean, 'node scripts/clean-build.mjs')
  assert.equal(manifest.scripts['build:swagger'], 'node scripts/generate-swagger-all.mjs')
  assert.doesNotMatch(manifest.scripts.build, /rm -rf/u)
  assert.doesNotMatch(manifest.scripts['build:swagger'], /TS_NODE_[A-Z_]+=/u)
  await access(new URL('scripts/clean-build.mjs', root))
  await access(new URL('scripts/generate-swagger-all.mjs', root))
})
