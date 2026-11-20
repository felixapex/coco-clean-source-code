import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceLocalParityCheckpoint,
  loadSourceLocalParityCheckpoint,
  recordSourceLocalParityRoute,
  writeSourceLocalParityCheckpoint,
} from '../scripts/lib/source-local-parity-checkpoint.mjs';

test('completed source-local parity routes resume without double counting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-parity-checkpoint-'));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  let checkpoint = createSourceLocalParityCheckpoint({ auditKey: 'candidate-a', routeOrder: ['/', '/chair'] });
  checkpoint = recordSourceLocalParityRoute(checkpoint, {
    route: '/',
    routeResult: { route: '/', sourceCount: 3, localCount: 3, comparedCount: 3, pass: true },
    failures: [],
    completed: true,
  });
  await writeSourceLocalParityCheckpoint(checkpointPath, checkpoint);
  const resumed = await loadSourceLocalParityCheckpoint(checkpointPath, {
    auditKey: 'candidate-a', routeOrder: ['/', '/chair'],
  });
  assert.deepEqual(resumed.completedRoutes, ['/']);
  assert.deepEqual(resumed.pendingRoutes, ['/chair']);
  assert.equal(resumed.report.sourceControlCount, 3);
  assert.equal(resumed.report.comparedControlCount, 3);
  await fs.rm(directory, { recursive: true, force: true });
});

test('a changed local candidate invalidates all completed route results', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-parity-checkpoint-'));
  const checkpointPath = path.join(directory, 'checkpoint.json');
  const oldCheckpoint = recordSourceLocalParityRoute(
    createSourceLocalParityCheckpoint({ auditKey: 'candidate-a', routeOrder: ['/'] }),
    { route: '/', routeResult: { route: '/', sourceCount: 1, localCount: 1, comparedCount: 1, pass: true }, completed: true },
  );
  await writeSourceLocalParityCheckpoint(checkpointPath, oldCheckpoint);
  const current = await loadSourceLocalParityCheckpoint(checkpointPath, {
    auditKey: 'candidate-b', routeOrder: ['/'],
  });
  assert.deepEqual(current.completedRoutes, []);
  assert.deepEqual(current.pendingRoutes, ['/']);
  assert.equal(current.report.routeResults.length, 0);
  await fs.rm(directory, { recursive: true, force: true });
});

test('failed source-local parity route remains pending and is replaced on retry', () => {
  let checkpoint = createSourceLocalParityCheckpoint({ auditKey: 'candidate', routeOrder: ['/retry'] });
  checkpoint = recordSourceLocalParityRoute(checkpoint, {
    route: '/retry',
    routeResult: { route: '/retry', sourceCount: 2, localCount: 0, comparedCount: 0, pass: false },
    failures: [{ route: '/retry', type: 'route-audit-error' }],
    completed: false,
  });
  checkpoint = recordSourceLocalParityRoute(checkpoint, {
    route: '/retry',
    routeResult: { route: '/retry', sourceCount: 2, localCount: 2, comparedCount: 2, pass: true },
    failures: [],
    completed: true,
  });
  assert.deepEqual(checkpoint.completedRoutes, ['/retry']);
  assert.equal(checkpoint.report.sourceControlCount, 2);
  assert.equal(checkpoint.report.localControlCount, 2);
  assert.equal(checkpoint.report.failures.length, 0);
});
