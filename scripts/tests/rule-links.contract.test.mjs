// Flow contract: every repository rule entry point links only to an existing, repository-owned public contract.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'

const skillFiles = readdirSync('.codex/skills', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `.codex/skills/${entry.name}/SKILL.md`)
  .filter(existsSync)

const contractFiles = [
  'AGENTS.md',
  'SYNC.md',
  'docs/RULES_INDEX.md',
  'docs/LOCAL_FIRST_RELEASE_CONTRACT.md',
  'docs/PERSISTENCE_RELEASE_RED_LINES.md',
  'docs/03-IDENTITY-AND-TRUST/03.J-FIREBASE-PROJECT-AND-TOKEN-AUDIENCE-BOUNDARIES.md',
  'docs/04-DEEP-DIVES/04.L-FEDERATED-EHR-CONTINUITY-STORAGE.md',
]

const markdownLink = /\[[^\]]*\]\(([^)]+)\)/gu

test('AGENTS and repository skills have no broken relative links', () => {
  const broken = []

  for (const file of [...contractFiles, ...skillFiles]) {
    const markdown = readFileSync(file, 'utf8')
    for (const match of markdown.matchAll(markdownLink)) {
      const target = match[1].split('#', 1)[0]
      if (!target || target.startsWith('#') || /^[a-z][a-z+.-]*:/iu.test(target)) continue

      const resolved = resolve(dirname(file), decodeURIComponent(target))
      if (!existsSync(resolved)) broken.push(`${file} -> ${target}`)
    }
  }

  assert.deepEqual(broken, [])
})

test('the rules index links every repository skill and governing contract', () => {
  const index = readFileSync('docs/RULES_INDEX.md', 'utf8')

  for (const file of skillFiles) {
    assert.match(index, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), file)
  }
  for (const file of contractFiles.filter((file) => file !== 'docs/RULES_INDEX.md')) {
    const relativeTarget = file.startsWith('docs/') ? file.slice('docs/'.length) : `../${file}`
    assert.match(index, new RegExp(relativeTarget.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), file)
  }
})
