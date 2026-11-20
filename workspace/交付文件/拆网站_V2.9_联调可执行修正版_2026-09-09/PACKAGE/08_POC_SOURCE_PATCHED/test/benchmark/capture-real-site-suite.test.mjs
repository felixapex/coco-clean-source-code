import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureRealSiteSuite } from '../../src/benchmark/capture-real-site-suite.mjs';
import { readCaptureBundle } from '../../src/replay/capture-bundle.mjs';

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

function suite() {
  return {
    version: '1.0',
    sites: [{
      id: 'shop', url: 'https://shop.example.com/',
      authorization: { status: 'owned', attestedBy: 'owner', attestedAt: '2026-08-17T18:00:00Z' },
      capturePolicy: { robots: 'respect', maxPages: 5 },
    }],
  };
}

test('real-site capture writes auditable replay bundle and classifies skipped robots routes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'real-suite-'));
  const pages = new Map([
    ['https://shop.example.com/', { links: ['/products', '/private'], metadata: {}, componentCandidates: [] }],
    ['https://shop.example.com/products', { links: [], metadata: {}, componentCandidates: [] }],
  ]);
  const result = await captureRealSiteSuite({
    suite: suite(), outputRoot: root, resolver,
    fetchRobotsFn: async () => ({ status: 200, fetched: true, url: 'https://shop.example.com/robots.txt', text: 'User-agent: *\nDisallow: /private', sha256: 'robots-hash', redirects: [] }),
    capturePageFn: async (url) => {
      if (!pages.has(url)) throw new Error(`Unexpected capture ${url}`);
      return pages.get(url);
    },
  });

  assert.equal(result.sites[0].status, 'captured');
  assert.equal(result.sites[0].capturedPages, 2);
  assert.equal(result.sites[0].skipped.length, 1);
  assert.equal(result.sites[0].skipped[0].reason, 'robots-disallow');
  const replay = await readCaptureBundle(path.join(root, 'shop'));
  assert.equal(replay.manifest.metadata.authorization.status, 'owned');
  assert.equal(replay.manifest.metadata.robots.sha256, 'robots-hash');
  assert.equal(replay.manifest.metadata.captureOutcome.skipped, 1);
  await fs.access(path.join(root, 'real-site-capture-report.json'));
});

test('real-site capture reports environment policy failure without pretending site was captured', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'real-suite-fail-'));
  const result = await captureRealSiteSuite({
    suite: suite(), outputRoot: root, resolver,
    fetchRobotsFn: async () => ({ status: 404, fetched: false, url: 'https://shop.example.com/robots.txt', text: '', sha256: null, redirects: [] }),
    capturePageFn: async () => { throw new Error('ERR_BLOCKED_BY_ADMINISTRATOR'); },
  });
  assert.equal(result.sites[0].status, 'failed');
  assert.equal(result.sites[0].errors[0].category, 'environment-policy');
  assert.equal(result.sites[0].capturedPages, 0);
});

test('real-site capture persists a DNS failure report when robots lookup itself fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'real-suite-robots-dns-'));
  let pageCaptureCalls = 0;
  const result = await captureRealSiteSuite({
    suite: suite(), outputRoot: root, resolver,
    fetchRobotsFn: async () => { throw new Error('getaddrinfo EAI_AGAIN shop.example.com'); },
    capturePageFn: async () => { pageCaptureCalls++; return { links:[], metadata:{}, componentCandidates:[] }; },
  });
  assert.equal(result.sites[0].status, 'failed');
  assert.equal(pageCaptureCalls, 0);
  assert.equal(result.sites[0].errors[0].category, 'dns');
  assert.equal(result.sites[0].errors[0].phase, 'robots');
  const persisted = JSON.parse(await fs.readFile(path.join(root, 'real-site-capture-report.json'), 'utf8'));
  assert.equal(persisted.sites[0].errors[0].category, 'dns');
});
