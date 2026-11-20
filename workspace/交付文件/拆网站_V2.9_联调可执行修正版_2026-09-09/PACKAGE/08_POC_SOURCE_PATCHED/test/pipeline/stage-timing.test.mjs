import test from 'node:test';
import assert from 'node:assert/strict';
import { runCheckpointedStage } from '../../src/pipeline/stage-timing.mjs';

test('shared stage timer checkpoints running and passed states immediately', async () => {
  const timings = [];
  const checkpoints = [];
  const values = [100, 160];
  const result = await runCheckpointedStage({
    name: 'capture',
    timings,
    now: () => values.shift(),
    checkpoint: async (timing) => checkpoints.push({ ...timing }),
    execute: async () => 'ok',
  });
  assert.equal(result, 'ok');
  assert.deepEqual(checkpoints.map((entry) => entry.status), ['running', 'passed']);
  assert.equal(timings[0].elapsedMs, 60);
});

test('shared stage timer checkpoints failure evidence before rethrowing', async () => {
  const timings = [];
  const checkpoints = [];
  const values = [200, 275];
  await assert.rejects(runCheckpointedStage({
    name: 'capture',
    timings,
    now: () => values.shift(),
    checkpoint: async (timing) => checkpoints.push({ ...timing }),
    execute: async () => { throw new Error('boom'); },
  }), /boom/);
  assert.deepEqual(checkpoints.map((entry) => entry.status), ['running', 'failed']);
  assert.equal(checkpoints.at(-1).error, 'boom');
});
