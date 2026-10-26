// Flow contract: local integrators can install and run the gateway on the supported Node.js 24 or 26 LTS lines without relaxing the container runtime baseline.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../../', import.meta.url)

test('package metadata accepts Node.js 24 and Node.js 26', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

  assert.equal(packageJson.engines?.node, '^24.0.0 || ^26.0.0')
})

test('container images retain the validated Node.js 24 baseline', async () => {
  const dockerfile = await readFile(new URL('Dockerfile', root), 'utf8')

  assert.match(dockerfile, /^FROM node:24-alpine AS builder$/mu)
  assert.match(dockerfile, /^FROM node:24-alpine$/mu)
})
