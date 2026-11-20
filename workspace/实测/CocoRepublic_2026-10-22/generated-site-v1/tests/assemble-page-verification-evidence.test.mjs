import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const script = path.resolve(import.meta.dirname, '..', 'scripts', 'assemble-page-verification-evidence.mjs');

test('the assembler writes one fail-closed page artifact from real audit report shapes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-page-evidence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const writeJson = async (relative, value) => {
    const file = path.join(root, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value));
  };
  await writeJson('.dist-staging/component-library/page-compositions.json', [
    { route: '/living', instances: [{ matboxComponentId: 'hero' }] },
    { route: '/living?matbox-viewport=mobile', instances: [{ matboxComponentId: 'hero-mobile' }] },
  ]);
  for (const id of ['hero', 'hero-mobile']) {
    await writeJson(`artifacts/incremental-build/accepted/${encodeURIComponent(id)}/accepted-unit-manifest.json`, { pass: true, unitId: id });
  }
  await writeJson('artifacts/full-site-audit/fidelity/summary.json', { results: [
    { route: '/living', viewport: 'desktop', pass: true, similarity: 0.97 },
    { route: '/living', viewport: 'mobile', pass: true, similarity: 0.96 },
  ] });
  await writeJson('artifacts/full-site-audit/responsive-layout.json', { cells: [
    { route: '/living', viewport: 'desktop', width: 1440, pass: true, failures: [] },
    { route: '/living', viewport: 'mobile', width: 390, pass: true, failures: [] },
  ] });
  for (const viewport of ['desktop', 'mobile']) {
    await writeJson(`artifacts/full-site-audit/source-local-interaction-parity-targeted-${viewport}.json`, {
      routeResults: [{ route: '/living', pass: true, sourceCount: 2, localCount: 2, comparedCount: 2 }], failures: [],
    });
  }

  execFileSync(process.execPath, [script, '--route=/living'], { cwd: root, stdio: 'pipe' });

  const evidence = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'page-verification', '%2Fliving.json'), 'utf8'));
  assert.deepEqual(evidence.componentIds, ['hero', 'hero-mobile']);
  assert.deepEqual(evidence.acceptedComponentIds.sort(), ['hero', 'hero-mobile']);
  assert.equal(evidence.viewports.mobile.visual.pass, true);
  assert.equal(evidence.interactions.total, 4);
  const summary = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'page-verification', 'summary.json'), 'utf8'));
  assert.equal(summary.passed, 1);
  assert.equal(summary.failed, 0);
});

