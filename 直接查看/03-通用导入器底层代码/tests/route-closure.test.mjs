import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteRecoverySchedule, isCaptureCandidateRoute, mergeRouteClosure } from '../scripts/lib/route-closure.mjs';

test('route closure includes storefront content and product pages', () => {
  assert.equal(isCaptureCandidateRoute('/705936-aster-bedside-table.html'), true);
  assert.equal(isCaptureCandidateRoute('/collections/luminous/new-collection-living'), true);
  assert.equal(isCaptureCandidateRoute('/blog/designing-with-intention'), true);
});

test('route closure excludes actions, assets, malformed placeholders, and documents', () => {
  for (const route of ['/login.php', '/cart.php', '/content/report.pdf', '/~~PRODUCT_ACTION_URL~~', '/https:/example.com', '/styles.css']) {
    assert.equal(isCaptureCandidateRoute(route), false, route);
  }
});

test('route closure merges and sorts unique targets', () => {
  assert.deepEqual(mergeRouteClosure(['/b', '/'], ['/a', '/b', '/login.php']), ['/', '/a', '/b']);
});

test('route recovery schedules each unique target once and defers protected pages', () => {
  const schedule = createRouteRecoverySchedule({
    uniqueMissingTargets: [
      { targetRoute: '/collections/shifting-spaces', type: 'uncaptured-local-route', referenceCount: 80, status: 'unresolved' },
      { targetRoute: '/contact-us', type: 'uncaptured-local-route', referenceCount: 1, status: 'source-protected' },
      { targetRoute: '/content/report.pdf', type: 'missing-local-document', referenceCount: 1, status: 'unresolved' },
    ],
  });

  assert.deepEqual(schedule.scheduled, [
    { kind: 'page', route: '/collections/shifting-spaces', referenceCount: 80 },
    { kind: 'resource', resourceUrl: '/content/report.pdf', referenceCount: 1 },
  ]);
  assert.deepEqual(schedule.deferred, [
    { kind: 'source-protected', route: '/contact-us', referenceCount: 1 },
  ]);
});
