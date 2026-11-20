import test from 'node:test';
import assert from 'node:assert/strict';

import { runTimedStage } from '../scripts/lib/pipeline-timing.mjs';

test('generation timer records successful stage duration and status', async () => {
  const timings = [];
  const ticks = [100, 250];
  const result = await runTimedStage({
    name: 'build',
    timings,
    now: () => ticks.shift(),
    execute: async () => 'done',
  });

  assert.equal(result, 'done');
  assert.deepEqual(timings, [{ name: 'build', status: 'passed', elapsedMs: 150 }]);
});

test('generation timer records failed stage duration before rethrowing', async () => {
  const timings = [];
  const ticks = [1_000, 3_500];

  await assert.rejects(() => runTimedStage({
    name: 'desktop-rendered-golden-capture',
    timings,
    now: () => ticks.shift(),
    execute: async () => { throw new Error('capture denied'); },
  }), /capture denied/);

  assert.deepEqual(timings, [{
    name: 'desktop-rendered-golden-capture',
    status: 'failed',
    elapsedMs: 2_500,
    error: 'capture denied',
  }]);
});

test('generation timer distinguishes a timed-out stage', async () => {
  const timings = [];
  const ticks = [2_000, 9_000];

  await assert.rejects(() => runTimedStage({
    name: 'automated-acceptance',
    timings,
    now: () => ticks.shift(),
    execute: async () => { throw new Error('20-minute budget exceeded during automated-acceptance'); },
  }), /budget exceeded/);

  assert.equal(timings[0].status, 'timed-out');
  assert.equal(timings[0].elapsedMs, 7_000);
});
