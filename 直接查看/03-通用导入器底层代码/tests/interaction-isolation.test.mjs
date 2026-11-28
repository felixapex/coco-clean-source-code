import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceInteractionSession,
  createInteractionSession,
  chooseInteractionIsolation,
  interactionStateSignature,
  isInteractionStateRestored,
} from '../scripts/lib/interaction-isolation.mjs';

test('reversible UI effects may reuse a page only through verified restoration', () => {
  for (const effectType of ['modal', 'drawer', 'mega-menu', 'panel', 'accordion', 'tooltip', 'no-op']) {
    assert.equal(
      chooseInteractionIsolation({ control: { classification: 'safe-click' }, effect: { effectType } }),
      'verified-restore',
    );
  }
});

test('same-tab navigation restores history while new-tab navigation reuses the untouched page', () => {
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'navigation' }, effect: { effectType: 'navigation' } }),
    'history-restore',
  );
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'navigation' }, effect: { effectType: 'navigation', target: 'new-tab' } }),
    'verified-restore',
  );
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'safe-click' }, effect: { effectType: 'selection' } }),
    'reload',
  );
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'safe-click' }, effect: { effectType: 'value-change' } }),
    'reload',
  );
});

test('browser storage mutations require a new context and server writes require a rollback fixture', () => {
  assert.equal(
    chooseInteractionIsolation({
      control: { classification: 'safe-click' },
      effect: { effectType: 'drawer', storageChanged: true },
    }),
    'new-context',
  );
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'boundary-only' }, effect: {} }),
    'server-fixture',
  );
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'safe-click' }, effect: { serverMutation: true } }),
    'server-fixture',
  );
});

test('unknown effects fail closed to a new browser context', () => {
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'safe-click' }, effect: { effectType: 'mystery' } }),
    'new-context',
  );
  assert.equal(
    chooseInteractionIsolation({ control: { classification: 'unclassified' }, effect: {} }),
    'new-context',
  );
});

test('restoration signature includes URL, UI state, browser storage, popups, and network mutations', () => {
  const baseline = {
    url: 'https://example.test/dining#top',
    historyLength: 2,
    visiblePanels: 0,
    openDetails: 0,
    selectedState: 'none',
    localStorageDigest: 'local-a',
    sessionStorageDigest: 'session-a',
    cookieDigest: 'cookie-a',
    popupCount: 0,
    mutationRequestCount: 0,
  };
  assert.equal(isInteractionStateRestored(baseline, { ...baseline }), true);
  assert.equal(isInteractionStateRestored(baseline, { ...baseline, localStorageDigest: 'local-b' }), false);
  assert.equal(isInteractionStateRestored(baseline, { ...baseline, popupCount: 1 }), false);
  assert.notEqual(
    interactionStateSignature(baseline),
    interactionStateSignature({ ...baseline, mutationRequestCount: 1 }),
  );
});

test('only a proven reversible restoration allows the next control to reuse the current page', () => {
  const initial = createInteractionSession({ pageReady: true });
  const reused = advanceInteractionSession(initial, {
    isolation: 'verified-restore',
    restored: true,
  });
  assert.equal(reused.pageReady, true);
  assert.equal(reused.nextReset, 'none');

  const failedRestore = advanceInteractionSession(reused, {
    isolation: 'verified-restore',
    restored: false,
  });
  assert.equal(failedRestore.pageReady, false);
  assert.equal(failedRestore.nextReset, 'reload');
});

test('navigation, storage mutation, and server boundaries select distinct next reset actions', () => {
  const current = createInteractionSession({ pageReady: true });
  assert.equal(advanceInteractionSession(current, { isolation: 'history-restore', restored: true }).nextReset, 'none');
  assert.equal(advanceInteractionSession(current, { isolation: 'history-restore', restored: false }).nextReset, 'new-page');
  assert.equal(advanceInteractionSession(current, { isolation: 'new-context' }).nextReset, 'new-context');
  const blocked = advanceInteractionSession(current, { isolation: 'server-fixture' });
  assert.equal(blocked.nextReset, 'server-fixture');
  assert.equal(blocked.pageReady, false);
});
