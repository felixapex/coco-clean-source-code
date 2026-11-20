import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/chromium-capture.mjs';
import { runVisualRepairLoop } from '../../src/visual/repair-loop.mjs';

async function shot(color) {
  const result = await captureHtml(`<!doctype html><body style="margin:0;background:white"><div style="width:160px;height:160px;background:${color}"></div></body>`, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  return result.screenshot;
}

test('repair loop iterates from a worse render to a passing render and stops at threshold', async () => {
  const reference = await shot('black');
  const bad = await shot('gray');
  const good = await shot('black');
  let repairCalls = 0;

  const result = await runVisualRepairLoop({
    routeId: 'route-home',
    referencePng: reference,
    threshold: 0.99,
    maxIterations: 3,
    initialRevision: { id: 'rev-0', screenshot: bad, artifact: 'rev-0.png' },
    renderRevision: async (revision) => revision,
    repairRevision: async ({ task, previousRevision }) => {
      repairCalls++;
      assert.equal(task.kind, 'visual-fidelity-repair');
      assert.equal(previousRevision.id, 'rev-0');
      return { id: 'rev-1', screenshot: good, artifact: 'rev-1.png' };
    },
  });

  assert.equal(result.status, 'passed');
  assert.equal(repairCalls, 1);
  assert.equal(result.bestRevision.id, 'rev-1');
  assert.ok(result.bestSimilarity > 0.999);
  assert.equal(result.history.length, 2);
});

test('repair loop stops on non-improving revisions and retains the best known render', async () => {
  const reference = await shot('black');
  const bad = await shot('gray');
  const worse = await shot('white');
  let repairCalls = 0;

  const result = await runVisualRepairLoop({
    routeId: 'route-home',
    referencePng: reference,
    threshold: 0.999,
    maxIterations: 3,
    initialRevision: { id: 'rev-0', screenshot: bad, artifact: 'rev-0.png' },
    renderRevision: async (revision) => revision,
    repairRevision: async () => {
      repairCalls++;
      return { id: `rev-${repairCalls}`, screenshot: worse, artifact: `rev-${repairCalls}.png` };
    },
  });

  assert.equal(result.status, 'stalled');
  assert.equal(repairCalls, 1);
  assert.equal(result.bestRevision.id, 'rev-0');
  assert.equal(result.history.length, 2);
  assert.ok(result.history[1].similarity < result.history[0].similarity);
});


test('repair loop exposes each generated repair task to an observer before execution', async () => {
  const reference = await shot('black');
  const bad = await shot('gray');
  const good = await shot('black');
  const observed = [];

  const result = await runVisualRepairLoop({
    routeId: 'route-home',
    referencePng: reference,
    threshold: 0.99,
    maxIterations: 2,
    initialRevision: { id: 'rev-0', screenshot: bad, artifact: 'rev-0.png' },
    renderRevision: async (revision) => revision,
    onRepairTask: async ({ task, iteration, previousRevision, history }) => {
      observed.push({ task, iteration, previousRevision, historyLength: history.length });
    },
    repairRevision: async () => ({ id: 'rev-1', screenshot: good, artifact: 'rev-1.png' }),
  });

  assert.equal(result.status, 'passed');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].task.kind, 'visual-fidelity-repair');
  assert.equal(observed[0].iteration, 1);
  assert.equal(observed[0].previousRevision.id, 'rev-0');
  assert.equal(observed[0].historyLength, 1);
});


test('repair loop restores the best revision when a repair makes the render worse', async () => {
  const reference = await shot('black');
  const bad = await shot('gray');
  const worse = await shot('white');
  const restored = [];

  const result = await runVisualRepairLoop({
    routeId: 'route-home',
    referencePng: reference,
    threshold: 0.999,
    maxIterations: 2,
    initialRevision: { id: 'rev-0', screenshot: bad, artifact: 'rev-0.png' },
    renderRevision: async (revision) => revision,
    repairRevision: async () => ({ id: 'rev-1', screenshot: worse, artifact: 'rev-1.png' }),
    restoreRevision: async (revision) => restored.push(revision.id),
  });

  assert.equal(result.status, 'stalled');
  assert.equal(result.bestRevision.id, 'rev-0');
  assert.deepEqual(restored, ['rev-0']);
});
