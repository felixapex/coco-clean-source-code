import test from 'node:test';
import assert from 'node:assert/strict';
import { assignInteractionAuditShards, mergeInteractionAuditReports } from '../scripts/lib/interaction-audit-shards.mjs';

test('interaction shards cap concurrency at two and assign every route once', () => {
  const routes = ['/', '/a', '/b', '/c'];
  const shards = assignInteractionAuditShards(routes, new Map([['/', 100], ['/a', 80], ['/b', 20], ['/c', 10]]), 8);
  assert.equal(shards.length, 2);
  assert.deepEqual(shards.flatMap((shard) => shard.routes).sort(), [...routes].sort());
});

test('interaction report merger requires exact route coverage and validated target union', () => {
  const merged = mergeInteractionAuditReports({
    routes: ['/', '/a'],
    reports: [
      {
        routeResults: [{ route: '/', visibleControls: 2, anchors: 1, buttons: 1, clickedButtons: 1 }],
        failures: [],
        internalTargetDetails: [{ target: '/a', occurrences: 1, sources: [{ route: '/', text: 'A' }], validated: true }],
      },
      {
        routeResults: [{ route: '/a', visibleControls: 1, anchors: 1, buttons: 0, clickedButtons: 0 }],
        failures: [],
        internalTargetDetails: [{ target: '/a', occurrences: 2, sources: [{ route: '/a', text: 'Self' }], validated: true }],
      },
    ],
  });
  assert.equal(merged.pass, true);
  assert.equal(merged.visibleControlInstances, 3);
  assert.equal(merged.uniqueInternalTargets, 1);
  assert.equal(merged.internalTargetDetails[0].occurrences, 3);

  const incomplete = mergeInteractionAuditReports({ routes: ['/', '/a'], reports: [merged] });
  assert.equal(incomplete.pass, true);
  const missing = mergeInteractionAuditReports({ routes: ['/', '/a', '/missing'], reports: [merged] });
  assert.equal(missing.pass, false);
  assert.equal(missing.coverageFailures[0].type, 'missing-interaction-route');
});
