import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { freezeRemoteFontAssets, preflightRemoteFontAssets } from '../scripts/lib/remote-font-freezer.mjs';

test('remote font URLs become deterministic local cached assets', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-fonts-'));
  let downloads = 0;
  const fetchImpl = async () => {
    downloads += 1;
    return { ok: true, arrayBuffer: async () => Buffer.from('font-bytes') };
  };
  const source = '<style>@font-face{src:url("https://cdn.example.com/coco.woff2?v=1")} .x{background:url(https://cdn.example.com/coco.woff2?v=1)}</style>';
  const first = await freezeRemoteFontAssets(source, { cacheDir, fetchImpl });
  assert.equal(first.assets.length, 1);
  assert.equal(downloads, 1);
  assert.match(first.html, /\/frozen-assets\/fonts\/[a-f0-9]{24}\.woff2/);
  assert.doesNotMatch(first.html, /https:\/\/cdn\.example\.com/);
  const second = await freezeRemoteFontAssets(source, { cacheDir, fetchImpl });
  assert.equal(downloads, 1);
  assert.equal(second.html, first.html);
});

test('extensionless Typekit fonts inside base64 CSS are frozen and re-encoded', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-typekit-'));
  const remote = 'https://use.typekit.net/af/example/30/l?fvd=n4&v=3';
  const css = `@import url("https://p.typekit.net/p.css?k=x");@font-face{font-family:goldenbook;src:url("${remote}") format("woff2")}`;
  const source = `<link rel="stylesheet" href="data:text/css;base64,${Buffer.from(css).toString('base64')}">`;
  const result = await freezeRemoteFontAssets(source, {
    cacheDir,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => Buffer.from('goldenbook') }),
  });
  assert.equal(result.assets.length, 1);
  const payload = result.html.match(/base64,([a-z0-9+/=]+)/i)?.[1];
  const rewrittenCss = Buffer.from(payload, 'base64').toString('utf8');
  assert.match(rewrittenCss, /\/frozen-assets\/fonts\/[a-f0-9]{24}\.woff2/);
  assert.doesNotMatch(rewrittenCss, /https:\/\//);
});

test('public font preflight downloads every unique font once before page assembly', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-font-preflight-'));
  const downloads = [];
  const result = await preflightRemoteFontAssets([
    '<style>@font-face{src:url("https://cdn.example.com/shared.woff2")}</style>',
    '<style>@font-face{src:url("https://cdn.example.com/shared.woff2")}@font-face{src:url("https://cdn.example.com/unique.woff2")}</style>',
  ], {
    cacheDir,
    fetchImpl: async (url) => {
      downloads.push(url);
      return { ok: true, arrayBuffer: async () => Buffer.from(`font:${url}`) };
    },
  });
  assert.deepEqual(downloads.sort(), [
    'https://cdn.example.com/shared.woff2',
    'https://cdn.example.com/unique.woff2',
  ]);
  assert.equal(result.assets.length, 2);
});

test('the build validates public fonts from the shared scan before transforming pages', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const sharedScan = source.indexOf('teeAsyncIterable(sourceReplayHtml(), 2)');
  const preflight = source.indexOf('preflightRemoteFontAssets(fontSources');
  const pageTransform = source.indexOf("const capturedRoutes =");
  assert.ok(sharedScan >= 0, 'build must scan replay sources once for shared resources');
  assert.ok(preflight >= 0, 'build must run the public font preflight');
  assert.ok(pageTransform >= 0, 'build must transform replay pages');
  assert.ok(sharedScan < preflight && preflight < pageTransform, 'public font preflight must happen before page transformation');
});

test('font download retries when the response body resets after an HTTP success', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-font-body-retry-'));
  let attempts = 0;
  const result = await freezeRemoteFontAssets(
    '<style>@font-face{src:url("https://cdn.example.com/body-reset.woff2")}</style>',
    {
      cacheDir,
      fetchImpl: async () => {
        attempts += 1;
        return {
          ok: true,
          arrayBuffer: async () => {
            if (attempts === 1) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
            return Buffer.from('complete-font');
          },
        };
      },
    },
  );
  assert.equal(attempts, 2);
  assert.equal(result.assets[0].byteLength, Buffer.byteLength('complete-font'));
});

test('font download uses the verified fallback channel after repeated fetch failures', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-font-fallback-'));
  let fetchAttempts = 0;
  let fallbackAttempts = 0;
  const font = Buffer.concat([Buffer.from('wOF2'), Buffer.from('verified-font-body')]);
  const result = await freezeRemoteFontAssets(
    '<style>@font-face{src:url("https://cdn.example.com/fallback.woff2")}</style>',
    {
      cacheDir,
      fetchImpl: async () => {
        fetchAttempts += 1;
        throw new Error('fetch channel reset');
      },
      fallbackDownloadImpl: async (url, options) => {
        fallbackAttempts += 1;
        assert.match(options.partialPath, /\.partial$/);
        return font;
      },
    },
  );
  assert.equal(fetchAttempts, 3);
  assert.equal(fallbackAttempts, 1);
  assert.equal(result.assets[0].byteLength, font.length);
});
