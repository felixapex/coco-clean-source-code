import test from 'node:test';
import assert from 'node:assert/strict';
import * as browserBinaryFetch from '../scripts/lib/browser-binary-fetch.mjs';

const { assertBinaryPrefix, assertExpectedContent, assertSafeBrowserPath, assertSuccessfulResponse, decodeCdpBody, decodeRuntimeFetchPayload, selectBinaryResponseCandidate } = browserBinaryFetch;

test('browser binary fetch refuses Microsoft Edge', () => {
  assert.throws(
    () => assertSafeBrowserPath('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'),
    /Microsoft Edge automation is disabled/,
  );
});

test('browser binary fetch validates the expected binary prefix', () => {
  assert.doesNotThrow(() => assertBinaryPrefix(Buffer.from('%PDF-1.7\n'), '%PDF-'));
  assert.throws(() => assertBinaryPrefix(Buffer.from('<html>blocked</html>'), '%PDF-'), /Unexpected binary prefix/);
});

test('browser binary fetch prefers a PDF response over the top-level HTML document', () => {
  const selected = selectBinaryResponseCandidate([
    { requestId: 'html', url: 'https://example.test/report.pdf', mimeType: 'text/html', status: 200, type: 'Document' },
    { requestId: 'pdf', url: 'https://example.test/report.pdf', mimeType: 'application/pdf', status: 200, type: 'Other' },
  ], 'https://example.test/report.pdf');
  assert.equal(selected.requestId, 'pdf');
});

test('browser binary fetch falls back to a completed network response when interception body reading races', () => {
  assert.equal(typeof browserBinaryFetch.resolveBinaryResponseCandidate, 'function');
  const interceptionRace = new Error('No resource with given identifier found');
  const selected = browserBinaryFetch.resolveBinaryResponseCandidate([
    { requestId: 'network-response', url: 'https://example.test/help.html', mimeType: 'text/html', status: 200, type: 'Document' },
  ], 'https://example.test/help.html', interceptionRace);
  assert.equal(selected.requestId, 'network-response');
});

test('browser binary fetch decodes intercepted base64 response bytes', () => {
  assert.deepEqual(decodeCdpBody({ body: Buffer.from('%PDF-1.7').toString('base64'), base64Encoded: true }), Buffer.from('%PDF-1.7'));
});

test('stylesheet recovery rejects an HTML challenge even when saved with a css filename', () => {
  assert.doesNotThrow(() => assertExpectedContent(Buffer.from('body{color:black}'), 'text/css', 'text/css'));
  assert.throws(
    () => assertExpectedContent(Buffer.from('<!doctype html><title>Just a moment...</title>'), 'text/html', 'text/css'),
    /Expected content type text\/css/,
  );
  assert.throws(
    () => assertExpectedContent(Buffer.from('<!doctype html><title>Just a moment...</title>'), 'text/css', 'text/css'),
    /verification challenge|HTML instead of CSS/,
  );
});

test('same-origin browser fetch payload preserves bytes and response metadata', () => {
  const decoded = decodeRuntimeFetchPayload({
    ok: true,
    status: 200,
    url: 'https://example.test/theme.css',
    contentType: 'text/css; charset=utf-8',
    bodyBase64: Buffer.from('body{color:black}').toString('base64'),
  });
  assert.equal(decoded.buffer.toString(), 'body{color:black}');
  assert.equal(decoded.status, 200);
  assert.equal(decoded.mimeType, 'text/css; charset=utf-8');
  assert.throws(() => decodeRuntimeFetchPayload({ ok: false, status: 403, url: 'https://example.test/theme.css' }), /Browser fetch failed: 403/);
});

test('binary fetch rejects non-success HTTP responses before saving bytes', () => {
  assert.doesNotThrow(() => assertSuccessfulResponse(200, 'https://example.test/image.jpg'));
  assert.doesNotThrow(() => assertSuccessfulResponse(206, 'https://example.test/video.mp4'));
  assert.throws(() => assertSuccessfulResponse(403, 'https://example.test/image.jpg'), /HTTP 403/);
  assert.throws(() => assertSuccessfulResponse(null, 'https://example.test/image.jpg'), /missing HTTP status/);
});
