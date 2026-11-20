import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePipelineBudget, resolveCaptureConcurrency, runWithPipelineDeadline } from '../../src/pipeline/pipeline-policy.mjs';

test('twenty minutes is a hard whole-pipeline delivery gate', () => {
  assert.deepEqual(evaluatePipelineBudget(1_200_000), { pass: true, elapsedMs: 1_200_000, budgetMs: 1_200_000, overrunMs: 0 });
  assert.deepEqual(evaluatePipelineBudget(1_200_001), { pass: false, elapsedMs: 1_200_001, budgetMs: 1_200_000, overrunMs: 1 });
});

test('capture concurrency defaults to eight and cannot exceed twelve', () => {
  assert.equal(resolveCaptureConcurrency(), 8);
  assert.equal(resolveCaptureConcurrency('0'), 1);
  assert.equal(resolveCaptureConcurrency('99'), 12);
});

test('whole pipeline is rejected when the hard deadline expires', async () => {
  await assert.rejects(
    () => runWithPipelineDeadline(() => new Promise(() => {}), { budgetMs: 10 }),
    /hard deadline exceeded.*10ms/i,
  );
});
