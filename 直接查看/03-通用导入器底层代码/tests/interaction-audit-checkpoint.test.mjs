import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildInteractionAuditKey,
  createInteractionAuditCheckpoint,
  loadInteractionAuditCheckpoint,
  recordInteractionAuditRoute,
  writeInteractionAuditCheckpoint,
} from '../scripts/lib/interaction-audit-checkpoint.mjs';

test('candidate route manifest changes invalidate a targeted interaction checkpoint', () => {
  const common = {
    routeOrder: ['/bedroom/storage/dressers'],
    interactionRedirects: {},
  };
  const before = buildInteractionAuditKey({
    ...common,
    generatedRoutePaths: ['/bedroom/storage/dressers'],
  });
  const after = buildInteractionAuditKey({
    ...common,
    generatedRoutePaths: ['/bedroom/storage/dressers', '/-camden-dresser.html'],
  });
  assert.notEqual(before, after);
});

test('candidate page content changes invalidate a targeted interaction checkpoint', () => {
  const common = {
    routeOrder: ['/design-now-pay-later'],
    interactionRedirects: {},
    generatedRoutePaths: ['/design-now-pay-later'],
  };
  const before = buildInteractionAuditKey({ ...common, routeContentFingerprints: { '/design-now-pay-later': 'old-html' } });
  const after = buildInteractionAuditKey({ ...common, routeContentFingerprints: { '/design-now-pay-later': 'fixed-html' } });
  assert.notEqual(before, after);
});

test('completed interaction routes survive interruption and are skipped after resume', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-click-checkpoint-'));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  let checkpoint = createInteractionAuditCheckpoint({
    auditKey: 'candidate-hash-v1',
    routeOrder: ['/', '/products/chair'],
  });
  checkpoint = recordInteractionAuditRoute(checkpoint, {
    route: '/',
    routeResult: { route: '/', visibleControls: 3, anchors: 2, buttons: 1, noEffectButtons: 0 },
    completed: true,
  });
  await writeInteractionAuditCheckpoint(checkpointPath, checkpoint);

  const resumed = await loadInteractionAuditCheckpoint(checkpointPath, {
    auditKey: 'candidate-hash-v1',
    routeOrder: ['/', '/products/chair'],
  });
  assert.deepEqual(resumed.completedRoutes, ['/']);
  assert.deepEqual(resumed.pendingRoutes, ['/products/chair']);
  assert.equal(resumed.report.routeResults.length, 1);
  assert.deepEqual(await fs.readdir(directory), ['checkpoint.json']);
  await fs.rm(directory, { recursive: true, force: true });
});

test('failed route is recorded but remains pending for a later retry', () => {
  let checkpoint = createInteractionAuditCheckpoint({
    auditKey: 'candidate-hash-v1',
    routeOrder: ['/good', '/timed-out'],
  });
  checkpoint = recordInteractionAuditRoute(checkpoint, {
    route: '/timed-out',
    routeResult: { route: '/timed-out', visibleControls: 0, anchors: 0, buttons: 0, noEffectButtons: 0 },
    failures: [{ type: 'route-load-failure', route: '/timed-out', error: 'Route not ready' }],
    completed: false,
  });
  assert.deepEqual(checkpoint.completedRoutes, []);
  assert.deepEqual(checkpoint.pendingRoutes, ['/good', '/timed-out']);
  assert.equal(checkpoint.report.failures[0].type, 'route-load-failure');
});

test('checkpoint from a different candidate is ignored instead of contaminating the audit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-click-checkpoint-'));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  await writeInteractionAuditCheckpoint(checkpointPath, recordInteractionAuditRoute(
    createInteractionAuditCheckpoint({ auditKey: 'old-build', routeOrder: ['/'] }),
    { route: '/', routeResult: { route: '/', visibleControls: 1 }, completed: true },
  ));
  const current = await loadInteractionAuditCheckpoint(checkpointPath, {
    auditKey: 'new-build',
    routeOrder: ['/'],
  });
  assert.deepEqual(current.completedRoutes, []);
  assert.deepEqual(current.pendingRoutes, ['/']);
  await fs.rm(directory, { recursive: true, force: true });
});

test('a retried failed route replaces partial counters instead of double counting them', () => {
  let checkpoint = createInteractionAuditCheckpoint({ auditKey: 'candidate', routeOrder: ['/retry'] });
  checkpoint = recordInteractionAuditRoute(checkpoint, {
    route: '/retry',
    routeResult: { route: '/retry', visibleControls: 2, anchors: 1, buttons: 1, clickedButtons: 0, expectedNoChange: 0 },
    failures: [{ type: 'route-audit-failure', route: '/retry' }],
    completed: false,
  });
  checkpoint = recordInteractionAuditRoute(checkpoint, {
    route: '/retry',
    routeResult: { route: '/retry', visibleControls: 3, anchors: 2, buttons: 1, clickedButtons: 1, expectedNoChange: 0 },
    completed: true,
  });
  assert.equal(checkpoint.report.visibleControlInstances, 3);
  assert.equal(checkpoint.report.anchorInstances, 2);
  assert.equal(checkpoint.report.nonAnchorButtonInstances, 1);
  assert.equal(checkpoint.report.clickedButtonInstances, 1);
  assert.deepEqual(checkpoint.report.failures, []);
});
