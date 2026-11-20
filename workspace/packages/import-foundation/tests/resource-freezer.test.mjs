import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { evaluateResourceManifest } from '../resource-contract.mjs'
import { freezeResourceGraph } from '../resource-freezer.mjs'

function response(body, contentType) {
  const buffer = Buffer.from(body)
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    arrayBuffer: async () => buffer
  }
}

test('freezes and rewrites stylesheets, imports, fonts, backgrounds, and images', async (t) => {
  const outputDir = await mkdtemp(path.join(process.cwd(), '.test-resource-freezer-'))
  t.after(() => rm(outputDir, { recursive: true, force: true }))
  const bodies = new Map([
    ['https://miniapp.example/styles/main.wxss', response('@import "./theme.css"; .hero{background-image:url("../images/bg.jpg")}', 'text/css')],
    ['https://miniapp.example/styles/theme.css', response('@font-face{font-family:Demo;src:url("../fonts/demo.woff2")} .card{color:#111}', 'text/css')],
    ['https://miniapp.example/images/bg.jpg', response('background-bytes', 'image/jpeg')],
    ['https://miniapp.example/images/logo.png', response('logo-bytes', 'image/png')],
    ['https://miniapp.example/fonts/demo.woff2', response('font-bytes', 'font/woff2')]
  ])

  const result = await freezeResourceGraph({
    baseUrl: 'https://miniapp.example/pages/home/',
    documents: [{
      id: 'home',
      kind: 'wxml',
      sourceUrl: 'https://miniapp.example/pages/home/index.wxml',
      content: '<link rel="stylesheet" href="../../styles/main.wxss"><image src="../../images/logo.png" />'
    }]
  }, {
    outputDir,
    fetchImpl: async (url) => bodies.get(String(url)) ?? { ok: false, status: 404, headers: { get: () => null } }
  })

  assert.equal(evaluateResourceManifest(result.manifest).pass, true)
  assert.deepEqual(new Set(result.manifest.resources.map((item) => item.kind)), new Set([
    'stylesheet', 'style-import', 'font', 'background-image', 'image'
  ]))
  assert.doesNotMatch(result.documents[0].content, /https?:|\.\.\/\.\.\//)
  for (const asset of result.manifest.resources) {
    await access(path.join(outputDir, asset.localPath))
    const saved = await readFile(path.join(outputDir, asset.localPath))
    assert.ok(saved.length > 0)
  }
})

test('a failed critical download is reported and keeps the resource gate closed', async (t) => {
  const outputDir = await mkdtemp(path.join(process.cwd(), '.test-resource-freezer-'))
  t.after(() => rm(outputDir, { recursive: true, force: true }))

  const result = await freezeResourceGraph({
    baseUrl: 'https://miniapp.example/',
    documents: [{ id: 'home', kind: 'wxml', content: '<image src="/missing.png" />' }]
  }, {
    outputDir,
    fetchImpl: async () => ({ ok: false, status: 404, headers: { get: () => null } })
  })

  assert.equal(evaluateResourceManifest(result.manifest).pass, false)
  assert.equal(result.manifest.resources[0].status, 'failed')
  assert.ok(result.manifest.unresolvedReferences.includes('https://miniapp.example/missing.png'))
})

test('circular stylesheet imports terminate and are rewritten to frozen local files', async (t) => {
  const outputDir = await mkdtemp(path.join(process.cwd(), '.test-resource-freezer-'))
  t.after(() => rm(outputDir, { recursive: true, force: true }))
  const bodies = new Map([
    ['https://miniapp.example/a.css', response('@import "./b.css"; .a{color:red}', 'text/css')],
    ['https://miniapp.example/b.css', response('@import "./a.css"; .b{color:blue}', 'text/css')]
  ])

  const result = await freezeResourceGraph({
    baseUrl: 'https://miniapp.example/',
    documents: [{ id: 'home', kind: 'wxml', content: '<link rel="stylesheet" href="/a.css">' }]
  }, {
    outputDir,
    fetchImpl: async (url) => bodies.get(String(url))
  })

  assert.equal(evaluateResourceManifest(result.manifest).pass, true)
  assert.equal(result.manifest.resources.length, 2)
  assert.ok(result.manifest.resources.every((resource) => resource.status === 'frozen'))
})
