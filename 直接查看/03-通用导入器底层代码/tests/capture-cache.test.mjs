import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_CONTRACT_VERSION,
  isReusableCaptureMetadata,
} from '../scripts/lib/capture-cache.mjs';

const expected = {
  route: '/collections/parquetry-collection',
  sourceUrl: 'https://www.cocorepublic.com.au/collections/parquetry-collection',
};
const completeReadiness = { failedStylesheets: 0, uncapturedStylesheets: 0, horizontalOverflowPx: 0 };

test('resume accepts only metadata produced by the current capture contract', () => {
  const metadata = {
    ...expected,
    capturedAt: '2026-11-04T06:00:00.000Z',
    captureContractVersion: CAPTURE_CONTRACT_VERSION,
    metadata: { visualReadiness: completeReadiness },
    interactiveElements: [],
    links: [],
  };
  assert.equal(isReusableCaptureMetadata(metadata, { ...expected, now: Date.parse('2026-11-04T06:10:00.000Z') }), true);
  assert.equal(isReusableCaptureMetadata({ ...metadata, captureContractVersion: 'rendered-golden-v1' }, expected), false);
  assert.equal(isReusableCaptureMetadata({ ...metadata, captureContractVersion: undefined }, expected), false);
  assert.equal(isReusableCaptureMetadata(
    { ...metadata, metadata: { visualReadiness: {} } },
    { ...expected, now: Date.parse('2026-11-04T06:10:00.000Z') },
  ), false);
  assert.equal(isReusableCaptureMetadata(
    { ...metadata, metadata: { visualReadiness: { ...completeReadiness, horizontalOverflowPx: 100 } } },
    { ...expected, now: Date.parse('2026-11-04T06:10:00.000Z') },
  ), false);
});

test('resume rejects cache entries belonging to another route or source URL', () => {
  const metadata = {
    ...expected,
    capturedAt: '2026-11-04T06:00:00.000Z',
    captureContractVersion: CAPTURE_CONTRACT_VERSION,
    metadata: { visualReadiness: completeReadiness },
    interactiveElements: [],
    links: [],
  };
  assert.equal(isReusableCaptureMetadata({ ...metadata, route: '/wrong' }, expected), false);
  assert.equal(isReusableCaptureMetadata({ ...metadata, sourceUrl: 'https://example.com/wrong' }, expected), false);
});

test('resume rejects a verified capture after the bounded retry window expires', () => {
  const metadata = {
    ...expected,
    capturedAt: '2026-11-04T06:00:00.000Z',
    captureContractVersion: CAPTURE_CONTRACT_VERSION,
    metadata: { visualReadiness: completeReadiness },
    interactiveElements: [],
    links: [],
  };
  assert.equal(isReusableCaptureMetadata(metadata, {
    ...expected,
    now: Date.parse('2026-11-04T06:31:00.000Z'),
    maxAgeMs: 30 * 60 * 1000,
  }), false);
});

test('resume accepts an older capture only when both sealed content hashes match', () => {
  const metadata = {
    ...expected,
    capturedAt: '2026-11-04T06:00:00.000Z',
    captureContractVersion: CAPTURE_CONTRACT_VERSION,
    metadata: { visualReadiness: completeReadiness },
    interactiveElements: [],
    links: [],
    contentHashes: {
      replaySha256: 'replay-hash',
      screenshotSha256: 'screenshot-hash',
    },
  };
  const options = {
    ...expected,
    now: Date.parse('2026-11-05T06:00:00.000Z'),
    replaySha256: 'replay-hash',
    screenshotSha256: 'screenshot-hash',
  };
  assert.equal(isReusableCaptureMetadata(metadata, options), true);
  assert.equal(isReusableCaptureMetadata(metadata, { ...options, replaySha256: 'changed' }), false);
  assert.equal(isReusableCaptureMetadata(metadata, { ...options, screenshotSha256: 'changed' }), false);
});

test('sealed capture remains reusable after a same-origin canonical redirect', () => {
  const metadata = {
    ...expected,
    sourceUrl: 'https://www.cocorepublic.com.au/collections/',
    capturedAt: '2026-11-04T06:00:00.000Z',
    captureContractVersion: CAPTURE_CONTRACT_VERSION,
    metadata: { visualReadiness: completeReadiness },
    interactiveElements: [],
    links: [],
    contentHashes: { replaySha256: 'a', screenshotSha256: 'b' },
  };
  assert.equal(isReusableCaptureMetadata(metadata, {
    ...expected,
    now: Date.parse('2026-11-05T06:00:00.000Z'),
    replaySha256: 'a',
    screenshotSha256: 'b',
  }), true);
});
