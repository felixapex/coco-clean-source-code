import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateUnitPromotion,
  promoteDirectoryAtomically,
  runIncrementalBuild,
  verifyAndPromoteUnit,
} from '../scripts/lib/incremental-build-gate.mjs';
import {
  createPortableComponentPackage,
  materializePortableComponentPackage,
} from '../../../../packages/import-foundation/component-package.mjs';

function passed(name) {
  return { gate: name, pass: true, failures: [] };
}

function validEvidence() {
  return {
    contract: passed('contract'),
    visual: passed('visual'),
    interaction: passed('interaction'),
    coverage: passed('coverage'),
    assets: passed('assets'),
    schema: passed('schema'),
    bindings: passed('bindings'),
    imageRatio: passed('image-ratio'),
    mutations: passed('mutations'),
  };
}

function validComponent(overrides = {}) {
  return {
    matboxComponentId: 'matbox.section.hero-banner.v1.test',
    sourceSectionId: 'home__hero',
    sourceSectionType: 'hero-banner',
    sourceMarkup: '<section data-section-id="home__hero" data-section-type="hero-banner"><h1>Hero</h1></section>',
    schema: {
      name: '首屏横幅',
      tag: 'section',
      settings: [],
      blocks: [{ type: '@theme' }],
      max_blocks: 4,
      presets: [{ name: '首屏横幅' }],
    },
    sourceGeometry: {
      x: 0,
      y: 100,
      width: 1440,
      height: 720,
      parentWidth: 1440,
      parentHeight: 900,
      viewport: 'desktop',
      viewportWidth: 1440,
      viewportHeight: 900,
      visible: true,
    },
    contract: { responsiveLayout: [] },
    ...overrides,
  };
}

async function writeValidPackage(stagingDir, component = validComponent(), evidence = validEvidence()) {
  const packageRecord = createPortableComponentPackage(component, { verification: evidence });
  const result = await materializePortableComponentPackage(packageRecord, stagingDir);
  assert.equal(result.pass, true, JSON.stringify(result.failures));
}

test('promotion fails closed for every required gate including schema and mutations', () => {
  for (const gate of Object.keys(validEvidence())) {
    const evidence = validEvidence();
    evidence[gate] = { gate, pass: false, failures: [{ type: `${gate}-failed` }] };
    const result = evaluateUnitPromotion(evidence);
    assert.equal(result.pass, false, gate);
    assert.deepEqual(result.failures, [{ gate, type: `${gate}-failed` }], gate);
  }
});

test('an explicitly measured hidden popup remains eligible for promotion', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-hidden-popup-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'popup');
  const acceptedDir = path.join(root, 'accepted', 'popup');
  const component = validComponent({
    sourceGeometry: {
      ...validComponent().sourceGeometry,
      width: 0,
      height: 0,
      visible: false,
    },
  });
  await writeValidPackage(stagingDir, component);

  const result = await verifyAndPromoteUnit({
    unitId: 'popup',
    stagingDir,
    acceptedDir,
    evidence: validEvidence(),
    component,
  });
  assert.equal(result.pass, true);
  assert.equal(result.promoted, true);
});

test('missing gate evidence fails rather than being treated as pass', () => {
  const evidence = validEvidence();
  delete evidence.mutations;
  const result = evaluateUnitPromotion(evidence);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'mutations', type: 'missing-gate-evidence' }]);
});

test('failed candidates stay in staging and accepted output remains unchanged', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-unit-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'hero');
  const acceptedDir = path.join(root, 'accepted', 'hero');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.mkdir(acceptedDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'component.json'), '{"candidate":2}');
  await fs.writeFile(path.join(acceptedDir, 'component.json'), '{"accepted":1}');
  const evidence = validEvidence();
  evidence.imageRatio = { pass: false, failures: [{ type: 'image-ratio-mismatch' }] };

  const result = await verifyAndPromoteUnit({ unitId: 'hero', stagingDir, acceptedDir, evidence, component: validComponent() });

  assert.equal(result.pass, false);
  assert.equal(await fs.readFile(path.join(stagingDir, 'component.json'), 'utf8'), '{"candidate":2}');
  assert.equal(await fs.readFile(path.join(acceptedDir, 'component.json'), 'utf8'), '{"accepted":1}');
});

test('only a fully verified candidate is atomically promoted with its evidence manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-unit-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'hero');
  const acceptedDir = path.join(root, 'accepted', 'hero');
  await writeValidPackage(stagingDir);

  const result = await verifyAndPromoteUnit({ unitId: 'hero', stagingDir, acceptedDir, evidence: validEvidence(), component: validComponent() });

  assert.equal(result.pass, true);
  const packageManifest = JSON.parse(await fs.readFile(path.join(acceptedDir, 'manifest.json'), 'utf8'));
  assert.equal(packageManifest.componentId, 'matbox.section.hero-banner.v1.test');
  assert.equal(packageManifest.status, 'accepted');
  const manifest = JSON.parse(await fs.readFile(path.join(acceptedDir, 'accepted-unit-manifest.json'), 'utf8'));
  assert.equal(manifest.unitId, 'hero');
  assert.equal(manifest.pass, true);
  await assert.rejects(() => fs.access(stagingDir));
});

test('a component.json-only candidate cannot be promoted as a complete component package', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-incomplete-package-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'hero');
  const acceptedDir = path.join(root, 'accepted', 'hero');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'component.json'), '{}');

  const result = await verifyAndPromoteUnit({
    unitId: 'hero',
    stagingDir,
    acceptedDir,
    evidence: validEvidence(),
    component: validComponent(),
  });

  assert.equal(result.pass, false);
  assert.equal(result.promoted, false);
  assert.ok(result.failures.some((failure) => failure.gate === 'package' && failure.type === 'missing-package-file'));
  await assert.rejects(() => fs.access(acceptedDir));
});

test('promotion rejects a candidate whose measured component geometry is missing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-unit-geometry-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'hero');
  const acceptedDir = path.join(root, 'accepted', 'hero');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'component.json'), '{}');

  const result = await verifyAndPromoteUnit({
    unitId: 'hero',
    stagingDir,
    acceptedDir,
    evidence: validEvidence(),
    component: validComponent({ sourceGeometry: null }),
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'candidate', type: 'missing-component-geometry' }]);
  await assert.rejects(() => fs.access(acceptedDir));
});

test('promotion rejects an editable image without captured intrinsic and rendered geometry', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-unit-image-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'hero');
  const acceptedDir = path.join(root, 'accepted', 'hero');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'component.json'), '{}');

  const result = await verifyAndPromoteUnit({
    unitId: 'hero',
    stagingDir,
    acceptedDir,
    evidence: validEvidence(),
    component: validComponent({ sourceMarkup: '<section><img src="/hero.jpg"></section>' }),
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'candidate', type: 'missing-candidate-image-geometry', imageIndex: 0 }]);
});

test('promotion rejects a published component asset that is absent from the frozen asset manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-unit-resource-gate-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging', 'hero');
  const acceptedDir = path.join(root, 'accepted', 'hero');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'component.json'), '{}');

  const result = await verifyAndPromoteUnit({
    unitId: 'hero',
    stagingDir,
    acceptedDir,
    evidence: validEvidence(),
    component: validComponent({ sourceMarkup: '<section><link rel="stylesheet" href="/component-library/assets/missing.css"></section>' }),
    availableAssetHrefs: [],
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    gate: 'candidate',
    type: 'unresolved-component-asset',
    href: '/component-library/assets/missing.css',
  }]);
});

test('the incremental loop stops before generating the next component after a failure', async () => {
  const generated = [];
  const verified = [];
  const result = await runIncrementalBuild({
    units: ['header', 'hero', 'footer'],
    buildCandidate: async (unitId) => {
      generated.push(unitId);
      return { unitId };
    },
    verifyCandidate: async ({ unitId }) => {
      verified.push(unitId);
      return unitId === 'hero' ? { pass: false, failures: [{ type: 'visual-failed' }] } : { pass: true, failures: [] };
    },
  });

  assert.equal(result.pass, false);
  assert.deepEqual(generated, ['header', 'hero']);
  assert.deepEqual(verified, ['header', 'hero']);
  assert.deepEqual(result.accepted, ['header']);
  assert.equal(result.failedUnitId, 'hero');
});

test('whole build output is swapped only after staging is complete', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-build-swap-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'dist.staging');
  const acceptedDir = path.join(root, 'dist');
  await fs.mkdir(stagingDir, { recursive: true });
  await fs.mkdir(acceptedDir, { recursive: true });
  await fs.writeFile(path.join(stagingDir, 'version.txt'), 'new');
  await fs.writeFile(path.join(acceptedDir, 'version.txt'), 'old');

  await promoteDirectoryAtomically({ stagingDir, acceptedDir });

  assert.equal(await fs.readFile(path.join(acceptedDir, 'version.txt'), 'utf8'), 'new');
  await assert.rejects(() => fs.access(stagingDir));
  await assert.rejects(() => fs.access(`${acceptedDir}.previous`));
});

