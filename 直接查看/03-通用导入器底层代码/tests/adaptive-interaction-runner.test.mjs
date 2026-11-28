import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdaptiveInteractionRunner } from '../scripts/lib/adaptive-interaction-runner.mjs';

test('reversible controls reuse the page only after exact state restoration', async () => {
  const resets = [];
  const runner = createAdaptiveInteractionRunner({
    reset: async (kind) => resets.push(kind),
    execute: async (control) => ({ effectType: control.effectType }),
    restore: async () => true,
  });

  const first = await runner.run({ classification: 'safe-click', effectType: 'modal' });
  const second = await runner.run({ classification: 'safe-click', effectType: 'no-op' });

  assert.deepEqual(resets, ['reload']);
  assert.equal(first.isolation, 'verified-restore');
  assert.equal(first.restored, true);
  assert.equal(second.resetApplied, 'none');
});

test('failed restoration forces a reload before the next control', async () => {
  const resets = [];
  const runner = createAdaptiveInteractionRunner({
    reset: async (kind) => resets.push(kind),
    execute: async (control) => ({ effectType: control.effectType }),
    restore: async () => false,
  });

  await runner.run({ classification: 'safe-click', effectType: 'drawer' });
  const second = await runner.run({ classification: 'safe-click', effectType: 'no-op' });

  assert.deepEqual(resets, ['reload', 'reload']);
  assert.equal(second.resetApplied, 'reload');
});

test('an already inventoried page executes its first control without another reload', async () => {
  const resets = [];
  const runner = createAdaptiveInteractionRunner({
    pageReady: true,
    reset: async (kind) => resets.push(kind),
    execute: async () => ({ effectType: 'no-op' }),
    restore: async () => true,
  });

  const result = await runner.run({ classification: 'safe-click' });
  assert.equal(result.resetApplied, 'none');
  assert.deepEqual(resets, []);
});

test('navigation attempts history restoration before falling back to a new page', async () => {
  const resets = [];
  const effects = [
    { effectType: 'navigation' },
    { effectType: 'no-op', storageChanged: true },
  ];
  const runner = createAdaptiveInteractionRunner({
    reset: async (kind) => resets.push(kind),
    execute: async () => effects.shift(),
    restore: async () => false,
  });

  const navigation = await runner.run({ classification: 'navigation' });
  const storage = await runner.run({ classification: 'safe-click' });

  assert.equal(navigation.isolation, 'history-restore');
  assert.equal(storage.resetApplied, 'new-page');
  assert.equal(storage.isolation, 'new-context');
  assert.deepEqual(resets, ['reload', 'new-page']);
});
