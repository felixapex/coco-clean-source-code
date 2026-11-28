import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRecoveryFailure,
  createRecoveryLedger,
  recordRecoveryAttempt,
  pendingRecoveryEntries,
} from '../scripts/lib/targeted-recovery.mjs';

test('verification challenges are source-protected instead of ordinary page failures', () => {
  const result = classifyRecoveryFailure({
    route: '/contact-us',
    error: 'Invalid source capture: source-verification-challenge, interaction-inventory-too-small',
  });
  assert.equal(result.kind, 'source-protected');
  assert.equal(result.signature, 'source-protected:verification-challenge');
});

test('failed image details become a resource failure with the exact source URL', () => {
  const url = 'https://cdn.example.com/products/hero.jpg?c=1';
  const result = classifyRecoveryFailure({
    route: '/collection',
    error: `Invalid source capture: failed-images details=${JSON.stringify({ failed: [{ src: url }] })}`,
  });
  assert.equal(result.kind, 'resource');
  assert.equal(result.resourceUrl, url);
  assert.equal(result.signature, `resource:${url}`);
});

test('connection reset is classified as a retryable network failure', () => {
  const result = classifyRecoveryFailure({ route: '/', error: 'net::ERR_CONNECTION_RESET' });
  assert.equal(result.kind, 'network');
  assert.equal(result.signature, 'network:connection-reset');
});

test('critical navigation image failures remain shared-resource failures', () => {
  const url = 'https://cdn.example.com/menu.jpg';
  const result = classifyRecoveryFailure({
    route: '/',
    error: `Critical image capture failed: ${url}. Page-screenshot fallback is forbidden for navigation imagery`,
  });
  assert.equal(result.kind, 'shared-resource');
  assert.equal(result.resourceUrl, url);
});

test('ledger creates one stable task for duplicate failures', () => {
  const failure = { kind: 'resource', route: '/collection', viewport: 'desktop', resourceUrl: 'https://cdn.example.com/a.jpg', status: 'pending' };
  const ledger = createRecoveryLedger({ siteId: 'coco', entries: [failure, { ...failure }] });
  assert.equal(ledger.siteId, 'coco');
  assert.equal(Object.keys(ledger.entries).length, 1);
  assert.match(Object.keys(ledger.entries)[0], /^coco:resource:desktop:/);
});

test('a completed task cannot be downgraded by a later failed attempt', () => {
  const base = createRecoveryLedger({
    siteId: 'coco',
    entries: [{ kind: 'page', route: '/living', viewport: 'desktop', status: 'completed' }],
  });
  const key = Object.keys(base.entries)[0];
  const updated = recordRecoveryAttempt(base, { key, ok: false, error: 'late worker failure', strategy: 'page-recapture' });
  assert.equal(updated.entries[key].status, 'completed');
  assert.equal(updated.entries[key].attempts.length, 1);
  assert.equal(base.entries[key].attempts.length, 0, 'the input ledger remains immutable');
});

test('interrupted runs resume only unfinished tasks', () => {
  const ledger = createRecoveryLedger({
    siteId: 'coco',
    entries: [
      { kind: 'page', route: '/done', viewport: 'desktop', status: 'completed' },
      { kind: 'network', route: '/retry', viewport: 'desktop', status: 'network-deferred' },
      { kind: 'resource', route: '/image', viewport: 'desktop', resourceUrl: 'https://cdn.example.com/a.jpg', status: 'pending' },
    ],
  });
  assert.deepEqual(pendingRecoveryEntries(ledger).map((entry) => entry.route).sort(), ['/image', '/retry']);
});
