import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createInteractionTiming,
  interactionTimingSummary,
  measureInteractionPhase,
  withInteractionTiming,
} from '../scripts/lib/interaction-audit-timing.mjs';

test('interaction timing separates repeated load and click costs without losing route context', async () => {
  const timing = createInteractionTiming();
  const ticks = [0, 40, 40, 55, 55, 90];
  const now = () => ticks.shift();

  await measureInteractionPhase(timing, {
    phase: 'page-load', route: '/chairs', side: 'source', now,
  }, async () => 'loaded');
  await measureInteractionPhase(timing, {
    phase: 'click-settle', route: '/chairs', side: 'source', now,
  }, async () => 'clicked');
  await measureInteractionPhase(timing, {
    phase: 'page-load', route: '/chairs', side: 'local', now,
  }, async () => 'loaded');

  assert.deepEqual(interactionTimingSummary(timing), {
    totalMeasuredMs: 90,
    observedSpanMs: 90,
    peakConcurrentPhases: 1,
    phases: {
      'click-settle': { count: 1, failedCount: 0, elapsedMs: 15, averageMs: 15, maxMs: 15 },
      'page-load': { count: 2, failedCount: 0, elapsedMs: 75, averageMs: 37.5, maxMs: 40 },
    },
    sides: {
      local: { count: 1, failedCount: 0, elapsedMs: 35 },
      source: { count: 2, failedCount: 0, elapsedMs: 55 },
    },
    routes: {
      '/chairs': { count: 3, failedCount: 0, elapsedMs: 90 },
    },
  });
});

test('failed phases retain elapsed time and failure count', async () => {
  const timing = createInteractionTiming();
  const ticks = [10, 35];

  await assert.rejects(
    measureInteractionPhase(timing, {
      phase: 'interaction', route: '/broken', side: 'local', now: () => ticks.shift(),
    }, async () => { throw new Error('boom'); }),
    /boom/,
  );

  assert.deepEqual(interactionTimingSummary(timing).phases.interaction, {
    count: 1,
    failedCount: 1,
    elapsedMs: 25,
    averageMs: 25,
    maxMs: 25,
  });
});

test('audit report receives a serializable timing summary', async () => {
  const timing = createInteractionTiming();
  const ticks = [0, 12];
  await measureInteractionPhase(timing, {
    phase: 'inventory', route: '/', side: 'local', now: () => ticks.shift(),
  }, async () => true);

  assert.deepEqual(withInteractionTiming({ pass: true }, timing), {
    pass: true,
    timing: {
      totalMeasuredMs: 12,
      observedSpanMs: 12,
      peakConcurrentPhases: 1,
      phases: {
        inventory: { count: 1, failedCount: 0, elapsedMs: 12, averageMs: 12, maxMs: 12 },
      },
      sides: { local: { count: 1, failedCount: 0, elapsedMs: 12 } },
      routes: { '/': { count: 1, failedCount: 0, elapsedMs: 12 } },
    },
  });
});

test('timing summary exposes overlapping phases instead of presenting their sum as wall time', () => {
  const timing = createInteractionTiming();
  timing.records.push(
    { phase: 'load', route: '/', side: 'source', failed: false, startedAt: 0, endedAt: 100, elapsedMs: 100 },
    { phase: 'settle', route: '/', side: 'source', failed: false, startedAt: 25, endedAt: 75, elapsedMs: 50 },
  );

  const summary = interactionTimingSummary(timing);
  assert.equal(summary.totalMeasuredMs, 150);
  assert.equal(summary.observedSpanMs, 100);
  assert.equal(summary.peakConcurrentPhases, 2);
});
