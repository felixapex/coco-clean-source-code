import test from 'node:test';
import assert from 'node:assert/strict';
import { assignResponsiveAuditShards, mergeResponsiveAuditReports, replaceResponsiveAuditCells } from '../scripts/lib/responsive-audit-shards.mjs';

test('assigns every route exactly once and balances by document weight', () => {
  const routes = ['/', '/a', '/b', '/c', '/d'];
  const weights = new Map([['/', 100], ['/a', 90], ['/b', 20], ['/c', 10], ['/d', 5]]);
  const shards = assignResponsiveAuditShards(routes, weights, 2);
  const assigned = shards.flatMap((shard) => shard.routes);

  assert.deepEqual([...assigned].sort(), [...routes].sort());
  assert.equal(new Set(assigned).size, routes.length);
  assert.ok(Math.abs(shards[0].weight - shards[1].weight) <= 25);
});

test('merged report rejects missing or duplicated route cells', () => {
  const profiles = [
    { name: 'mobile', width: 390 },
    { name: 'desktop', width: 1440 },
  ];
  const passing = (route) => profiles.map((profile) => ({ route, viewport: profile.name, width: profile.width, pass: true, failures: [] }));

  const merged = mergeResponsiveAuditReports({
    routes: ['/', '/a'],
    profiles,
    reports: [{ cells: [...passing('/'), ...passing('/a')], failures: [] }],
  });
  assert.equal(merged.pass, true);
  assert.equal(merged.cellCount, 4);

  const incomplete = mergeResponsiveAuditReports({
    routes: ['/', '/a'],
    profiles,
    reports: [{ cells: passing('/'), failures: [] }],
  });
  assert.equal(incomplete.pass, false);
  assert.equal(incomplete.coverageFailures[0].type, 'missing-responsive-cell');
});

test('targeted patch replaces every profile for changed routes and drops deleted routes', () => {
  const profiles = [
    { name: 'mobile', width: 390 },
    { name: 'desktop', width: 1440 },
  ];
  const cells = (route, pass) => profiles.map((profile) => ({ route, viewport: profile.name, width: profile.width, pass, failures: pass ? [] : ['old-failure'] }));
  const merged = replaceResponsiveAuditCells({
    routes: ['/', '/fixed'],
    profiles,
    baseReport: {
      cells: [...cells('/', true), ...cells('/fixed', false), ...cells('/deleted', false)],
      failures: [{ route: '/fixed', failure: 'old-failure' }, { route: '/deleted', failure: 'old-failure' }],
    },
    patchReport: { cells: cells('/fixed', true), failures: [] },
  });
  assert.equal(merged.pass, true);
  assert.equal(merged.routeCount, 2);
  assert.equal(merged.cellCount, 4);
  assert.equal(merged.cells.some((cell) => cell.route === '/deleted'), false);
  assert.equal(merged.failures.length, 0);
});
