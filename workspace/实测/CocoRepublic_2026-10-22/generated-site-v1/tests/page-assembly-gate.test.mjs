import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  evaluatePageAssembly,
  verifyAndPromotePage,
} from '../scripts/lib/page-assembly-gate.mjs';

function validEvidence() {
  return {
    route: '/living',
    componentIds: ['header', 'hero', 'grid', 'footer'],
    acceptedComponentIds: ['header', 'hero', 'grid', 'footer'],
    viewports: {
      desktop: { visual: { pass: true }, geometry: { pass: true } },
      mobile: { visual: { pass: true }, geometry: { pass: true } },
    },
    interactions: { pass: true, total: 12, verified: 12, failures: [] },
  };
}

test('page assembly rejects any component that lacks accepted unit evidence', () => {
  const evidence = validEvidence();
  evidence.acceptedComponentIds = ['header', 'hero', 'footer'];
  const result = evaluatePageAssembly(evidence);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'components', type: 'unverified-component', componentId: 'grid' }]);
});

test('page assembly fails closed for missing desktop or mobile evidence', () => {
  const evidence = validEvidence();
  delete evidence.viewports.mobile;
  const result = evaluatePageAssembly(evidence);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'viewport', type: 'missing-viewport-evidence', viewport: 'mobile' }]);
});

test('overlap, blank margin, and broken layering failures block the page', () => {
  const evidence = validEvidence();
  evidence.viewports.desktop.geometry = {
    pass: false,
    failures: [
      { type: 'cross-component-overlap', components: ['hero', 'grid'] },
      { type: 'unexpected-blank-margin', edge: 'right', pixels: 320 },
      { type: 'layering-mismatch', componentId: 'header' },
    ],
  };
  const result = evaluatePageAssembly(evidence);
  assert.equal(result.pass, false);
  assert.equal(result.failures.length, 3);
  assert.ok(result.failures.every((failure) => failure.gate === 'desktop-geometry'));
});

test('a control whose assembled result differs from its component result blocks the page', () => {
  const evidence = validEvidence();
  evidence.interactions = {
    pass: false,
    total: 12,
    verified: 11,
    failures: [{ type: 'assembled-interaction-mismatch', controlId: 'sign-in', expected: 'drawer', actual: 'navigation' }],
  };
  const result = evaluatePageAssembly(evidence);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    gate: 'interactions',
    type: 'assembled-interaction-mismatch',
    controlId: 'sign-in',
    expected: 'drawer',
    actual: 'navigation',
  }]);
});

test('missing interaction coverage cannot be treated as a page pass', () => {
  const evidence = validEvidence();
  evidence.interactions.verified = 11;
  const result = evaluatePageAssembly(evidence);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'interactions', type: 'incomplete-control-coverage', total: 12, verified: 11 }]);
});

test('only a fully verified page is atomically promoted with its manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-page-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'living');
  const acceptedDir = path.join(root, 'accepted', 'living');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'page.json'), '{"route":"/living"}');

  const result = await verifyAndPromotePage({ pageId: 'living', stagingDir, acceptedDir, evidence: validEvidence() });

  assert.equal(result.pass, true);
  assert.equal(result.promoted, true);
  const manifest = JSON.parse(await fs.readFile(path.join(acceptedDir, 'accepted-page-manifest.json'), 'utf8'));
  assert.equal(manifest.pageId, 'living');
  assert.equal(manifest.route, '/living');
  assert.equal(manifest.pass, true);
});

