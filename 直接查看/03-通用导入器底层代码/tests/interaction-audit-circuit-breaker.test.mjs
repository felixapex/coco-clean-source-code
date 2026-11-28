import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interactionFailureSignature,
  recordInteractionFailures,
} from '../scripts/lib/interaction-audit-circuit-breaker.mjs';

test('same interaction defect on three distinct routes trips the batch', () => {
  let state;
  for (const route of ['/a', '/b', '/c']) {
    state = recordInteractionFailures(state, [{
      type: 'no-observable-effect',
      route,
      control: { tag: 'button', classes: ['swatch-button'], text: 'VIEW IN SHOWROOM' },
    }], { threshold: 3 });
  }
  assert.equal(state.tripped, true);
  assert.equal(state.trigger.routeCount, 3);
  assert.match(state.trigger.signature, /VIEW IN SHOWROOM/);
});

test('repeated controls on one page count as one affected route', () => {
  let state = recordInteractionFailures(undefined, [
    { type: 'no-observable-effect', route: '/a', control: { text: 'SELECT OPTIONS', classes: ['select-option'] } },
    { type: 'no-observable-effect', route: '/a', control: { text: 'SELECT OPTIONS', classes: ['select-option'] } },
  ], { threshold: 2 });
  assert.equal(state.tripped, false);
  state = recordInteractionFailures(state, [
    { type: 'no-observable-effect', route: '/b', control: { text: 'SELECT OPTIONS', classes: ['select-option'] } },
  ], { threshold: 2 });
  assert.equal(state.tripped, true);
});

test('different page-specific defects do not trip a shared-defect circuit', () => {
  let state;
  for (const [route, text] of [['/a', 'A'], ['/b', 'B'], ['/c', 'C']]) {
    state = recordInteractionFailures(state, [{ type: 'no-observable-effect', route, control: { text } }], { threshold: 2 });
  }
  assert.equal(state.tripped, false);
});

test('missing internal route is grouped by its missing target', () => {
  assert.equal(
    interactionFailureSignature({ type: 'ungenerated-internal-target', target: '/fabric-swatches/missing' }),
    'ungenerated-internal-target|/fabric-swatches/missing',
  );
});
