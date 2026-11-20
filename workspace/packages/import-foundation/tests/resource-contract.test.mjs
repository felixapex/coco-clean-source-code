import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { evaluateResourceManifest, verifyFrozenResourceFiles } from '../resource-contract.mjs'

function validManifest() {
  return {
    baseUrl: 'https://miniapp.example/pages/home/',
    discoveryComplete: true,
    rewritesComplete: true,
    unresolvedReferences: [],
    resources: [{
      id: 'asset-1',
      kind: 'image',
      sourceUrl: 'https://miniapp.example/assets/hero.jpg',
      localPath: 'assets/hero.jpg',
      sha256: 'a'.repeat(64),
      byteLength: 12,
      status: 'frozen',
      critical: true,
      referencedBy: ['document:home']
    }]
  }
}

test('a complete frozen resource manifest passes', () => {
  const result = evaluateResourceManifest(validManifest())
  assert.equal(result.pass, true)
  assert.equal(result.status, 'passed')
})

test('base URL is mandatory and must be absolute HTTP or HTTPS', () => {
  for (const baseUrl of [undefined, '/relative/', 'file:///tmp/source']) {
    const manifest = validManifest()
    manifest.baseUrl = baseUrl
    const result = evaluateResourceManifest(manifest)
    assert.equal(result.pass, false)
    assert.ok(result.failures.some((failure) => failure.type === 'invalid-base-url'))
  }
})

test('critical missing resources and unfinished discovery block generation', () => {
  const manifest = validManifest()
  manifest.discoveryComplete = false
  manifest.rewritesComplete = false
  manifest.unresolvedReferences = ['https://miniapp.example/missing.css']
  manifest.resources[0].status = 'failed'
  delete manifest.resources[0].sha256

  const result = evaluateResourceManifest(manifest)

  assert.equal(result.pass, false)
  for (const type of ['discovery-incomplete', 'rewrites-incomplete', 'unresolved-reference', 'critical-resource-not-frozen', 'missing-resource-field']) {
    assert.ok(result.failures.some((failure) => failure.type === type), type)
  }
})

test('duplicate source URLs and unsafe local paths fail closed', () => {
  const manifest = validManifest()
  manifest.resources.push({ ...manifest.resources[0], id: 'asset-2', localPath: '../escape.jpg' })

  const result = evaluateResourceManifest(manifest)

  assert.equal(result.pass, false)
  assert.ok(result.failures.some((failure) => failure.type === 'duplicate-resource-url'))
  assert.ok(result.failures.some((failure) => failure.type === 'unsafe-local-path'))
})

test('independently verifies frozen file existence, size, and hash', async (t) => {
  const root = await mkdtemp(path.join(process.cwd(), '.test-resource-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'assets'))
  const bytes = Buffer.from('verified-image')
  await writeFile(path.join(root, 'assets/hero.jpg'), bytes)
  const manifest = validManifest()
  manifest.resources[0].localPath = 'assets/hero.jpg'
  manifest.resources[0].byteLength = bytes.length
  manifest.resources[0].sha256 = createHash('sha256').update(bytes).digest('hex')

  assert.equal((await verifyFrozenResourceFiles(manifest, root)).pass, true)

  manifest.resources[0].sha256 = 'f'.repeat(64)
  const tampered = await verifyFrozenResourceFiles(manifest, root)
  assert.equal(tampered.pass, false)
  assert.ok(tampered.failures.some((failure) => failure.type === 'resource-hash-mismatch'))

  manifest.resources[0].localPath = 'assets/missing.jpg'
  const missing = await verifyFrozenResourceFiles(manifest, root)
  assert.ok(missing.failures.some((failure) => failure.type === 'resource-file-missing'))
})
