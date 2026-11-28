import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeRecoveryAssetMap,
  createStylesheetRecoveryPlan,
  extractExternalStylesheets,
  isRecentProtectedResource,
  mergeRecoveryLedger,
  recoveryStatusForPage,
  shouldQueueRecoveryPage,
} from '../scripts/lib/stylesheet-recovery.mjs';

test('recovery asset maps retain verified shared images and fonts while adding page stylesheets', () => {
  const page = { stylesheets: ['https://cdn.test/theme.css'] };
  const shared = {
    'https://cdn.test/hero.jpg': { file: 'verified/hero.jpg', mime: 'image/jpeg' },
    'https://cdn.test/icons.woff': { file: 'verified/icons.woff', mime: 'font/woff' },
  };
  const result = composeRecoveryAssetMap(page, new Map([
    ['https://cdn.test/theme.css', { status: 'recovered', file: 'verified/theme.css' }],
  ]), shared);
  assert.deepEqual(result, {
    ...shared,
    'https://cdn.test/theme.css': { file: 'verified/theme.css', mime: 'text/css' },
  });
});

test('recovery resumes only unfinished pages unless an exact route was requested', () => {
  assert.equal(shouldQueueRecoveryPage('recovered-and-validated', { routeFilter: false, verifiedAssetMap: true }), false);
  assert.equal(shouldQueueRecoveryPage('source-protected', { routeFilter: false, verifiedAssetMap: true }), true);
  assert.equal(shouldQueueRecoveryPage('source-protected', { routeFilter: false, verifiedAssetMap: false, retryProtected: false }), false);
  assert.equal(shouldQueueRecoveryPage('source-protected', { routeFilter: true, verifiedAssetMap: false, retryProtected: false }), true);
});

test('stylesheet recovery extracts and resolves only external stylesheet links', () => {
  const html = `
    <link rel="stylesheet" href="/assets/theme.css">
    <link rel="preload" href="/assets/ignored.css">
    <link rel="stylesheet" href="data:text/css,body{}">
    <link rel="stylesheet alternate" href="//cdn.example.test/print.css">
  `;
  assert.deepEqual(extractExternalStylesheets(html, 'https://shop.example.test/products/one'), [
    'https://shop.example.test/assets/theme.css',
    'https://cdn.example.test/print.css',
  ]);
});

test('recent source protection is reused during the cooldown instead of hammering the source', () => {
  const now = Date.parse('2026-11-18T00:30:00.000Z');
  assert.equal(isRecentProtectedResource({ status: 'source-protected', checkedAt: '2026-11-18T00:00:00.000Z' }, now, 60 * 60 * 1000), true);
  assert.equal(isRecentProtectedResource({ status: 'source-protected', checkedAt: '2026-11-17T22:00:00.000Z' }, now, 60 * 60 * 1000), false);
  assert.equal(isRecentProtectedResource({ status: 'failed', checkedAt: '2026-11-18T00:00:00.000Z' }, now, 60 * 60 * 1000), false);
});

test('stylesheet recovery plan deduplicates shared assets while retaining page dependencies', () => {
  const plan = createStylesheetRecoveryPlan([
    { route: '/', sourceUrl: 'https://shop.example.test/', stylesheets: ['https://cdn.test/shared.css', 'https://cdn.test/home.css'] },
    { route: '/about', sourceUrl: 'https://shop.example.test/about', stylesheets: ['https://cdn.test/shared.css'] },
  ]);
  assert.equal(plan.pages.length, 2);
  assert.deepEqual(plan.resources.map((resource) => [resource.url, resource.routes]), [
    ['https://cdn.test/home.css', ['/']],
    ['https://cdn.test/shared.css', ['/', '/about']],
  ]);
});

test('a page is capturable only after every required stylesheet is valid', () => {
  const page = { stylesheets: ['https://cdn.test/a.css', 'https://cdn.test/b.css'] };
  assert.deepEqual(recoveryStatusForPage(page, new Map([
    ['https://cdn.test/a.css', { status: 'recovered' }],
    ['https://cdn.test/b.css', { status: 'source-protected' }],
  ])), {
    status: 'source-protected',
    unresolved: ['https://cdn.test/b.css'],
  });
  assert.deepEqual(recoveryStatusForPage(page, new Map([
    ['https://cdn.test/a.css', { status: 'recovered' }],
    ['https://cdn.test/b.css', { status: 'recovered' }],
  ])), { status: 'ready', unresolved: [] });
});

test('recovery ledger merge retains unrelated prior pages and replaces current route results', () => {
  const merged = mergeRecoveryLedger({
    resources: { old: { status: 'recovered' } },
    pages: [{ route: '/old', status: 'failed' }, { route: '/same', status: 'failed' }],
  }, {
    resources: { fresh: { status: 'recovered' } },
    pages: [{ route: '/same', status: 'recovered-and-validated' }],
  });
  assert.deepEqual(merged.resources, {
    old: { status: 'recovered' },
    fresh: { status: 'recovered' },
  });
  assert.deepEqual(merged.pages, [
    { route: '/old', status: 'failed' },
    { route: '/same', status: 'recovered-and-validated' },
  ]);
});

test('desktop and mobile recovery results remain separate for the same route', () => {
  const merged = mergeRecoveryLedger({
    pages: [{ route: '/same', viewport: 'desktop', status: 'recovered-and-validated' }],
  }, {
    pages: [{ route: '/same', viewport: 'mobile', status: 'source-protected' }],
  });
  assert.deepEqual(merged.pages, [
    { route: '/same', viewport: 'desktop', status: 'recovered-and-validated' },
    { route: '/same', viewport: 'mobile', status: 'source-protected' },
  ]);
});
