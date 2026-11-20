import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRouteClosureStep } from '../scripts/lib/route-closure-pipeline.mjs';

test('route closure completes only when the route-link audit passes', () => {
  assert.deepEqual(decideRouteClosureStep({ pass: true }, { passIndex: 0, maxPasses: 3 }), {
    action: 'complete',
    missingRouteCount: 0,
  });
});

test('route closure expands and retries when only generated local targets are missing', () => {
  assert.deepEqual(decideRouteClosureStep({
    pass: false,
    escapedCapturedRouteCount: 0,
    escapedSourceRouteCount: 0,
    uncapturedLocalRoutes: ['/products/a', '/products/b'],
  }, { passIndex: 0, maxPasses: 3 }), {
    action: 'expand',
    missingRouteCount: 2,
  });
});

test('route closure fails closed on source-link escapes instead of masking them with expansion', () => {
  assert.deepEqual(decideRouteClosureStep({
    pass: false,
    escapedCapturedRouteCount: 1,
    escapedSourceRouteCount: 1,
    uncapturedLocalRoutes: ['/products/a'],
  }, { passIndex: 0, maxPasses: 3 }), {
    action: 'fail',
    code: 'route-link-escape',
    missingRouteCount: 1,
  });
});

test('route closure fails closed when expansion does not converge within the configured passes', () => {
  assert.deepEqual(decideRouteClosureStep({
    pass: false,
    escapedCapturedRouteCount: 0,
    escapedSourceRouteCount: 0,
    uncapturedLocalRoutes: ['/products/a'],
  }, { passIndex: 2, maxPasses: 3 }), {
    action: 'fail',
    code: 'route-closure-not-converged',
    missingRouteCount: 1,
  });
});

test('the main pipeline performs stage-only route closure before the publishable build', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/run-20-minute-pipeline.mjs', import.meta.url), 'utf8'));
  assert.match(source, /build\.mjs', '--stage-only'/);
  assert.match(source, /extend-route-inventory-from-link-closure\.mjs/);
  assert.match(source, /MATBOX_RESUME: '1'/);
  assert.match(source, /decideRouteClosureStep/);
});
