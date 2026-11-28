import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { captureHtml, capturePage } from '../src/import-core/capture/chromium-capture.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('loaded stylesheet links are frozen into self-contained data URLs', async () => {
  const css = encodeURIComponent('body{margin:0;background:rgb(12,34,56)} .box{width:120px;height:80px;background:rgb(230,180,40)}');
  const result = await captureHtml(`<!doctype html><html><head><link rel="stylesheet" href="data:text/css,${css}"></head><body><div class="box"></div></body></html>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 160, height: 100, mobile: false },
  });

  assert.match(result.renderedDocument.html, /<style[^>]+data-matbox-frozen-stylesheet="true"/);
  assert.match(result.renderedDocument.html, /background: rgb\(12, 34, 56\)/);
  assert.doesNotMatch(result.renderedDocument.html, /<link[^>]+rel="stylesheet"/);
});

test('cross-origin stylesheets remain pixel-identical after the source servers stop', async () => {
  const assetServer = http.createServer((request, response) => {
    if (request.url === '/theme.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end('body{margin:0;background:#0c2238}.box{width:120px;height:80px;background:#e6b428 url("./pixel.svg") no-repeat right bottom}');
      return;
    }
    if (request.url === '/pixel.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#ff00aa"/></svg>');
      return;
    }
    response.writeHead(404).end();
  });
  const assetPort = await listen(assetServer);
  const pageServer = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><link rel="stylesheet" href="http://127.0.0.1:${assetPort}/theme.css"><div class="box"></div>`);
  });
  const pagePort = await listen(pageServer);

  let source;
  try {
    source = await capturePage(`http://127.0.0.1:${pagePort}/`, {
      chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      timeoutMs: 30000,
      requestGuard: false,
      allowNetwork: true,
      viewport: { width: 160, height: 100, mobile: false },
    });
  } finally {
    await Promise.all([close(pageServer), close(assetServer)]);
  }

  assert.match(source.renderedDocument.html, /href="data:text\/css;base64,/);
  assert.doesNotMatch(source.renderedDocument.html, /127\.0\.0\.1:\d+\/theme\.css/);
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 160, height: 100, mobile: false },
  });
  assert.deepEqual(replay.screenshot, source.screenshot);
});
