import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createSourceBaselineIdentity,
  interactionInventorySignature,
  isReusableSourceBaselineEvidence,
  loadFrozenSourceInteractionBaseline,
  loadSourceInteractionBaseline,
  sourceInteractionBaselinePath,
  writeSourceInteractionBaseline,
} from '../scripts/lib/source-interaction-baseline.mjs';

const controls = [
  {
    fingerprint: 'sign-in', occurrence: 0, classification: 'opens-panel',
    text: 'Sign In', ariaLabel: '', href: '', disabled: false,
  },
];

test('a captured source baseline is reused only for the exact source inventory and audit contract', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-source-baseline-'));
  const baselinePath = path.join(directory, 'baseline.json');
  const identity = createSourceBaselineIdentity({
    sourceOrigin: 'https://example.test',
    route: '/account',
    viewport: 'desktop',
    contractVersion: 'trusted-click-v1',
    selection: 'all',
    inventorySignature: interactionInventorySignature(controls),
  });
  await writeSourceInteractionBaseline(baselinePath, {
    identity,
    controls: [{ ...controls[0], effect: { effectType: 'drawer' } }],
    diagnostics: { bodyTextLength: 100 },
  });

  const reused = await loadSourceInteractionBaseline(baselinePath, identity);
  assert.equal(reused.controls[0].effect.effectType, 'drawer');

  const changedInventory = createSourceBaselineIdentity({
    ...identity,
    inventorySignature: interactionInventorySignature([{ ...controls[0], text: 'Account' }]),
  });
  assert.equal(await loadSourceInteractionBaseline(baselinePath, changedInventory), null);

  const changedContract = createSourceBaselineIdentity({ ...identity, contractVersion: 'trusted-click-v2' });
  assert.equal(await loadSourceInteractionBaseline(baselinePath, changedContract), null);
  await fs.rm(directory, { recursive: true, force: true });
});

test('targeted source evidence cannot be reused as a full-route baseline', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-source-baseline-'));
  const baselinePath = path.join(directory, 'baseline.json');
  const base = {
    sourceOrigin: 'https://example.test', route: '/', viewport: 'desktop',
    contractVersion: 'trusted-click-v1', inventorySignature: interactionInventorySignature(controls),
  };
  const targeted = createSourceBaselineIdentity({ ...base, selection: 'sign-in' });
  await writeSourceInteractionBaseline(baselinePath, {
    identity: targeted,
    controls: [{ ...controls[0], effect: { effectType: 'drawer' } }],
    diagnostics: {},
  });
  const fullRoute = createSourceBaselineIdentity({ ...base, selection: 'all' });
  assert.equal(await loadSourceInteractionBaseline(baselinePath, fullRoute), null);
  await fs.rm(directory, { recursive: true, force: true });
});

test('source baseline writes are atomic and leave no temporary files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-source-baseline-'));
  const baselinePath = path.join(directory, 'baseline.json');
  const identity = createSourceBaselineIdentity({
    sourceOrigin: 'https://example.test', route: '/', viewport: 'mobile',
    contractVersion: 'trusted-click-v1', selection: 'all',
    inventorySignature: interactionInventorySignature(controls),
  });
  await writeSourceInteractionBaseline(baselinePath, { identity, controls: [], diagnostics: {} });
  assert.deepEqual(await fs.readdir(directory), ['baseline.json']);
  await fs.rm(directory, { recursive: true, force: true });
});

test('source baseline locator is stable per route and targeted selection', () => {
  const first = sourceInteractionBaselinePath('C:/audit', {
    sourceOrigin: 'https://example.test', route: '/dining?sort=new', viewport: 'desktop', selection: 'all',
  });
  const repeated = sourceInteractionBaselinePath('C:/audit', {
    sourceOrigin: 'https://example.test', route: '/dining?sort=new', viewport: 'desktop', selection: 'all',
  });
  const targeted = sourceInteractionBaselinePath('C:/audit', {
    sourceOrigin: 'https://example.test', route: '/dining?sort=new', viewport: 'desktop', selection: 'menu',
  });
  assert.equal(first, repeated);
  assert.notEqual(first, targeted);
});

test('source evidence containing click errors is never cached as a standard answer', () => {
  assert.equal(isReusableSourceBaselineEvidence([
    { fingerprint: 'ok', effect: { effectType: 'drawer' } },
  ]), true);
  assert.equal(isReusableSourceBaselineEvidence([
    { fingerprint: 'broken', effect: { effectType: 'error', error: 'timeout' } },
  ]), false);
});

test('a sealed source standard answer can be reused without revisiting the live source', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-source-baseline-'));
  const baselinePath = path.join(directory, 'baseline.json');
  const identity = createSourceBaselineIdentity({
    sourceOrigin: 'https://example.test', route: '/dining', viewport: 'desktop',
    contractVersion: 'trusted-click-v1', selection: 'all',
    inventorySignature: interactionInventorySignature(controls),
  });
  await writeSourceInteractionBaseline(baselinePath, {
    identity,
    controls: [{ ...controls[0], effect: { effectType: 'drawer' } }],
    diagnostics: { bodyTextLength: 100 },
  });
  const frozen = await loadFrozenSourceInteractionBaseline(baselinePath, {
    sourceOrigin: 'https://example.test', route: '/dining', viewport: 'desktop',
    contractVersion: 'trusted-click-v1', selection: 'all',
  });
  assert.equal(frozen.controls[0].effect.effectType, 'drawer');
  assert.equal(await loadFrozenSourceInteractionBaseline(baselinePath, {
    sourceOrigin: 'https://example.test', route: '/dining', viewport: 'mobile',
    contractVersion: 'trusted-click-v1', selection: 'all',
  }), null);
  await fs.rm(directory, { recursive: true, force: true });
});
