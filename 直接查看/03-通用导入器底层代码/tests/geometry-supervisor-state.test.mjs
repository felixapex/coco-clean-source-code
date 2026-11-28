import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findCompleteGeometryFiles,
  reconcileGeometryBatch,
} from '../scripts/lib/geometry-supervisor-state.mjs';

test('batch reconciliation preserves completed pages and retries only incomplete pages', () => {
  const batch = [
    { route: '/a', filename: 'a.html' },
    { route: '/b', filename: 'b.html' },
    { route: '/c', filename: 'c.html' },
  ];

  const result = reconcileGeometryBatch(batch, new Set(['a.html', 'c.html']), '2026-11-27T00:00:00.000Z');

  assert.deepEqual(result.completed, [
    { route: '/a', filename: 'a.html', completedAt: '2026-11-27T00:00:00.000Z' },
    { route: '/c', filename: 'c.html', completedAt: '2026-11-27T00:00:00.000Z' },
  ]);
  assert.deepEqual(result.incomplete, [{ route: '/b', filename: 'b.html' }]);
});

test('completion scan reads only files in the current batch', async () => {
  const reads = [];
  const complete = await findCompleteGeometryFiles([
    { filename: 'a.html' },
    { filename: 'b.html' },
  ], {
    replayRoot: 'replay',
    async readFile(filename) {
      reads.push(filename);
      return filename.endsWith('a.html') ? 'complete' : 'incomplete';
    },
    isComplete: (html) => html === 'complete',
  });

  assert.deepEqual(reads, ['replay\\a.html', 'replay\\b.html']);
  assert.deepEqual(complete, new Set(['a.html']));
});
