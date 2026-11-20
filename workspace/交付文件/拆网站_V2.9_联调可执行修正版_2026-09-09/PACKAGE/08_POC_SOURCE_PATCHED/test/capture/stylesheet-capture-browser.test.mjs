import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { captureHtml, capturePage } from '../../src/capture/chromium-capture.mjs';

const chromePath = process.env.MATBOX_CHROMIUM_PATH;

test('browser capture freezes a loaded stylesheet and reports it as captured', { skip: !chromePath }, async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/theme.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end('body{background:rgb(1,2,3)} .ready{width:240px}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html><head><link rel="stylesheet" href="/theme.css"></head><body><main class="ready">${Array.from({ length: 10 }, (_, index) => `<a href="#${index}">Link ${index}</a>`).join('')}</main></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const result = await capturePage(`http://127.0.0.1:${address.port}/`, {
    chromiumPath: chromePath,
    timeoutMs: 15000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.externalStylesheetCount, 1);
  assert.equal(result.metadata.visualReadiness.capturedStylesheets, 1);
  assert.equal(result.metadata.visualReadiness.failedStylesheets, 0);
  assert.equal(result.metadata.visualReadiness.uncapturedStylesheets, 0);
  assert.match(result.renderedDocument.html, /(?:data:text\/css;base64|data-matbox-frozen-stylesheet)/);
});

test('browser capture reports an HTTP-error stylesheet as failed and uncaptured', { skip: !chromePath }, async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/missing.css') {
      response.writeHead(503, { 'content-type': 'text/css' });
      response.end('service unavailable');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><head><link rel="stylesheet" href="/missing.css"></head><body><main>Unstyled</main></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const result = await capturePage(`http://127.0.0.1:${address.port}/`, {
    chromiumPath: chromePath,
    timeoutMs: 15000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.externalStylesheetCount, 1);
  assert.equal(result.metadata.visualReadiness.capturedStylesheets, 0);
  assert.equal(result.metadata.visualReadiness.failedStylesheets, 1);
  assert.equal(result.metadata.visualReadiness.uncapturedStylesheets, 1);
});

test('static HTML capture emits explicit zero stylesheet failures for cache eligibility', { skip: !chromePath }, async () => {
  const result = await captureHtml('<!doctype html><html><head><style>body{color:black}</style></head><body>Ready</body></html>', {
    chromiumPath: chromePath,
    timeoutMs: 15000,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.failedStylesheets, 0);
  assert.equal(result.metadata.visualReadiness.uncapturedStylesheets, 0);
});
