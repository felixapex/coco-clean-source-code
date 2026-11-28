import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recoveryFailuresFromCaptures, runTargetedRecovery } from '../scripts/lib/targeted-recovery-runner.mjs';

async function ledgerPath(name) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `matbox-recovery-${name}-`));
  return path.join(root, 'ledger.json');
}

test('resource failures invoke only the resource handler', async () => {
  const calls = [];
  const summary = await runTargetedRecovery({
    siteId: 'coco',
    ledgerPath: await ledgerPath('resource'),
    failures: [{ kind: 'resource', route: '/living', resourceUrl: 'https://cdn.example.com/a.jpg', viewport: 'desktop' }],
    handlers: {
      resource: async () => { calls.push('resource'); return { pass: true }; },
      page: async () => { calls.push('page'); return { pass: true }; },
    },
  });
  assert.deepEqual(calls, ['resource']);
  assert.equal(summary.completedCount, 1);
});

test('page failures invoke only the page recapture handler', async () => {
  const calls = [];
  await runTargetedRecovery({
    siteId: 'coco',
    ledgerPath: await ledgerPath('page'),
    failures: [{ kind: 'page', route: '/living', viewport: 'desktop' }],
    handlers: {
      resource: async () => { calls.push('resource'); return { pass: true }; },
      page: async () => { calls.push('page'); return { pass: true }; },
    },
  });
  assert.deepEqual(calls, ['page']);
});

test('source-protected pages are deferred without calling a recovery handler', async () => {
  let calls = 0;
  const summary = await runTargetedRecovery({
    siteId: 'coco',
    ledgerPath: await ledgerPath('protected'),
    failures: [{ route: '/contact-us', error: 'source-verification-challenge' }],
    handlers: { page: async () => { calls += 1; return { pass: true }; } },
  });
  assert.equal(calls, 0);
  assert.equal(summary.sourceProtectedCount, 1);
  assert.equal(summary.pass, false);
});

test('one recovered resource wakes every dependent page that referenced it', async () => {
  let calls = 0;
  const summary = await runTargetedRecovery({
    siteId: 'coco',
    ledgerPath: await ledgerPath('dependents'),
    failures: [
      { kind: 'resource', route: '/a', resourceUrl: 'https://cdn.example.com/shared.jpg', viewport: 'desktop' },
      { kind: 'resource', route: '/b', resourceUrl: 'https://cdn.example.com/shared.jpg', viewport: 'desktop' },
    ],
    handlers: { resource: async (entry, context) => { calls += 1; assert.equal(context.dependents.length, 2); return { pass: true }; } },
  });
  assert.equal(calls, 1);
  assert.equal(summary.completedCount, 2);
});

test('network retry waves reduce concurrency after a failure', async () => {
  const workers = [];
  const summary = await runTargetedRecovery({
    siteId: 'coco',
    ledgerPath: await ledgerPath('network'),
    failures: [{ kind: 'network', route: '/living', viewport: 'desktop' }],
    initialWorkers: 4,
    maxRetryWaves: 2,
    handlers: {
      network: async (entry, context) => {
        workers.push(context.workerCount);
        return { pass: context.attempt === 2, error: context.attempt === 1 ? 'reset' : null };
      },
    },
  });
  assert.deepEqual(workers, [4, 2]);
  assert.equal(summary.completedCount, 1);
});

test('a resumed run does not repeat a task already completed in the ledger', async () => {
  const target = await ledgerPath('resume');
  let calls = 0;
  const input = {
    siteId: 'coco',
    ledgerPath: target,
    failures: [{ kind: 'page', route: '/living', viewport: 'desktop' }],
    handlers: { page: async () => { calls += 1; return { pass: true }; } },
  };
  await runTargetedRecovery(input);
  await runTargetedRecovery(input);
  assert.equal(calls, 1);
});

test('capture integration records failed resources and protected pages without adding successful captures', () => {
  const failures = recoveryFailuresFromCaptures([
    { key: 'desktop:/ok', ok: true },
    { key: 'desktop:/image', ok: false, error: 'failed-images details={"failed":[{"src":"https://cdn.example.com/a.jpg"}]}' },
    { key: 'desktop:/contact-us', ok: false, error: 'source-verification-challenge' },
  ]);
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map(({ kind, route, viewport }) => ({ kind, route, viewport })), [
    { kind: 'resource', route: '/image', viewport: 'desktop' },
    { kind: 'source-protected', route: '/contact-us', viewport: 'desktop' },
  ]);
  assert.equal(failures[0].resourceUrl, 'https://cdn.example.com/a.jpg');
});
