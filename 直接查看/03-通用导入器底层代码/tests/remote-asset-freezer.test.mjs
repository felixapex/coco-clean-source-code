import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectActiveRemoteAssetUrls,
  deactivateUnusedRemoteFontImports,
  freezeRemoteAssets,
  localizeRemoteAssets,
} from '../scripts/lib/remote-asset-freezer.mjs';

test('unused Google font imports are removed but imports used by the component remain', () => {
  const unused = '<style>@import url("https://fonts.googleapis.com/css2?family=Cormorant+Garamond&family=Inter");:root{--font-serif:Goldenbook,serif}.title{font-family:var(--font-serif)}</style>';
  const used = '<style>@import url("https://fonts.googleapis.com/css2?family=Inter");.title{font-family:Inter,sans-serif}</style>';

  assert.doesNotMatch(deactivateUnusedRemoteFontImports(unused), /fonts\.googleapis\.com/);
  assert.match(deactivateUnusedRemoteFontImports(used), /fonts\.googleapis\.com/);
});

test('active remote asset collection ignores comments and provenance-only attributes', () => {
  const html = `
    <!-- <img src="https://example.com/comment.jpg"> -->
    <img src="/local.jpg" data-matbox-source-src="https://example.com/hidden.jpg">
    <img data-matbox-image-visible="false" src="https://example.com/inactive.jpg">
    <img src="https://example.com/active.jpg" srcset="https://example.com/active-2x.jpg 2x">
    <video data-matbox-frozen-video="true" style="background-image:url('data:image/png;base64,AA==')"><source src="https://example.com/inactive.mp4"></video>
    <video poster="https://example.com/poster.webp"><source src="https://example.com/movie.mp4"></video>
    <style>.card{background:url("https://example.com/background.png")}</style>
  `;
  assert.deepEqual(collectActiveRemoteAssetUrls(html), [
    'https://example.com/active-2x.jpg',
    'https://example.com/active.jpg',
    'https://example.com/background.png',
    'https://example.com/movie.mp4',
    'https://example.com/poster.webp',
  ]);
});

test('remote assets and nested CSS resources are frozen and localized', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-remote-assets-'));
  const outputDir = path.join(root, 'external');
  const responses = new Map([
    ['https://example.com/theme.css', { type: 'text/css', body: '@font-face{src:url("https://example.com/font.woff2")}'}],
    ['https://example.com/font.woff2', { type: 'font/woff2', body: 'wOF2font' }],
    ['https://example.com/photo.jpg', { type: 'image/jpeg', body: 'jpeg' }],
  ]);
  const fetchImpl = async (url) => {
    const response = responses.get(String(url));
    assert.ok(response, `unexpected fetch: ${url}`);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name.toLowerCase() === 'content-type' ? response.type : null },
      arrayBuffer: async () => Buffer.from(response.body),
    };
  };
  const frozen = await freezeRemoteAssets([
    '<style>@import url("https://example.com/theme.css")</style><img src="https://example.com/photo.jpg">',
  ], {
    outputDir,
    publicBase: '/frozen-assets/external-test',
    fetchImpl,
  });
  assert.equal(frozen.assets.length, 3);
  assert.equal(frozen.resourceMap.size, 3);
  const localized = localizeRemoteAssets(
    '<style>@import url("https://example.com/theme.css")</style><img src="https://example.com/photo.jpg" data-matbox-source-src="https://example.com/photo.jpg">',
    frozen.resourceMap,
  );
  assert.match(localized, /@import url\("\/frozen-assets\/external-test\//);
  assert.match(localized, /<img src="\/frozen-assets\/external-test\//);
  assert.match(localized, /data-matbox-source-src="https:\/\/example\.com\/photo\.jpg"/);
  const cssAsset = frozen.assets.find((asset) => asset.sourceUrl === 'https://example.com/theme.css');
  const css = await fs.readFile(path.join(outputDir, cssAsset.filename), 'utf8');
  assert.match(css, /url\("\/frozen-assets\/external-test\//);
  assert.doesNotMatch(css, /https:\/\/example\.com\/font\.woff2/);
  const cached = await freezeRemoteAssets([
    '<style>@import url("https://example.com/theme.css")</style><img src="https://example.com/photo.jpg">',
  ], {
    outputDir,
    publicBase: '/frozen-assets/external-test',
    fetchImpl: async (url) => assert.fail(`verified frozen asset was fetched again: ${url}`),
  });
  assert.equal(cached.resourceMap.get('https://example.com/photo.jpg'), frozen.resourceMap.get('https://example.com/photo.jpg'));
  await fs.rm(root, { recursive: true, force: true });
});

test('network fetch failure can fall back to the verified downloader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-remote-fallback-'));
  const frozen = await freezeRemoteAssets(['<img src="https://example.com/fallback.png">'], {
    outputDir: path.join(root, 'external'),
    fetchImpl: async () => { throw new Error('fetch failed'); },
    fallbackDownloadImpl: async (url) => {
      assert.equal(url, 'https://example.com/fallback.png');
      return Buffer.from('png');
    },
  });
  assert.equal(frozen.assets.length, 1);
  assert.equal(frozen.assets[0].source, 'network-fallback-downloader');
  await fs.rm(root, { recursive: true, force: true });
});

test('continue-on-error preserves successful assets and reports only failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-remote-partial-'));
  const frozen = await freezeRemoteAssets([
    '<img src="https://example.com/good.jpg"><img src="https://example.com/bad.jpg">',
  ], {
    outputDir: path.join(root, 'external'),
    fetchImpl: async (url) => {
      if (String(url).endsWith('/bad.jpg')) throw new Error('blocked');
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => Buffer.from('good'),
      };
    },
    continueOnError: true,
  });
  assert.equal(frozen.assets.length, 1);
  assert.deepEqual(frozen.failures.map((failure) => failure.url), ['https://example.com/bad.jpg']);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'external', 'remote-assets-manifest.json'), 'utf8'));
  assert.equal(manifest.assets.length, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test('host circuit breaker stops repeated waits after the configured failure threshold', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-remote-circuit-'));
  let requests = 0;
  const html = Array.from({ length: 5 }, (_, index) => `<img src="https://blocked.example.com/${index}.jpg">`).join('');
  const frozen = await freezeRemoteAssets([html], {
    outputDir: path.join(root, 'external'),
    fetchImpl: async () => { requests += 1; throw new Error('connection reset'); },
    continueOnError: true,
    circuitBreakerThreshold: 2,
    concurrency: 1,
  });
  assert.equal(requests, 6, 'only the first two URLs should consume the three fetch attempts');
  assert.equal(frozen.failures.length, 5);
  assert.equal(frozen.failures.filter((failure) => /circuit open/.test(failure.error)).length, 3);
  await fs.rm(root, { recursive: true, force: true });
});
