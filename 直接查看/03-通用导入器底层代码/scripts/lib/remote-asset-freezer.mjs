import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeCachedResourceText } from './capture-validation.mjs';

const EXTENSION_BY_TYPE = new Map([
  ['text/css', '.css'],
  ['font/otf', '.otf'], ['font/ttf', '.ttf'], ['font/woff', '.woff'], ['font/woff2', '.woff2'],
  ['image/avif', '.avif'], ['image/gif', '.gif'], ['image/jpeg', '.jpg'],
  ['image/png', '.png'], ['image/svg+xml', '.svg'], ['image/webp', '.webp'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'],
]);

function normalizedUrl(value) {
  return String(value || '').replaceAll('&amp;', '&').trim();
}

function googleFontFamilies(value) {
  try {
    const parsed = new URL(normalizedUrl(value));
    if (parsed.hostname !== 'fonts.googleapis.com') return [];
    return parsed.searchParams.getAll('family')
      .map((family) => family.split(':', 1)[0].replaceAll('+', ' ').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function deactivateUnusedRemoteFontImports(value) {
  const source = String(value || '');
  const importPattern = /@import\s+url\(\s*(["'])(https?:\/\/fonts\.googleapis\.com\/[^"']+)\1\s*\)\s*;?/gi;
  return source.replace(importPattern, (full, _quote, url, offset) => {
    const families = googleFontFamilies(url);
    if (families.length === 0) return full;
    const remainingCss = `${source.slice(0, offset)}${source.slice(offset + full.length)}`.toLowerCase();
    return families.some((family) => remainingCss.includes(family.toLowerCase())) ? full : '';
  });
}

function isRemote(value) {
  return /^https?:\/\//i.test(normalizedUrl(value));
}

function remoteCssUrls(value, baseUrl) {
  const urls = [];
  for (const match of String(value || '').matchAll(/url\(\s*(?:["']([^"']+)["']|([^)'"\s]+))\s*\)/gi)) {
    const raw = match[1] || match[2];
    if (!raw || /^(?:data:|#)/i.test(raw)) continue;
    try {
      const absolute = new URL(raw, baseUrl).href;
      if (isRemote(absolute)) urls.push(absolute);
    } catch {}
  }
  return urls;
}

export function collectActiveRemoteAssetUrls(html) {
  let active = deactivateUnusedRemoteFontImports(String(html || ''))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  active = active.replace(/<video\b([^>]*)>[\s\S]*?<\/video\s*>/gi, (video, attributes) => {
    const frozen = /\bdata-matbox-frozen-video\b/i.test(attributes)
      || /background-image\s*:\s*url\(\s*(?:["']|&quot;|&#0*34;|&#x0*22;)?data:image\//i.test(attributes);
    return frozen ? '' : video;
  });
  const urls = new Set();
  for (const tag of active.match(/<(?:img|video|source)\b[^>]*>/gi) || []) {
    if (/^<img\b/i.test(tag) && (
      /\bdata-matbox-image-visible\s*=\s*["']false["']/i.test(tag)
      || /\bdata-matbox-image-rendered-(?:width|height)\s*=\s*["']0(?:\.0+)?["']/i.test(tag)
      || /\bhidden\b/i.test(tag)
      || /\baria-hidden\s*=\s*["']true["']/i.test(tag)
    )) continue;
    for (const match of tag.matchAll(/(?:^|\s)(?:src|poster)\s*=\s*(["'])(.*?)\1/gi)) {
      const value = normalizedUrl(match[2]);
      if (isRemote(value)) urls.add(value);
    }
    for (const match of tag.matchAll(/(?:^|\s)srcset\s*=\s*(["'])(.*?)\1/gi)) {
      for (const candidate of match[2].split(',').map((item) => normalizedUrl(item.trim().split(/\s+/)[0]))) {
        if (isRemote(candidate)) urls.add(candidate);
      }
    }
  }
  for (const match of active.matchAll(/url\(\s*(?:["']([^"']+)["']|([^)'"\s]+))\s*\)/gi)) {
    const value = normalizedUrl(match[1] || match[2]);
    if (isRemote(value)) urls.add(value);
  }
  return [...urls].sort();
}

function extensionFor(url, contentType) {
  const normalizedType = String(contentType || '').split(';', 1)[0].trim().toLowerCase();
  const known = EXTENSION_BY_TYPE.get(normalizedType);
  if (known) return known;
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(?:avif|css|gif|jpe?g|mp4|otf|png|svg|ttf|webm|webp|woff2?)$/.test(extension)) {
      return extension === '.jpeg' ? '.jpg' : extension;
    }
  } catch {}
  return '.bin';
}

async function buildCacheIndex(cacheDir) {
  const output = new Map();
  if (!cacheDir) return output;
  for (const entry of await fs.readdir(cacheDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith('.resource')) continue;
    const file = path.join(cacheDir, entry.name);
    const handle = await fs.open(file, 'r');
    try {
      const buffer = Buffer.alloc(16_384);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const newline = buffer.subarray(0, bytesRead).indexOf(10);
      if (newline >= 0) output.set(normalizedUrl(buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '')), file);
    } finally {
      await handle.close();
    }
  }
  return output;
}

async function fetchRemote(url, { cacheIndex, fetchImpl, candidateFactory, fallbackDownloadImpl }) {
  const candidates = [url, ...(candidateFactory?.(url) || [])]
    .map(normalizedUrl)
    .filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
  let lastError;
  for (const candidate of candidates) {
    const cachedFile = cacheIndex.get(candidate);
    if (cachedFile) {
      const cached = decodeCachedResourceText(await fs.readFile(cachedFile, 'utf8'));
      return { ...cached, resolvedUrl: candidate, source: 'capture-cache' };
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90_000);
      try {
        const response = await fetchImpl(candidate, { redirect: 'follow', signal: controller.signal });
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (!buffer.length) throw new Error('empty response');
        return {
          sourceUrl: url,
          resolvedUrl: candidate,
          contentType: response.headers?.get?.('content-type') || '',
          buffer,
          source: candidate === url ? 'network' : 'network-fallback',
        };
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      } finally {
        clearTimeout(timeout);
      }
    }
    if (fallbackDownloadImpl) {
      try {
        const buffer = Buffer.from(await fallbackDownloadImpl(candidate));
        if (!buffer.length) throw new Error('fallback downloader returned an empty file');
        return {
          sourceUrl: url,
          resolvedUrl: candidate,
          contentType: '',
          buffer,
          source: 'network-fallback-downloader',
        };
      } catch (error) {
        lastError = new Error(`${lastError?.message || 'fetch failed'}; fallback downloader failed: ${error?.message || error}`);
      }
    }
  }
  throw new Error(`Unable to freeze remote asset ${url}: ${lastError?.message || lastError || 'unknown error'}`);
}

async function mapConcurrent(items, limit, worker) {
  let cursor = 0;
  const output = new Array(items.length);
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length || 1) }, run));
  return output;
}

export async function loadVerifiedRemoteAssetManifest(outputDir) {
  const manifestPath = path.join(outputDir, 'remote-assets-manifest.json');
  const manifest = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch((error) => {
    if (error?.code === 'ENOENT') return { assets: [] };
    throw error;
  });
  const assets = [];
  for (const asset of manifest.assets || []) {
    if (!asset?.sourceUrl || !asset?.filename || !asset?.sha256) continue;
    const buffer = await fs.readFile(path.join(outputDir, asset.filename));
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== asset.sha256 || buffer.length !== asset.byteLength) {
      throw new Error(`Frozen remote asset verification failed: ${asset.sourceUrl}`);
    }
    assets.push({ ...asset, mimeType: asset.mimeType || asset.contentType || 'application/octet-stream' });
  }
  return {
    assets,
    resourceMap: new Map(assets.map((asset) => [normalizedUrl(asset.sourceUrl), asset.href])),
  };
}

export async function freezeRemoteAssets(htmlSources, {
  cacheDir,
  outputDir,
  publicBase = '/frozen-assets/external-v4',
  fetchImpl = globalThis.fetch,
  fallbackDownloadImpl,
  candidateFactory,
  concurrency = 4,
  continueOnError = false,
  circuitBreakerThreshold = 3,
} = {}) {
  if (!outputDir) throw new TypeError('outputDir is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const urls = new Set();
  for await (const html of htmlSources || []) {
    for (const url of collectActiveRemoteAssetUrls(html)) urls.add(url);
  }
  await fs.mkdir(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, 'remote-assets-manifest.json');
  const existingManifest = await loadVerifiedRemoteAssetManifest(outputDir);
  const existingByUrl = new Map(existingManifest.assets.map((asset) => [normalizedUrl(asset.sourceUrl), asset]));
  const cacheIndex = await buildCacheIndex(cacheDir);
  const assetsByUrl = new Map();
  const pendingByUrl = new Map();

  const freezeOne = (rawUrl) => {
    const url = normalizedUrl(rawUrl);
    if (assetsByUrl.has(url)) return Promise.resolve(assetsByUrl.get(url));
    if (existingByUrl.has(url)) {
      const asset = existingByUrl.get(url);
      assetsByUrl.set(url, asset);
      return Promise.resolve(asset);
    }
    if (pendingByUrl.has(url)) return pendingByUrl.get(url);
    const pending = (async () => {
      const downloaded = await fetchRemote(url, { cacheIndex, fetchImpl, candidateFactory, fallbackDownloadImpl });
      let buffer = downloaded.buffer;
      const normalizedType = String(downloaded.contentType || '').split(';', 1)[0].trim().toLowerCase();
      if (normalizedType === 'text/css' || extensionFor(url, downloaded.contentType) === '.css') {
        let css = buffer.toString('utf8');
        for (const nestedUrl of [...new Set(remoteCssUrls(css, downloaded.resolvedUrl || url))]) {
          const nested = await freezeOne(nestedUrl);
          const escaped = nestedUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          css = css.replace(new RegExp(escaped, 'g'), nested.href);
        }
        buffer = Buffer.from(css, 'utf8');
      }
      const extension = extensionFor(url, downloaded.contentType);
      const filename = `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 32)}${extension}`;
      const temporary = path.join(outputDir, `${filename}.${process.pid}.tmp`);
      const file = path.join(outputDir, filename);
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, file).catch(async (error) => {
        if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
        await fs.rm(temporary, { force: true });
      });
      const asset = {
        sourceUrl: url,
        resolvedUrl: downloaded.resolvedUrl,
        source: downloaded.source,
        contentType: downloaded.contentType,
        byteLength: buffer.length,
        sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
        filename,
        href: `${publicBase}/${filename}`,
      };
      assetsByUrl.set(url, asset);
      return asset;
    })();
    pendingByUrl.set(url, pending);
    return pending.finally(() => pendingByUrl.delete(url));
  };

  const failures = [];
  const hostStates = new Map();
  await mapConcurrent([...urls].sort(), concurrency, async (url) => {
    let hostname = '';
    try { hostname = new URL(url).hostname.toLowerCase(); } catch {}
    const hostState = hostStates.get(hostname) || { consecutiveFailures: 0, open: false };
    hostStates.set(hostname, hostState);
    if (continueOnError && hostState.open) {
      failures.push({ url, error: `host circuit open after ${hostState.consecutiveFailures} consecutive failures: ${hostname}` });
      return null;
    }
    try {
      const asset = await freezeOne(url);
      hostState.consecutiveFailures = 0;
      return asset;
    } catch (error) {
      if (!continueOnError) throw error;
      hostState.consecutiveFailures += 1;
      if (hostState.consecutiveFailures >= circuitBreakerThreshold) hostState.open = true;
      failures.push({ url, error: String(error?.message || error) });
      return null;
    }
  });
  const manifestAssets = new Map(existingByUrl);
  for (const [url, asset] of assetsByUrl) manifestAssets.set(url, asset);
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    assets: [...manifestAssets.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
  };
  const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryManifest, manifestPath);
  return {
    assets: [...assetsByUrl.values()].sort((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
    resourceMap: new Map([...assetsByUrl].map(([url, asset]) => [url, asset.href])),
    failures: failures.sort((left, right) => left.url.localeCompare(right.url)),
  };
}

function rewriteCandidate(value, resourceMap) {
  const normalized = normalizedUrl(value);
  return resourceMap.get(normalized) || value;
}

export function localizeRemoteAssets(html, resourceMap = new Map()) {
  const map = resourceMap instanceof Map ? resourceMap : new Map(Object.entries(resourceMap || {}));
  let output = deactivateUnusedRemoteFontImports(String(html || '')).replace(/<(?:img|video|source)\b[^>]*>/gi, (tag) => {
    let localized = tag.replace(/((?:^|\s)(?:src|poster)\s*=\s*)(["'])(.*?)\2/gi, (full, prefix, quote, value) => {
      const replacement = rewriteCandidate(value, map);
      return replacement === value ? full : `${prefix}${quote}${replacement}${quote}`;
    });
    localized = localized.replace(/((?:^|\s)srcset\s*=\s*)(["'])(.*?)\2/gi, (full, prefix, quote, value) => {
      let changed = false;
      const rewritten = value.split(',').map((item) => {
        const parts = item.trim().split(/\s+/);
        const replacement = rewriteCandidate(parts[0], map);
        if (replacement !== parts[0]) changed = true;
        return [replacement, ...parts.slice(1)].join(' ');
      }).join(', ');
      return changed ? `${prefix}${quote}${rewritten}${quote}` : full;
    });
    return localized;
  });
  output = output.replace(/url\(\s*(["']?)(https?:\/\/[^)'"\s]+)\1\s*\)/gi, (full, _quote, value) => {
    const replacement = map.get(normalizedUrl(value));
    return replacement ? `url("${replacement}")` : full;
  });
  return output;
}
