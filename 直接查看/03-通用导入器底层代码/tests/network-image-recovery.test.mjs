import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyImageFetchFailure,
  cloudinaryImageUrl,
  createHostCircuit,
  fetchImageWithFallback,
  imageFetchCandidates,
  imageProxyUrl,
  isImageResponse,
  shouldTryNextCandidate,
} from '../scripts/lib/network-image-recovery.mjs';

test('plain SVG image responses are accepted as images', () => {
  const buffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>');
  assert.equal(isImageResponse({ contentType: 'image/svg+xml', buffer }), true);
});

test('SVG responses with an XML declaration and generator comment are accepted as images', () => {
  const buffer = Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator metadata -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.equal(isImageResponse({ contentType: 'image/svg+xml', buffer }), true);
});

test('three matching network failures open the host circuit', () => {
  const circuit = createHostCircuit({ consecutiveNetworkLimit: 3 });
  assert.equal(circuit.record({ ok: false, classification: { kind: 'network', signature: 'connection-reset' } }).open, false);
  assert.equal(circuit.record({ ok: false, classification: { kind: 'network', signature: 'connection-reset' } }).open, false);
  const result = circuit.record({ ok: false, classification: { kind: 'network', signature: 'connection-reset' } });
  assert.equal(result.open, true);
  assert.equal(result.reason, 'network:connection-reset');
});

test('image proxy URL preserves the complete original source as one query value', () => {
  const source = 'https://cdn11.bigcommerce.com/store/image.jpg?c=1&x=2';
  const proxy = imageProxyUrl(source);
  assert.equal(new URL(proxy).hostname, 'images.weserv.nl');
  assert.equal(new URL(proxy).searchParams.get('url'), source);
});

test('Cloudinary fetch URL appends the original URL without losing its query', () => {
  const source = 'https://cdn11.bigcommerce.com/store/image.jpg?c=1&x=2';
  const proxy = cloudinaryImageUrl(source);
  assert.equal(proxy, `https://res.cloudinary.com/demo/image/fetch/${source}`);
});

test('HTTP 404 is a missing source rather than an infrastructure failure', () => {
  assert.deepEqual(classifyImageFetchFailure({ status: 404 }), { kind: 'source', signature: 'http-404', status: 404 });
  const circuit = createHostCircuit({ consecutiveNetworkLimit: 3 });
  for (let index = 0; index < 4; index += 1) circuit.record({ ok: false, classification: classifyImageFetchFailure({ status: 404 }) });
  assert.equal(circuit.snapshot().open, false);
});

test('a successful canary resets consecutive network failures', () => {
  const circuit = createHostCircuit({ consecutiveNetworkLimit: 3 });
  circuit.record({ ok: false, classification: { kind: 'network', signature: 'timeout' } });
  circuit.record({ ok: false, classification: { kind: 'network', signature: 'timeout' } });
  circuit.record({ ok: true });
  const result = circuit.record({ ok: false, classification: { kind: 'network', signature: 'timeout' } });
  assert.equal(result.open, false);
  assert.equal(result.consecutiveNetworkFailures, 1);
});

test('BigCommerce size fallbacks exist but are attempted only after 404', () => {
  const source = 'https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/1/2/test.jpg?c=1';
  const candidates = imageFetchCandidates(source);
  assert.equal(candidates[0], source);
  assert.ok(candidates.some((candidate) => candidate.includes('/images/stencil/original/products/')));
  assert.equal(shouldTryNextCandidate(classifyImageFetchFailure({ status: 404 })), true);
  assert.equal(shouldTryNextCandidate(classifyImageFetchFailure(new Error('fetch failed: ECONNRESET'))), false);
});

test('network errors and invalid image bodies are classified separately', () => {
  assert.equal(classifyImageFetchFailure(new Error('fetch failed: ECONNRESET')).kind, 'network');
  assert.equal(classifyImageFetchFailure(Object.assign(new Error('aborted'), { name: 'AbortError' })).signature, 'timeout');
  assert.equal(classifyImageFetchFailure(new Error('invalid image response')).kind, 'content');
});

test('fetch stops after a network failure and does not fan out through fallbacks', async () => {
  const calls = [];
  const result = await fetchImageWithFallback('https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/1/2/test.jpg', {
    fetchImpl: async (url) => {
      calls.push(url);
      throw new Error('fetch failed: ECONNRESET');
    },
    timeoutMs: 50,
  });
  assert.equal(result.ok, false);
  assert.equal(result.classification.kind, 'network');
  assert.equal(calls.length, 1);
});

test('a network failure uses the verified system transport before opening the host circuit', async () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const systemCalls = [];
  const result = await fetchImageWithFallback('https://cdn11.bigcommerce.com/store/image.png', {
    fetchImpl: async () => {
      throw new Error('fetch failed: ECONNRESET');
    },
    networkFallbackImpl: async (url) => {
      systemCalls.push(url);
      return { ok: true, status: 200, contentType: 'image/png', buffer: png };
    },
    timeoutMs: 50,
  });

  assert.equal(result.ok, true);
  assert.equal(result.buffer.equals(png), true);
  assert.equal(result.transport, 'system');
  assert.equal(systemCalls.length, 1);
  assert.equal(result.attempts.some((attempt) => attempt.transport === 'system' && attempt.ok), true);
});

test('the system transport cannot turn non-image bytes into a successful recovery', async () => {
  const result = await fetchImageWithFallback('https://cdn11.bigcommerce.com/store/image.png', {
    fetchImpl: async () => {
      throw new Error('fetch failed: ECONNRESET');
    },
    networkFallbackImpl: async () => ({
      ok: true,
      status: 200,
      contentType: 'text/html',
      buffer: Buffer.from('<html>blocked</html>'),
    }),
    timeoutMs: 50,
  });

  assert.equal(result.ok, false);
  assert.equal(result.classification.kind, 'content');
});

test('a system-transport 404 advances to the next BigCommerce size candidate', async () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const systemCalls = [];
  const result = await fetchImageWithFallback('https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/1/2/test.webp', {
    fetchImpl: async () => {
      throw new Error('fetch failed: ECONNRESET');
    },
    networkFallbackImpl: async (url) => {
      systemCalls.push(url);
      if (systemCalls.length === 1) return { ok: false, status: 404, error: 'not found' };
      return { ok: true, status: 200, contentType: 'image/png', buffer: png };
    },
    timeoutMs: 50,
  });

  assert.equal(result.ok, true);
  assert.equal(result.buffer.equals(png), true);
  assert.equal(systemCalls.length, 2);
  assert.match(systemCalls[1], /\/images\/stencil\/original\/products\//);
});

test('fetch tries a BigCommerce fallback after 404 and accepts verified image bytes', async () => {
  const calls = [];
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const result = await fetchImageWithFallback('https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/1/2/test.jpg', {
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return new Response('', { status: 404 });
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    },
    timeoutMs: 50,
  });
  assert.equal(result.ok, true);
  assert.equal(result.buffer.equals(png), true);
  assert.equal(calls.length, 2);
});
