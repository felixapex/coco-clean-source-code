import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareInteractionInventories,
  createInteractionIdentity,
  evaluateInteractionConsensusRounds,
  evaluateInteractionStabilityRounds,
  summarizeInteractionInventory,
} from '../../src/capture/interaction-stability.mjs';

const visible = (overrides = {}) => ({
  tag: 'button',
  id: null,
  role: null,
  ownerId: null,
  text: 'Add to cart',
  href: null,
  ariaLabel: null,
  ariaControls: null,
  inputType: null,
  renderVisible: true,
  bbox: { width: 120, height: 40 },
  display: 'block',
  visibility: 'visible',
  ...overrides,
});

test('interaction inventory separates rendered controls from latent drawer controls', () => {
  const summary = summarizeInteractionInventory([
    visible(),
    visible({ text: 'Hidden login', renderVisible: false, bbox: { width: 0, height: 0 } }),
  ]);
  assert.equal(summary.totalCount, 2);
  assert.equal(summary.visibleCount, 1);
  assert.equal(summary.latentCount, 1);
  assert.equal(summary.identities.length, 1);
});

test('interaction identity ignores tracking parameters but preserves functional targets', () => {
  const first = createInteractionIdentity(visible({
    tag: 'a',
    text: 'View product',
    href: 'https://source.test/products/chair?sku=42&utm_source=email',
  }));
  const second = createInteractionIdentity(visible({
    tag: 'a',
    text: 'View product',
    href: 'https://source.test/products/chair?utm_source=ad&sku=42',
  }));
  assert.equal(first, second);
  assert.match(first, /sku=42/);
});

test('interaction identity keeps a stable control when only its live label changes', () => {
  const cartCount = createInteractionIdentity(visible({
    tag: 'a',
    id: 'nav-preview-cart',
    text: '0',
    href: 'https://source.test/cart.php',
  }));
  const accessibleCart = createInteractionIdentity(visible({
    tag: 'a',
    id: 'nav-preview-cart',
    text: 'Cart with 0 items',
    href: 'https://source.test/cart.php',
  }));
  assert.equal(cartCount, accessibleCart);
});

test('interaction identity treats the same navigation target as one action even when its label changes', () => {
  const imageLink = createInteractionIdentity(visible({
    tag: 'a',
    text: '',
    href: 'https://source.test/collections/chairs',
  }));
  const textLink = createInteractionIdentity(visible({
    tag: 'a',
    text: 'Chairs',
    href: 'https://source.test/collections/chairs',
  }));
  assert.equal(imageLink, textLink);
});

test('stability comparison detects missing and additional visible controls including duplicates', () => {
  const baseline = summarizeInteractionInventory([visible(), visible()]);
  const current = summarizeInteractionInventory([visible(), visible({ text: 'Buy now' })]);
  const comparison = compareInteractionInventories(baseline, current);
  assert.equal(comparison.pass, false);
  assert.equal(comparison.missingCount, 1);
  assert.equal(comparison.addedCount, 1);
});

test('three rounds pass only when every visible interaction identity is stable', () => {
  const stable = summarizeInteractionInventory([visible(), visible({ text: 'Buy now' })]);
  const changed = summarizeInteractionInventory([visible()]);
  assert.equal(evaluateInteractionStabilityRounds([stable, stable, stable]).pass, true);
  const result = evaluateInteractionStabilityRounds([stable, stable, changed]);
  assert.equal(result.pass, false);
  assert.equal(result.comparisons[1].missingCount, 1);
});

test('consensus stability keeps controls present in most rounds and records one-off states', () => {
  const core = visible({ text: 'Add to cart' });
  const transient = visible({ text: 'Seasonal promotion' });
  const rounds = [
    summarizeInteractionInventory([core, transient]),
    summarizeInteractionInventory([core]),
    summarizeInteractionInventory([core]),
  ];
  const result = evaluateInteractionConsensusRounds(rounds);
  assert.equal(result.pass, true);
  assert.equal(result.consensusVisibleCount, 1);
  assert.equal(result.matchingRoundCount, 2);
  assert.equal(result.transientCount, 1);
  assert.equal(result.representativeRound, 2);
});

test('consensus stability fails when fewer than half the rounds share a complete state', () => {
  const rounds = [
    summarizeInteractionInventory([visible({ text: 'One' })]),
    summarizeInteractionInventory([visible({ text: 'Two' })]),
    summarizeInteractionInventory([visible({ text: 'Three' })]),
  ];
  const result = evaluateInteractionConsensusRounds(rounds);
  assert.equal(result.pass, false);
  assert.equal(result.code, 'no-stable-interaction-consensus');
});

test('consensus stability passes when every core control is confirmed twice and one round contains the complete core', () => {
  const one = visible({ text: 'One' });
  const two = visible({ text: 'Two' });
  const three = visible({ text: 'Three' });
  const rounds = [
    summarizeInteractionInventory([one, two]),
    summarizeInteractionInventory([two, three]),
    summarizeInteractionInventory([one, two, three]),
  ];
  const result = evaluateInteractionConsensusRounds(rounds);
  assert.equal(result.pass, true);
  assert.equal(result.consensusVisibleCount, 3);
  assert.equal(result.coveringRoundCount, 1);
  assert.equal(result.representativeRound, 3);
});
