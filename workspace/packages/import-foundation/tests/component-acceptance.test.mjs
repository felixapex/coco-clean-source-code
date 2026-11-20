import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateComponentAcceptance } from '../component-acceptance.mjs'

function viewport(width) {
  return {
    measurements: [{
      target: '.hero',
      source: { x: 0, y: 20, width, height: 400, aspectRatio: width / 400 },
      rendered: { x: 0.5, y: 20.5, width: width - 0.5, height: 400.5, aspectRatio: (width - 0.5) / 400.5 }
    }],
    images: { expected: 1, results: [{ target: '.hero img', loaded: true, croppingMatch: true }] },
    typographyMatch: true,
    layoutMatch: true,
    adaptive: true
  }
}

export function completeAcceptance() {
  return {
    editorFieldsComplete: true,
    viewports: { desktop: viewport(600), mobile: viewport(360) }
  }
}

test('accepts both viewports when geometry and appearance are within tolerance', () => {
  const result = evaluateComponentAcceptance(completeAcceptance())
  assert.equal(result.pass, true)
  assert.equal(result.status, 'passed')
})

test('missing mobile evidence and incomplete editor fields fail immediately', () => {
  const evidence = completeAcceptance()
  delete evidence.viewports.mobile
  evidence.editorFieldsComplete = false

  const result = evaluateComponentAcceptance(evidence)

  assert.equal(result.pass, false)
  assert.ok(result.failures.some((failure) => failure.type === 'missing-viewport' && failure.viewport === 'mobile'))
  assert.ok(result.failures.some((failure) => failure.type === 'editor-fields-incomplete'))
})

test('rejects dimensions, positions, and aspect ratios outside tolerance', () => {
  const evidence = completeAcceptance()
  const rendered = evidence.viewports.desktop.measurements[0].rendered
  rendered.width += 3
  rendered.x += 2
  rendered.aspectRatio += 0.05

  const result = evaluateComponentAcceptance(evidence)

  for (const property of ['width', 'x', 'aspectRatio']) {
    assert.ok(result.failures.some((failure) => failure.type === 'geometry-mismatch' && failure.property === property), property)
  }
})

test('rejects unloaded images, crop mismatch, font mismatch, layout mismatch, and non-adaptive output', () => {
  const evidence = completeAcceptance()
  const mobile = evidence.viewports.mobile
  mobile.images.results[0].loaded = false
  mobile.images.results[0].croppingMatch = false
  mobile.typographyMatch = false
  mobile.layoutMatch = false
  mobile.adaptive = false

  const result = evaluateComponentAcceptance(evidence)

  for (const type of ['image-not-loaded', 'image-crop-mismatch', 'typography-mismatch', 'layout-mismatch', 'responsive-mismatch']) {
    assert.ok(result.failures.some((failure) => failure.type === type), type)
  }
})

test('requires acceptance evidence for every captured geometry target and image', () => {
  const evidence = completeAcceptance()
  const result = evaluateComponentAcceptance(evidence, {
    expectedTargets: ['.hero', '.title'],
    expectedImageCount: 2
  })

  assert.equal(result.pass, false)
  assert.ok(result.failures.some((failure) => failure.type === 'missing-measurement-target' && failure.target === '.title'))
  assert.ok(result.failures.some((failure) => failure.type === 'captured-image-count-mismatch' && failure.expected === 2))
})
