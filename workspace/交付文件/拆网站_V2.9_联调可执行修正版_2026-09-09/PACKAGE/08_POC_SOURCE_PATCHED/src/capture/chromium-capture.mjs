import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import pngjs from 'pngjs';
import { CdpClient } from './cdp-client.mjs';
import { installBrowserRequestGuard } from '../security/browser-request-guard.mjs';
import { runPersistentWorkerPool } from '../pipeline/persistent-worker-pool.mjs';
import { summarizeInteractionInventory } from './interaction-stability.mjs';
import {
  createObservedPageReadinessMonitor,
  sampleObservedPageState,
} from './observed-page-readiness.mjs';
import {
  loadPersistentResourceDataUrl,
  storePersistentResourceDataUrl,
} from './persistent-resource-cache.mjs';

const { PNG } = pngjs;
const networkEnabledClients = new WeakSet();
const sharedImageResourceCache = new Map();
const sharedResourceCacheSizes = new Map();
const sharedResourceCacheLimitBytes = Math.max(8 * 1024 * 1024, Number(process.env.MATBOX_SHARED_RESOURCE_CACHE_BYTES || 96 * 1024 * 1024));
let sharedResourceCacheBytes = 0;
const COMPUTED_STYLES = [
  'display','position','width','height','margin-top','margin-right','margin-bottom','margin-left',
  'padding-top','padding-right','padding-bottom','padding-left','gap','flex-direction','justify-content',
  'align-items','grid-template-columns','font-family','font-size','font-weight','line-height','color',
  'background-color','border-top-width','border-top-color','border-radius','box-shadow','opacity','transform'
];

export function bigCommerceImageFallbackCandidates(source) {
  const value = String(source || '');
  if (!/^https:\/\/[^/]*bigcommerce\.com\//i.test(value)) return [];
  const match = value.match(/\/images\/stencil\/([^/]+)\//i);
  if (!match) return [];
  return ['1280w', '768w', 'original']
    .filter((size) => size.toLowerCase() !== match[1].toLowerCase())
    .map((size) => value.replace(match[0], `/images/stencil/${size}/`));
}

export function assertBrowserLaunchAllowed(browserPath) {
  const normalized = String(browserPath || '').replace(/\\/g, '/').toLowerCase();
  if (/(?:^|\/)msedge(?:\.exe)?$/.test(normalized)) {
    throw new Error('Local Microsoft Edge automation is disabled because it can trigger a system crash. Use an isolated non-Edge browser environment.');
  }
}

async function resolveChromiumPath(requestedPath) {
  if (process.platform !== 'win32' || (requestedPath && requestedPath !== '/usr/bin/chromium')) {
    return requestedPath ?? '/usr/bin/chromium';
  }
  const candidates = [
    process.env.MATBOX_CHROMIUM_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error('No supported isolated non-Edge browser found. Set MATBOX_CHROMIUM_PATH to Google Chrome.');
}

async function waitForDevToolsPort(profileDir, process, timeoutMs) {
  const activePortFile = path.join(profileDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Chromium exited before DevTools was ready: ${process.exitCode}`);
    try {
      const text = await fs.readFile(activePortFile, 'utf8');
      const [port] = text.trim().split(/\r?\n/);
      if (port) return Number(port);
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for Chromium DevTools port');
}

async function getPageTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out finding Chromium page target');
}

async function waitForReadyState(client, timeoutMs, acceptedStates = ['interactive', 'complete']) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await client.send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    if (acceptedStates.includes(result.result?.value)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for document.readyState');
}

async function ensureNetworkEnabled(client) {
  if (networkEnabledClients.has(client)) return;
  try {
    await client.send('Network.enable', {
      // Full storefront pages can deliver hundreds of megabytes of imagery.
      // Keep response bodies until serialization so every painted image can be
      // embedded in the replay instead of depending on the source CDN later.
      maxTotalBufferSize: 512 * 1024 * 1024,
      maxResourceBufferSize: 64 * 1024 * 1024,
      maxPostDataSize: 1024 * 1024,
    });
    networkEnabledClients.add(client);
  } catch (error) {
    networkEnabledClients.delete(client);
    throw error;
  }
}

function headerValue(headers, name) {
  const expected = String(name || '').toLowerCase();
  if (Array.isArray(headers)) {
    return headers.find((header) => String(header?.name || '').toLowerCase() === expected)?.value || '';
  }
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === expected) return String(value || '');
  }
  return '';
}

function imageMimeType(url, headers) {
  const headerMime = headerValue(headers, 'content-type').split(';')[0].trim().toLowerCase();
  if (headerMime === 'text/css' || headerMime.startsWith('image/') || headerMime.startsWith('font/') || /^(?:application\/(?:font-|x-font-|vnd\.ms-fontobject|octet-stream))/.test(headerMime)) return headerMime;
  const pathname = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ''; } })();
  if (pathname.endsWith('.png')) return 'image/png';
  if (/\.jpe?g$/.test(pathname)) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  if (pathname.endsWith('.avif')) return 'image/avif';
  if (pathname.endsWith('.css')) return 'text/css';
  if (pathname.endsWith('.woff2')) return 'font/woff2';
  if (pathname.endsWith('.woff')) return 'font/woff';
  if (pathname.endsWith('.ttf')) return 'font/ttf';
  if (pathname.endsWith('.otf')) return 'font/otf';
  if (pathname.endsWith('.eot')) return 'application/vnd.ms-fontobject';
  return '';
}

export function shouldShareResourceAcrossPages(url, { isFont = false, isStylesheet = false } = {}) {
  if (isFont || isStylesheet) return true;
  return /(?:\/image-manager\/|mega[-_]?menu|\/nav(?:igation)?\/|logo)/i.test(String(url || ''));
}

export function reconcileVisualReadinessWithCapturedAssets(readiness = {}, capturedUrls = []) {
  const captured = new Set((capturedUrls || []).map((url) => String(url || '')).filter(Boolean));
  const hasCapturedUrl = (detail, fields) => fields.some((field) => captured.has(String(detail?.[field] || '')));
  const pendingImageDetails = (readiness.pendingImageDetails || []).filter((detail) => !hasCapturedUrl(detail, ['src', 'declaredSrc']));
  const failedImageDetails = (readiness.failedImageDetails || []).filter((detail) => !hasCapturedUrl(detail, ['src', 'declaredSrc']));
  const pendingBackgroundImageDetails = (readiness.pendingBackgroundImageDetails || []).filter((detail) => !hasCapturedUrl(detail, ['source', 'src']));
  const failedBackgroundImageDetails = (readiness.failedBackgroundImageDetails || []).filter((detail) => !hasCapturedUrl(detail, ['source', 'src']));
  return {
    ...readiness,
    pendingImages: pendingImageDetails.length,
    failedImages: failedImageDetails.length,
    pendingImagesWithReadyPeer: 0,
    pendingImagesWithoutReadyPeer: pendingImageDetails.length,
    pendingImageDetails,
    failedImageDetails,
    pendingBackgroundImages: pendingBackgroundImageDetails.length,
    failedBackgroundImages: failedBackgroundImageDetails.length,
    pendingBackgroundImageDetails,
    failedBackgroundImageDetails,
    recoveredImageAssets: Math.max(0,
      Number(readiness.pendingImages || 0) + Number(readiness.failedImages || 0)
      + Number(readiness.pendingBackgroundImages || 0) + Number(readiness.failedBackgroundImages || 0)
      - pendingImageDetails.length - failedImageDetails.length
      - pendingBackgroundImageDetails.length - failedBackgroundImageDetails.length),
  };
}

function storeResourceDataUrl(cache, key, value) {
  if (!key || !value) return;
  if (cache !== sharedImageResourceCache) {
    cache.set(key, value);
    return;
  }
  const size = Buffer.byteLength(String(value), 'utf8');
  if (size > sharedResourceCacheLimitBytes) return;
  if (cache.has(key)) {
    sharedResourceCacheBytes -= sharedResourceCacheSizes.get(key) || 0;
    cache.delete(key);
    sharedResourceCacheSizes.delete(key);
  }
  while (sharedResourceCacheBytes + size > sharedResourceCacheLimitBytes && cache.size) {
    const oldestKey = cache.keys().next().value;
    sharedResourceCacheBytes -= sharedResourceCacheSizes.get(oldestKey) || 0;
    cache.delete(oldestKey);
    sharedResourceCacheSizes.delete(oldestKey);
  }
  cache.set(key, value);
  sharedResourceCacheSizes.set(key, size);
  sharedResourceCacheBytes += size;
}

export async function loadNetworkResourceAsDataUrl(client, url, cache = sharedImageResourceCache) {
  const source = String(url || '');
  if (!/^https?:\/\//i.test(source)) return null;
  if (cache.has(source)) return cache.get(source);
  const persisted = await loadPersistentResourceDataUrl(source);
  if (persisted) {
    storeResourceDataUrl(cache, source, persisted);
    return persisted;
  }
  const loaded = await client.send('Network.loadNetworkResource', {
    url: source,
    options: { disableCache: false, includeCredentials: true },
  });
  const resource = loaded?.resource || {};
  if (!resource.success || Number(resource.httpStatusCode || 0) >= 400 || !resource.stream) return null;
  const mimeType = imageMimeType(source, resource.headers);
  if (!mimeType) return null;
  const chunks = [];
  try {
    while (true) {
      const chunk = await client.send('IO.read', { handle: resource.stream });
      chunks.push(chunk.base64Encoded
        ? Buffer.from(String(chunk.data || ''), 'base64')
        : Buffer.from(String(chunk.data || ''), 'utf8'));
      if (chunk.eof) break;
    }
  } finally {
    await client.send('IO.close', { handle: resource.stream }).catch(() => {});
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) return null;
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
  storeResourceDataUrl(cache, source, dataUrl);
  await storePersistentResourceDataUrl(source, dataUrl);
  return dataUrl;
}

async function loadRuntimeResourceAsDataUrl(client, url, cache = sharedImageResourceCache) {
  const source = String(url || '');
  if (!/^https?:\/\//i.test(source)) return null;
  if (cache.has(source)) return cache.get(source);
  const persisted = await loadPersistentResourceDataUrl(source);
  if (persisted) {
    storeResourceDataUrl(cache, source, persisted);
    return persisted;
  }
  const expression = `(async () => {
    try {
      const response = await fetch(${JSON.stringify(source)}, { credentials: 'include', cache: 'force-cache' });
      if (!response.ok) return { ok: false, status: response.status };
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      return {
        ok: true,
        mimeType: response.headers.get('content-type') || '',
        base64: btoa(binary),
      };
    } catch (error) {
      return { ok: false, error: String(error && (error.stack || error.message) || error) };
    }
  })()`;
  const evaluated = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = evaluated?.result?.value;
  if (!value?.ok || !value.base64) return null;
  const mimeType = imageMimeType(source, { 'content-type': value.mimeType });
  if (!mimeType) return null;
  const dataUrl = `data:${mimeType};base64,${value.base64}`;
  storeResourceDataUrl(cache, source, dataUrl);
  await storePersistentResourceDataUrl(source, dataUrl);
  return dataUrl;
}

export async function loadResourceAsDataUrlWithFallback(client, url, cache = sharedImageResourceCache) {
  try {
    const direct = await loadNetworkResourceAsDataUrl(client, url, cache);
    if (direct) return direct;
  } catch {}
  try {
    return await loadRuntimeResourceAsDataUrl(client, url, cache);
  } catch {
    return null;
  }
}

function canonicalStylesheetUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    return url.href;
  } catch {
    return String(value || '').split('#')[0];
  }
}

export function summarizeStylesheetCapture(requestedUrls = [], responseStatuses = []) {
  const requested = [...new Set(requestedUrls
    .map(canonicalStylesheetUrl)
    .filter((url) => /^https?:\/\//i.test(url)))];
  const byUrl = new Map();
  for (const status of responseStatuses) {
    const aliases = [status?.url, ...(status?.aliases || [])]
      .map(canonicalStylesheetUrl)
      .filter(Boolean);
    for (const url of aliases) {
      const current = byUrl.get(url) || {};
      byUrl.set(url, {
        ...current,
        ...status,
        url,
        completed: Boolean(current.completed || status?.completed),
        captured: Boolean(current.captured || status?.captured),
        failed: Boolean(current.failed || status?.failed),
        errorText: status?.errorText || current.errorText || '',
      });
    }
  }
  const captured = requested.filter((url) => byUrl.get(url)?.captured);
  const failed = requested.filter((url) => byUrl.get(url)?.failed && !byUrl.get(url)?.captured);
  const uncaptured = requested.filter((url) => !byUrl.get(url)?.captured);
  return {
    stylesheetCount: requested.length,
    capturedStylesheets: captured.length,
    failedStylesheets: failed.length,
    uncapturedStylesheets: uncaptured.length,
    failedStylesheetDetails: failed.slice(0, 20).map((url) => ({
      url,
      errorText: byUrl.get(url)?.errorText || 'stylesheet-request-failed',
    })),
    uncapturedStylesheetDetails: uncaptured.slice(0, 20).map((url) => ({
      url,
      errorText: byUrl.get(url)?.errorText || 'stylesheet-response-not-captured',
    })),
  };
}

export function summarizeFontCapture(responseStatuses = []) {
  const byUrl = new Map();
  for (const status of responseStatuses) {
    const url = canonicalStylesheetUrl(status?.url);
    if (!url) continue;
    const current = byUrl.get(url) || {};
    byUrl.set(url, {
      ...current,
      ...status,
      url,
      captured: Boolean(current.captured || status?.captured),
      failed: Boolean(current.failed || status?.failed),
      errorText: status?.errorText || current.errorText || '',
    });
  }
  const statuses = [...byUrl.values()];
  const failed = statuses.filter((status) => status.failed && !status.captured);
  const uncaptured = statuses.filter((status) => !status.captured);
  return {
    fontCount: statuses.length,
    capturedFonts: statuses.filter((status) => status.captured).length,
    failedFonts: failed.length,
    uncapturedFonts: uncaptured.length,
    failedFontDetails: failed.slice(0, 20).map((status) => ({
      url: status.url,
      errorText: status.errorText || 'font-request-failed',
    })),
    uncapturedFontDetails: uncaptured.slice(0, 20).map((status) => ({
      url: status.url,
      errorText: status.errorText || 'font-response-not-captured',
    })),
  };
}

export function summarizeCriticalNetworkFailures(requests = new Map(), failures = new Map()) {
  const criticalTypes = new Set(['Document', 'Script', 'XHR', 'Fetch']);
  const details = [];
  for (const [requestId, failure] of failures) {
    const request = requests.get(requestId);
    if (!request?.url || !criticalTypes.has(String(request.type || '')) || failure?.canceled) continue;
    details.push({
      url: String(request.url),
      type: String(request.type),
      errorText: String(failure?.errorText || 'network-loading-failed'),
      blockedReason: String(failure?.blockedReason || ''),
    });
  }
  return {
    failedNetworkRequests: details.length,
    failedNetworkRequestDetails: details.slice(0, 20),
  };
}

async function createImageResponseCollector(client) {
  const responses = new Map();
  const completed = new Set();
  const requests = new Map();
  const fontRequests = new Map();
  const failures = new Map();
  const capturedStylesheets = new Set();
  const capturedFonts = new Set();
  const allRequests = new Map();
  await ensureNetworkEnabled(client);
  const offRequest = client.onEvent('Network.requestWillBeSent', (params) => {
    const url = params.request?.url;
    if (!params.requestId || !url) return;
    allRequests.set(params.requestId, { url, type: params.type || 'Other' });
    if (params.type === 'Stylesheet' || /\.css(?:[?#]|$)/i.test(url)) {
      requests.set(params.requestId, { url, type: params.type || 'Stylesheet' });
    }
    if (params.type === 'Font' || /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(url)) {
      fontRequests.set(params.requestId, { url, type: params.type || 'Font' });
    }
  });
  const offResponse = client.onEvent('Network.responseReceived', (params) => {
    const response = params.response ?? {};
    const mimeType = String(response.mimeType || '').toLowerCase();
    const isImage = params.type === 'Image' || mimeType.startsWith('image/');
    const isFont = params.type === 'Font' || /(?:font|woff|opentype|truetype)/i.test(mimeType);
    const isStylesheet = params.type === 'Stylesheet' || mimeType === 'text/css';
    if (!isImage && !isFont && !isStylesheet) return;
    if (!params.requestId || !response.url) return;
    if (isStylesheet) requests.set(params.requestId, {
      ...(requests.get(params.requestId) || {}),
      responseUrl: response.url,
      url: requests.get(params.requestId)?.url || response.url,
    });
    if (isFont) fontRequests.set(params.requestId, {
      ...(fontRequests.get(params.requestId) || {}),
      responseUrl: response.url,
      url: fontRequests.get(params.requestId)?.url || response.url,
    });
    if (Number(response.status || 0) >= 400) failures.set(params.requestId, {
      errorText: `http-${response.status}`,
      blockedReason: '',
      canceled: false,
    });
    responses.set(params.requestId, {
      requestId: params.requestId,
      url: response.url,
      mimeType,
      isImage,
      isFont,
      isStylesheet,
      status: Number(response.status || 0),
    });
  });
  const offFinished = client.onEvent('Network.loadingFinished', (params) => {
    if (params.requestId) completed.add(params.requestId);
  });
  const offFailed = client.onEvent('Network.loadingFailed', (params) => {
    if (params.requestId) failures.set(params.requestId, {
      errorText: params.errorText || 'network-loading-failed',
      blockedReason: params.blockedReason || '',
      canceled: Boolean(params.canceled),
    });
  });

  return {
    async dataUrls(additionalUrls = []) {
      const assets = new Map();
      const stylesheets = [];
      await Promise.all([...responses.values()].map(async (response) => {
        if (!completed.has(response.requestId)) return;
        try {
          const body = await client.send('Network.getResponseBody', { requestId: response.requestId });
          const raw = body.base64Encoded
            ? Buffer.from(String(body.body || ''), 'base64')
            : Buffer.from(String(body.body || ''), 'utf8');
          if (!raw.length) return;
          if (response.isStylesheet) {
            stylesheets.push({ url: response.url, text: raw.toString('utf8') });
            capturedStylesheets.add(canonicalStylesheetUrl(response.url));
            const dataUrl = `data:text/css;base64,${raw.toString('base64')}`;
            storeResourceDataUrl(sharedImageResourceCache, response.url, dataUrl);
            await storePersistentResourceDataUrl(response.url, dataUrl);
          }
          else if (!failures.has(response.requestId)) {
            const dataUrl = `data:${response.mimeType};base64,${raw.toString('base64')}`;
            assets.set(response.url, dataUrl);
            await storePersistentResourceDataUrl(response.url, dataUrl);
            if (shouldShareResourceAcrossPages(response.url, response)) {
              storeResourceDataUrl(sharedImageResourceCache, response.url, dataUrl);
            }
            if (response.isFont) {
              capturedFonts.add(canonicalStylesheetUrl(response.url));
            }
          }
        } catch {}
      }));
      await Promise.all([...fontRequests.values()].map(async (request) => {
        const urls = [...new Set([request.responseUrl, request.url].filter((url) => /^https?:\/\//i.test(String(url || ''))))];
        if (urls.some((url) => assets.has(url))) {
          const dataUrl = urls.map((url) => assets.get(url)).find(Boolean);
          for (const url of urls) {
            capturedFonts.add(canonicalStylesheetUrl(url));
            if (dataUrl) storeResourceDataUrl(sharedImageResourceCache, url, dataUrl);
          }
          return;
        }
        for (const url of urls) {
          try {
            const dataUrl = await loadResourceAsDataUrlWithFallback(client, url);
            if (!dataUrl) continue;
            for (const alias of urls) assets.set(alias, dataUrl);
            for (const alias of urls) capturedFonts.add(canonicalStylesheetUrl(alias));
            break;
          } catch {}
        }
      }));
      await Promise.all([...requests.values()].map(async (request) => {
        const urls = [...new Set([request.responseUrl, request.url].filter((url) => /^https?:\/\//i.test(String(url || ''))))];
        if (urls.some((url) => capturedStylesheets.has(canonicalStylesheetUrl(url)))) return;
        for (const url of urls) {
          try {
            const dataUrl = await loadResourceAsDataUrlWithFallback(client, url);
            const encoded = String(dataUrl || '').match(/^data:text\/css(?:;[^,]*)?;base64,(.+)$/i)?.[1];
            if (!encoded) continue;
            stylesheets.push({ url, aliases: urls, text: Buffer.from(encoded, 'base64').toString('utf8') });
            for (const alias of urls) capturedStylesheets.add(canonicalStylesheetUrl(alias));
            break;
          } catch {}
        }
      }));
      const resolveCssAsset = (rawUrl, stylesheetUrl) => {
        const value = String(rawUrl || '').trim();
        if (!value || /^(?:data:|blob:|#)/i.test(value)) return value;
        try {
          const resolved = new URL(value, stylesheetUrl).href;
          return assets.get(resolved) || resolved;
        } catch { return value; }
      };
      for (const stylesheet of stylesheets) {
        let cssText = stylesheet.text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, rawUrl) => (
          `url("${resolveCssAsset(rawUrl, stylesheet.url)}")`
        ));
        cssText = cssText.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote, rawUrl) => (
          `@import url("${resolveCssAsset(rawUrl, stylesheet.url)}")`
        ));
        const dataUrl = `data:text/css;base64,${Buffer.from(cssText, 'utf8').toString('base64')}`;
        for (const alias of stylesheet.aliases || [stylesheet.url]) assets.set(alias, dataUrl);
      }
      for (const url of [...new Set(additionalUrls)]) {
        if (assets.has(url) || !/^https?:\/\//i.test(String(url || ''))) continue;
        try {
          const dataUrl = await loadResourceAsDataUrlWithFallback(client, url);
          if (dataUrl) assets.set(url, dataUrl);
        } catch {}
      }
      return assets;
    },
    stylesheetStatus(requestedUrls = []) {
      const statusByRequest = [...requests.entries()].map(([requestId, request]) => {
        const response = responses.get(requestId);
        const responseUrl = response?.url || request.responseUrl || request.url;
        return {
          url: request.url,
          aliases: [responseUrl],
          completed: completed.has(requestId),
          captured: capturedStylesheets.has(canonicalStylesheetUrl(responseUrl)),
          failed: failures.has(requestId),
          errorText: failures.get(requestId)?.errorText || '',
        };
      });
      return summarizeStylesheetCapture(requestedUrls, statusByRequest);
    },
    fontStatus() {
      const statuses = [...fontRequests.entries()].map(([requestId, request]) => {
        const response = responses.get(requestId);
        const responseUrl = response?.url || request.responseUrl || request.url;
        return {
          url: request.url,
          captured: capturedFonts.has(canonicalStylesheetUrl(responseUrl)),
          failed: failures.has(requestId),
          errorText: failures.get(requestId)?.errorText || '',
        };
      });
      return summarizeFontCapture(statuses);
    },
    networkStatus() {
      return summarizeCriticalNetworkFailures(allRequests, failures);
    },
    close() {
      offRequest?.();
      offResponse?.();
      offFinished?.();
      offFailed?.();
    },
  };
}

async function settleVisualDocument(client) {
  const result = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const bigCommerceImageFallbackCandidates = ${bigCommerceImageFallbackCandidates.toString()};
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const phaseTimings = {};
      const capturedDocument = document.documentElement.hasAttribute('data-matbox-source-client-width');
      let phaseStarted = performance.now();
      const imageDeadlines = new WeakMap();
      const imageSources = new WeakMap();
      let imageWaitBudgetMs = 5000;
      const isRenderRelevantImage = (image) => {
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const waitForImage = async (image) => {
        const source = image.currentSrc || image.src || '';
        if (imageSources.get(image) !== source) {
          imageSources.set(image, source);
          imageDeadlines.set(image, performance.now() + imageWaitBudgetMs);
        }
        const remaining = () => Math.max(0, (imageDeadlines.get(image) || performance.now()) - performance.now());
        if (!image.complete && remaining() > 0) await Promise.race([
          new Promise((resolve) => image.addEventListener('load', resolve, { once: true })),
          new Promise((resolve) => image.addEventListener('error', resolve, { once: true })),
          pause(remaining()),
        ]);
        if (image.complete && image.decode && remaining() > 0) {
          try { await Promise.race([image.decode(), pause(remaining())]); } catch {}
        }
      };
      const stylesheetLinks = () => Array.from(document.querySelectorAll('link[rel~="stylesheet"],style[data-matbox-frozen-stylesheet]'));
      let stylesheetRetries = 0;
      for (let attempt = 0; attempt < 2; attempt++) {
        const pending = stylesheetLinks().filter((link) => !link.sheet);
        if (!pending.length) break;
        stylesheetRetries += pending.length;
        await Promise.all(pending.map((link) => new Promise((resolve) => {
          const replacement = link.cloneNode(true);
          replacement.media = 'all';
          replacement.removeAttribute('onload');
          const done = () => resolve();
          replacement.addEventListener('load', done, { once: true });
          replacement.addEventListener('error', done, { once: true });
          link.replaceWith(replacement);
          setTimeout(done, 5000);
        })));
      }
      let fontsReady = true;
      try { if (document.fonts?.ready) await document.fonts.ready; } catch { fontsReady = false; }
      phaseTimings.stylesAndFontsMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      const initialImages = Array.from(document.images);
      const initialRelevantImageCount = initialImages.filter(isRenderRelevantImage).length;
      // Large storefronts queue many image requests behind the browser's per-origin
      // connection limit. Give those queued requests bounded extra time, while a
      // small page (including a single hung image) keeps the original 5s deadline.
      imageWaitBudgetMs += Math.min(15000, Math.max(0, initialRelevantImageCount - 20) * 150);
      for (const image of initialImages) {
        if (!isRenderRelevantImage(image)) continue;
        image.loading = 'eager';
        const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
        const declaredSource = image.getAttribute('src');
        const declaredSrcset = image.getAttribute('srcset');
        if ((!declaredSource || !declaredSource.trim()) && !declaredSrcset && !deferred) {
          image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
          image.setAttribute('data-matbox-empty-image-placeholder', 'true');
        }
        if (!capturedDocument && deferred && (!image.getAttribute('src') || image.getAttribute('src').startsWith('data:'))) image.src = deferred;
      }
      await Promise.all(initialImages.filter(isRenderRelevantImage).map(waitForImage));
      phaseTimings.initialImagesMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      const step = Math.max(320, Math.floor(innerHeight * 0.8));
      const bottom = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      let lazyScrollSteps = 0;
      for (let y = 0; y <= bottom && lazyScrollSteps < 80; y += step) {
        scrollTo(0, Math.min(y, bottom));
        await paint();
        await pause(40);
        lazyScrollSteps += 1;
      }
      if (bottom > 0 && scrollY !== bottom) {
        scrollTo(0, bottom);
        await paint();
        await pause(40);
        lazyScrollSteps += 1;
      }
      phaseTimings.lazyScrollMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      const images = Array.from(document.images);
      await Promise.all(images.filter(isRenderRelevantImage).map(waitForImage));
      let bigCommerceImageFallbacks = 0;
      let linkedPageImageFallbacks = 0;
      for (const image of images) {
        if (!isRenderRelevantImage(image) || !image.complete || image.naturalWidth > 0) continue;
        const originalSource = image.currentSrc || image.src || image.dataset.src || '';
        const candidates = bigCommerceImageFallbackCandidates(originalSource);
        const originalSrcset = image.getAttribute('srcset');
        image.setAttribute('data-matbox-original-source-url', originalSource);
        image.removeAttribute('srcset');
        const pictureSources = Array.from(image.closest('picture')?.querySelectorAll('source') || []);
        const pictureSourceSets = pictureSources.map((source) => source.getAttribute('srcset'));
        for (const source of pictureSources) source.removeAttribute('srcset');
        for (const candidate of candidates) {
          image.src = candidate;
          await waitForImage(image);
          if (image.complete && image.naturalWidth > 0) {
            bigCommerceImageFallbacks += 1;
            break;
          }
        }
        if (!(image.complete && image.naturalWidth > 0)) {
          const anchor = image.closest('a[href]');
          const label = String(image.alt || anchor?.textContent || '').trim().replace(/\\s+/g, ' ').toLowerCase();
          try {
            const targetUrl = anchor ? new URL(anchor.href, location.href) : null;
            if (targetUrl && targetUrl.origin === location.origin && targetUrl.pathname !== location.pathname) {
              const response = await fetch(targetUrl.href, { credentials: 'same-origin' });
              const contentType = response.headers.get('content-type') || '';
              if (response.ok && /text\\/html/i.test(contentType)) {
                const targetDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
                const heading = String(targetDocument.querySelector('h1')?.textContent || targetDocument.title || '')
                  .trim().replace(/\\s+/g, ' ').toLowerCase();
                if (!label || !heading || heading.includes(label) || label.includes(heading)) {
                  const labeledImages = Array.from(targetDocument.querySelectorAll('img'))
                    .map((node) => {
                      const alt = String(node.getAttribute('alt') || '').trim().replace(/\\s+/g, ' ').toLowerCase();
                      const score = alt && heading && alt === heading ? 4
                        : alt && heading && (alt.includes(heading) || heading.includes(alt)) ? 3
                          : alt && label && alt === label ? 2
                            : alt && label && (alt.includes(label) || label.includes(alt)) ? 1
                              : 0;
                      const srcset = String(node.getAttribute('srcset') || '').split(',')[0]?.trim().split(/\\s+/)[0] || '';
                      return { score, source: node.getAttribute('src') || node.dataset.src || srcset };
                    })
                    .filter((entry) => entry.score > 0 && entry.source)
                    .sort((left, right) => right.score - left.score)
                    .map((entry) => entry.source);
                  const declared = [
                    targetDocument.querySelector('meta[property="og:image"]')?.content,
                    targetDocument.querySelector('meta[name="twitter:image"]')?.content,
                    ...labeledImages,
                  ].filter(Boolean);
                  for (const value of declared) {
                    const candidate = new URL(value, targetUrl.href).href;
                    if (!/^https?:\\/\\//i.test(candidate)) continue;
                    image.src = candidate;
                    await waitForImage(image);
                    if (image.complete && image.naturalWidth > 0) {
                      image.setAttribute('data-matbox-linked-page-image', targetUrl.href);
                      linkedPageImageFallbacks += 1;
                      break;
                    }
                  }
                }
              }
            }
          } catch {}
        }
        if (!(image.complete && image.naturalWidth > 0)) {
          image.src = originalSource;
          if (originalSrcset !== null) image.setAttribute('srcset', originalSrcset);
          pictureSources.forEach((source, index) => {
            if (pictureSourceSets[index] !== null) source.setAttribute('srcset', pictureSourceSets[index]);
          });
          await waitForImage(image);
        }
      }
      let normalizedLazyImages = 0;
      for (const image of images) {
        if (!image.complete || image.naturalWidth <= 0 || !image.classList.contains('lazyload')) continue;
        image.classList.remove('lazyload', 'lazyloading');
        image.classList.add('lazyloaded');
        normalizedLazyImages += 1;
      }
      if (normalizedLazyImages > 0) {
        await paint();
        await pause(50);
      }
      phaseTimings.finalImagesMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      const backgroundSources = new Set();
      const collectBackgroundUrls = (value) => {
        if (!value || value === 'none') return;
        const pattern = /url\\((?:"([^"]*)"|'([^']*)'|([^)]*))\\)/g;
        for (const match of value.matchAll(pattern)) {
          const source = String(match[1] || match[2] || match[3] || '').trim();
          if (source) backgroundSources.add(source);
        }
      };
      for (const element of Array.from(document.querySelectorAll('body *'))) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        collectBackgroundUrls(style.backgroundImage);
        for (const pseudo of ['::before', '::after']) {
          const pseudoStyle = getComputedStyle(element, pseudo);
          if (pseudoStyle.content !== 'none' || pseudoStyle.backgroundImage !== 'none') collectBackgroundUrls(pseudoStyle.backgroundImage);
        }
      }
      const backgroundResults = await Promise.all(Array.from(backgroundSources).map((source) => new Promise((resolve) => {
        if (source.startsWith('data:')) {
          resolve({ source, status: 'loaded' });
          return;
        }
        const image = new Image();
        let settled = false;
        const done = (status) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({ source, status });
        };
        const timer = setTimeout(() => done('pending'), Math.min(10000, imageWaitBudgetMs));
        image.addEventListener('load', () => done('loaded'), { once: true });
        image.addEventListener('error', () => done('failed'), { once: true });
        image.decoding = 'async';
        image.src = source;
        if (image.complete && image.naturalWidth > 0) done('loaded');
      })));
      if (backgroundResults.length > 0) {
        await paint();
        await pause(50);
      }
      phaseTimings.backgroundImagesMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      const rasterize = (media, width, height, { rejectFlatWhite = false } = {}) => {
        if (!width || !height) return null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          context.drawImage(media, 0, 0, width, height);
          if (rejectFlatWhite) {
            const sample = context.getImageData(0, 0, Math.min(width, 32), Math.min(height, 32)).data;
            let opaqueWhitePixels = 0;
            let sampledPixels = 0;
            for (let index = 0; index < sample.length; index += 4) {
              sampledPixels += 1;
              if (sample[index + 3] >= 250 && sample[index] >= 248 && sample[index + 1] >= 248 && sample[index + 2] >= 248) {
                opaqueWhitePixels += 1;
              }
            }
            if (sampledPixels > 0 && opaqueWhitePixels / sampledPixels >= 0.995) return null;
          }
          return { canvas, dataUrl: canvas.toDataURL('image/png') };
        } catch { return null; }
      };
      const rasterizePoster = async (video) => {
        const poster = video.currentPoster || video.poster || video.getAttribute('poster');
        if (!poster) return null;
        const image = new Image();
        image.src = poster;
        await waitForImage(image);
        return rasterize(image, image.naturalWidth, image.naturalHeight);
      };
      const copyPresentation = (source, target) => {
        for (const attribute of Array.from(source.attributes)) {
          if (!['src','srcset','poster','autoplay','loop','muted','playsinline','preload','loading','width','height'].includes(attribute.name)) target.setAttribute(attribute.name, attribute.value);
        }
        const computed = getComputedStyle(source);
        for (const property of [
          'display','box-sizing','width','height','min-width','min-height','max-width','max-height','aspect-ratio',
          'position','top','right','bottom','left','inset','z-index','object-fit','object-position',
          'margin-top','margin-right','margin-bottom','margin-left','border-radius','transform','transform-origin',
          'opacity','visibility','clip-path'
        ]) {
          const value = computed.getPropertyValue(property);
          if (value) target.style.setProperty(property, value);
        }
        const sourceRect = source.getBoundingClientRect();
        const parentRect = source.parentElement?.getBoundingClientRect();
        if (parentRect?.width > 0 && Math.abs(sourceRect.width - parentRect.width) <= 1) {
          target.style.setProperty('width', '100%');
        }
        if (parentRect?.height > 0 && Math.abs(sourceRect.height - parentRect.height) <= 1) {
          target.style.setProperty('height', '100%');
        }
      };
      let frozenDynamicMedia = 0;
      let decodedDynamicMedia = 0;
      for (const image of images) {
        if (!/\.gif(?:$|[?#])/i.test(image.currentSrc || image.src || '')) continue;
        const frozen = rasterize(image, image.naturalWidth, image.naturalHeight);
        if (!frozen) continue;
        copyPresentation(image, frozen.canvas);
        frozen.canvas.setAttribute('data-matbox-frozen-media', 'true');
        frozen.canvas.setAttribute('data-matbox-frozen-src', frozen.dataUrl);
        image.replaceWith(frozen.canvas);
        decodedDynamicMedia += 1;
        frozenDynamicMedia += 1;
      }
      for (const video of Array.from(document.querySelectorAll('video'))) {
        try { video.pause(); } catch {}
        const alreadyFrozen = video.getAttribute('data-matbox-frozen-video') === 'true';
        const frozen = alreadyFrozen
          ? (await rasterizePoster(video) || rasterize(video, video.videoWidth, video.videoHeight, { rejectFlatWhite: true }))
          : (rasterize(video, video.videoWidth, video.videoHeight, { rejectFlatWhite: true }) || await rasterizePoster(video));
        if (!frozen) continue;
        copyPresentation(video, frozen.canvas);
        frozen.canvas.style.setProperty('vertical-align', 'top');
        frozen.canvas.setAttribute('data-matbox-frozen-media', 'true');
        frozen.canvas.setAttribute('data-matbox-frozen-video', 'true');
        frozen.canvas.setAttribute('data-matbox-frozen-src', frozen.dataUrl);
        video.replaceWith(frozen.canvas);
        decodedDynamicMedia += 1;
        frozenDynamicMedia += 1;
      }
      phaseTimings.dynamicMediaMs = Math.round(performance.now() - phaseStarted);
      phaseStarted = performance.now();
      document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
      document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
      try { window.lenis?.stop?.(); } catch {}
      try { window.lenis?.scrollTo?.(0, { immediate: true, force: true, lock: true }); } catch {}
      for (let attempt = 0; attempt < 4 && scrollY !== 0; attempt++) {
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
        try { scrollTo({ top: 0, left: 0, behavior: 'instant' }); } catch { try { scrollTo(0, 0); } catch {} }
        await paint();
        await pause(50);
      }
      await paint();
      await pause(100);
      phaseTimings.originResetMs = Math.round(performance.now() - phaseStarted);
      const relevantImages = images.filter(isRenderRelevantImage);
      const readySources = new Set(relevantImages
        .filter((image) => image.complete && image.naturalWidth > 0)
        .map((image) => image.currentSrc || image.src || '')
        .filter(Boolean));
      // Lazy loaders can replace an already decoded URL with the same URL and
      // temporarily flip complete back to false. If naturalWidth is present,
      // the browser still has drawable pixels and the capture is not pending.
      const pendingImageNodes = relevantImages.filter((image) => !image.complete && image.naturalWidth <= 0);
      return {
        fontsReady,
        lazyScrollSteps: Math.max(1, lazyScrollSteps),
        imageCount: images.length,
        pendingImages: pendingImageNodes.length,
        pendingImagesWithReadyPeer: pendingImageNodes.filter((image) => readySources.has(image.currentSrc || image.src || '')).length,
        pendingImagesWithoutReadyPeer: pendingImageNodes.filter((image) => !readySources.has(image.currentSrc || image.src || '')).length,
        pendingImageDetails: pendingImageNodes.slice(0, 20).map((image) => {
          const rect = image.getBoundingClientRect();
          return {
            src: image.currentSrc || image.src || '',
            declaredSrc: image.getAttribute('src') || '',
            declaredSrcset: image.getAttribute('srcset') || '',
            deferredSrc: image.dataset.src || image.dataset.lazySrc || image.dataset.original || '',
            outerHTML: image.outerHTML.slice(0, 500),
            loading: image.loading || '',
            naturalWidth: image.naturalWidth,
            naturalHeight: image.naturalHeight,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
        failedImages: images.filter((image) => isRenderRelevantImage(image) && image.complete && image.naturalWidth === 0).length,
        failedImageDetails: images.filter((image) => isRenderRelevantImage(image) && image.complete && image.naturalWidth === 0).slice(0, 20).map((image) => {
          const rect = image.getBoundingClientRect();
          return {
            src: image.currentSrc || image.src || '',
            declaredSrc: image.getAttribute('src') || '',
            declaredSrcset: image.getAttribute('srcset') || '',
            deferredSrc: image.dataset.src || image.dataset.lazySrc || image.dataset.original || '',
            outerHTML: image.outerHTML.slice(0, 500),
            loading: image.loading || '',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }),
        backgroundImageCount: backgroundResults.length,
        pendingBackgroundImages: backgroundResults.filter((item) => item.status === 'pending').length,
        failedBackgroundImages: backgroundResults.filter((item) => item.status === 'failed').length,
        pendingBackgroundImageDetails: backgroundResults.filter((item) => item.status !== 'loaded').slice(0, 20),
        stylesheetCount: stylesheetLinks().length,
        pendingStylesheets: stylesheetLinks().filter((link) => !link.sheet).length,
        stylesheetRetries,
        frozenDynamicMedia,
        decodedDynamicMedia,
        failedDynamicMediaDecodes: frozenDynamicMedia - decodedDynamicMedia,
        normalizedLazyImages,
        bigCommerceImageFallbacks,
        linkedPageImageFallbacks,
        finalScrollY: Math.round(scrollY),
        documentHeight: document.documentElement.scrollHeight,
        viewportWidth: innerWidth,
        documentWidth: Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0),
        horizontalOverflowPx: Math.max(0, Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) - innerWidth),
        phaseTimings,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value ?? { fontsReady: false, lazyScrollSteps: 0, imageCount: 0, pendingImages: 0, documentHeight: 0 };
}

async function freezeVisibleVideosWithScreenshot(client) {
  const discovered = await client.send('Runtime.evaluate', {
    expression: `(() => Array.from(document.querySelectorAll('video'))
      .filter((video) => video.getAttribute('data-matbox-frozen-video') !== 'true')
      .map((video, index) => {
        const rect = video.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || getComputedStyle(video).visibility === 'hidden') return null;
        const id = 'matbox-browser-video-' + index;
        video.setAttribute('data-matbox-video-freeze-id', id);
        try { video.pause(); } catch {}
        return { id, x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
      }).filter(Boolean))()`,
    returnByValue: true,
  });
  const videos = discovered.result?.value ?? [];
  let frozen = 0;
  for (const video of videos) {
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const id = ${JSON.stringify(video.id)};
        const target = Array.from(document.querySelectorAll('video')).find((item) => item.getAttribute('data-matbox-video-freeze-id') === id);
        if (!target) return false;
        const targetRect = target.getBoundingClientRect();
        const intersects = (rect) => rect.right > targetRect.left && rect.left < targetRect.right && rect.bottom > targetRect.top && rect.top < targetRect.bottom;
        for (const candidate of document.querySelectorAll('body *')) {
          if (candidate === target || candidate.contains(target) || target.contains(candidate)) continue;
          const style = getComputedStyle(candidate);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) continue;
          const rect = candidate.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || !intersects(rect)) continue;
          candidate.setAttribute('data-matbox-video-freeze-occluder', id);
        }
        for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
          ancestor.setAttribute('data-matbox-video-freeze-ancestor', id);
        }
        const style = document.createElement('style');
        style.id = 'matbox-video-freeze-isolation';
        style.textContent =
          '[data-matbox-video-freeze-occluder="' + CSS.escape(id) + '"]{visibility:hidden!important}' +
          '[data-matbox-video-freeze-ancestor="' + CSS.escape(id) + '"]::before,' +
          '[data-matbox-video-freeze-ancestor="' + CSS.escape(id) + '"]::after{visibility:hidden!important}';
        document.head.appendChild(style);
        return true;
      })()`,
      returnByValue: true,
    });
    await client.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      awaitPromise: true,
      returnByValue: true,
    });
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, video.x),
        y: Math.max(0, video.y),
        width: Math.max(1, video.width),
        height: Math.max(1, video.height),
        scale: 1,
      },
    });
    const poster = `data:image/png;base64,${shot.data}`;
    const applied = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const id = ${JSON.stringify(video.id)};
        document.getElementById('matbox-video-freeze-isolation')?.remove();
        document.querySelectorAll('[data-matbox-video-freeze-occluder]').forEach((item) => item.removeAttribute('data-matbox-video-freeze-occluder'));
        document.querySelectorAll('[data-matbox-video-freeze-ancestor]').forEach((item) => item.removeAttribute('data-matbox-video-freeze-ancestor'));
        const node = Array.from(document.querySelectorAll('video')).find((item) => item.getAttribute('data-matbox-video-freeze-id') === id);
        if (!node) return false;
        try { node.pause(); } catch {}
        const image = document.createElement('img');
        for (const attribute of Array.from(node.attributes)) {
          if (!['src','srcset','poster','autoplay','loop','muted','playsinline','preload','loading','width','height','data-matbox-video-freeze-id'].includes(attribute.name)) {
            image.setAttribute(attribute.name, attribute.value);
          }
        }
        const computed = getComputedStyle(node);
        for (const property of [
          'display','box-sizing','width','height','min-width','min-height','max-width','max-height','aspect-ratio',
          'position','top','right','bottom','left','inset','z-index','object-fit','object-position',
          'margin-top','margin-right','margin-bottom','margin-left','border-radius','transform','transform-origin',
          'opacity','visibility','clip-path','vertical-align'
        ]) {
          const value = computed.getPropertyValue(property);
          if (value) image.style.setProperty(property, value);
        }
        const sourceRect = node.getBoundingClientRect();
        const parentRect = node.parentElement?.getBoundingClientRect();
        if (parentRect?.width > 0 && Math.abs(sourceRect.width - parentRect.width) <= 1) image.style.setProperty('width', '100%');
        if (parentRect?.height > 0 && Math.abs(sourceRect.height - parentRect.height) <= 1) image.style.setProperty('height', '100%');
        image.style.setProperty('vertical-align', 'top');
        image.setAttribute('src', ${JSON.stringify(poster)});
        image.setAttribute('alt', '');
        image.setAttribute('data-matbox-frozen-video', 'true');
        image.setAttribute('data-matbox-frozen-media', 'true');
        node.replaceWith(image);
        return true;
      })()`,
      returnByValue: true,
    });
    if (applied.result?.value) frozen += 1;
  }
  if (frozen) {
    await client.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
  }
  return frozen;
}

async function settleFrozenMediaPaint(client) {
  await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const images = Array.from(document.querySelectorAll('img[data-matbox-frozen-video="true"],img[data-matbox-frozen-iframe="true"]'));
      await Promise.all(images.map(async (image) => {
        if (!image.complete) await new Promise((resolve) => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
        if (image.decode) { try { await image.decode(); } catch {} }
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
}

async function freezeVisibleIframesWithScreenshot(client) {
  const discovered = await client.send('Runtime.evaluate', {
    expression: `(() => Array.from(document.querySelectorAll('iframe'))
      .filter((frame) => frame.getAttribute('data-matbox-frozen-iframe') !== 'true')
      .map((frame, index) => {
        const rect = frame.getBoundingClientRect();
        const style = getComputedStyle(frame);
        if (rect.width < 32 || rect.height < 32 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return null;
        const id = 'matbox-browser-iframe-' + index;
        frame.setAttribute('data-matbox-iframe-freeze-id', id);
        return { id, x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
      }).filter(Boolean))()`,
    returnByValue: true,
  });
  const frames = discovered.result?.value ?? [];
  let frozen = 0;
  for (const frame of frames) {
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, frame.x),
        y: Math.max(0, frame.y),
        width: Math.max(1, frame.width),
        height: Math.max(1, frame.height),
        scale: 1,
      },
    });
    const imageSource = `data:image/png;base64,${shot.data}`;
    const applied = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const id = ${JSON.stringify(frame.id)};
        const node = Array.from(document.querySelectorAll('iframe')).find((item) => item.getAttribute('data-matbox-iframe-freeze-id') === id);
        if (!node) return false;
        const image = document.createElement('img');
        const computed = getComputedStyle(node);
        for (const property of [
          'display','box-sizing','width','height','min-width','min-height','max-width','max-height','aspect-ratio',
          'position','top','right','bottom','left','inset','z-index','object-fit','object-position',
          'margin-top','margin-right','margin-bottom','margin-left','border','border-radius','transform','transform-origin',
          'opacity','visibility','clip-path','vertical-align'
        ]) {
          const value = computed.getPropertyValue(property);
          if (value) image.style.setProperty(property, value);
        }
        if (computed.position === 'fixed') {
          const rect = node.getBoundingClientRect();
          const rightGap = Math.max(0, innerWidth - rect.right);
          const bottomGap = Math.max(0, innerHeight - rect.bottom);
          const anchorRight = rect.left >= innerWidth / 2 && rightGap <= 128;
          const anchorBottom = rect.top >= innerHeight / 2 && bottomGap <= 128;
          if (anchorRight || anchorBottom) image.style.removeProperty('inset');
          if (anchorRight) {
            image.style.setProperty('left', 'auto');
            image.style.setProperty('right', rightGap + 'px');
          }
          if (anchorBottom) {
            image.style.setProperty('top', 'auto');
            image.style.setProperty('bottom', bottomGap + 'px');
          }
        }
        image.setAttribute('src', ${JSON.stringify(imageSource)});
        image.setAttribute('alt', node.getAttribute('title') || '');
        image.setAttribute('data-matbox-frozen-iframe', 'true');
        image.setAttribute('data-matbox-iframe-freeze-id', id);
        node.replaceWith(image);
        return true;
      })()`,
      returnByValue: true,
    });
    if (applied.result?.value) frozen += 1;
  }
  if (frozen) {
    await client.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
  }
  return frozen;
}

async function freezeUncapturedVisibleImagesWithScreenshot(client, capturedSources = []) {
  const rasterized = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const captured = new Set(${JSON.stringify(capturedSources)});
      let count = 0;
      for (const image of Array.from(document.images)) {
        const source = image.currentSrc || image.src || '';
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        if (!source || source.startsWith('data:') || captured.has(source)) continue;
        if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || rect.width < 32 || rect.height < 32) continue;
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) continue;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          const frozenSource = canvas.toDataURL('image/png');
          if (!frozenSource || frozenSource === 'data:,') continue;
          if (/^(?:https?:|\\\/)/i.test(source)) image.setAttribute('data-matbox-original-src', source);
          image.setAttribute('src', frozenSource);
          image.setAttribute('data-src', frozenSource);
          image.removeAttribute('srcset');
          image.removeAttribute('data-srcset');
          image.closest('picture')?.querySelectorAll('source').forEach((item) => {
            item.removeAttribute('src');
            item.removeAttribute('srcset');
            item.removeAttribute('data-src');
            item.removeAttribute('data-srcset');
          });
          image.setAttribute('data-matbox-browser-frozen-image', 'true');
          image.setAttribute('data-matbox-browser-rasterized-image', 'true');
          count += 1;
        } catch {}
      }
      return count;
    })()`,
    returnByValue: true,
  });
  const rasterizedCount = Number(rasterized.result?.value || 0);
  const discovered = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const captured = new Set(${JSON.stringify(capturedSources)});
      return Array.from(document.images).map((image, index) => {
        const source = image.currentSrc || image.src || '';
        const rect = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        if (!source || source.startsWith('data:') || captured.has(source)) return null;
        if (!image.complete || image.naturalWidth <= 0 || rect.width < 32 || rect.height < 32) return null;
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return null;
        const id = 'matbox-browser-image-' + index;
        image.setAttribute('data-matbox-image-freeze-id', id);
        let critical = false;
        for (let ancestor = image; ancestor; ancestor = ancestor.parentElement) {
          const identity = [ancestor.tagName, ancestor.id, ancestor.className, ancestor.getAttribute?.('role')]
            .filter((value) => typeof value === 'string')
            .join(' ');
          if (/^(?:HEADER|NAV)$/i.test(ancestor.tagName)
            || ancestor.getAttribute?.('role') === 'navigation'
            || /mega[-_ ]?menu|megamenu|navpage-submenu|site[-_ ]?header|header[-_ ]?menu/i.test(identity)) {
            critical = true;
            break;
          }
        }
        return {
          id,
          source,
          critical,
          x: rect.left + scrollX,
          y: rect.top + scrollY,
          width: rect.width,
          height: rect.height,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          authoredWidth: image.getAttribute('width') || '',
          authoredHeight: image.getAttribute('height') || '',
        };
      }).filter(Boolean);
    })()`,
    returnByValue: true,
  });
  const images = discovered.result?.value ?? [];
  let frozen = 0;
  for (const image of images) {
    if (image.critical) {
      throw new Error(`Critical image capture failed: ${image.source || image.id}. Page-screenshot fallback is forbidden for navigation imagery.`);
    }
    await client.send('Runtime.evaluate', {
      expression: `(() => {
        const id = ${JSON.stringify(image.id)};
        const target = Array.from(document.images).find((item) => item.getAttribute('data-matbox-image-freeze-id') === id);
        if (!target) return false;
        const targetRect = target.getBoundingClientRect();
        const intersects = (rect) => rect.right > targetRect.left && rect.left < targetRect.right && rect.bottom > targetRect.top && rect.top < targetRect.bottom;
        for (const candidate of document.querySelectorAll('body *')) {
          if (candidate === target || candidate.contains(target) || target.contains(candidate)) continue;
          const style = getComputedStyle(candidate);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) continue;
          const rect = candidate.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || !intersects(rect)) continue;
          // Browser hit testing intentionally omits pointer-events:none nodes.
          // Storefront captions commonly use that rule, so a stack-based check
          // bakes the caption into the image and the live caption appears twice
          // when the replay is rendered at another width. Isolate the image by
          // hiding every intersecting non-ancestor/non-descendant element.
          candidate.setAttribute('data-matbox-image-freeze-occluder', id);
        }
        for (let ancestor = target.parentElement; ancestor; ancestor = ancestor.parentElement) {
          ancestor.setAttribute('data-matbox-image-freeze-ancestor', id);
        }
        const style = document.createElement('style');
        style.id = 'matbox-image-freeze-isolation';
        style.textContent =
          '[data-matbox-image-freeze-occluder="' + CSS.escape(id) + '"]{visibility:hidden!important}' +
          '[data-matbox-image-freeze-ancestor="' + CSS.escape(id) + '"]::before,' +
          '[data-matbox-image-freeze-ancestor="' + CSS.escape(id) + '"]::after{visibility:hidden!important}';
        document.head.appendChild(style);
        return true;
      })()`,
      returnByValue: true,
    });
    await client.send('Runtime.evaluate', {
      expression: `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`,
      awaitPromise: true,
      returnByValue: true,
    });
    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, image.x),
        y: Math.max(0, image.y),
        width: Math.max(1, image.width),
        height: Math.max(1, image.height),
        scale: 1,
      },
    });
    const imageSource = `data:image/png;base64,${shot.data}`;
    const applied = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const id = ${JSON.stringify(image.id)};
        document.getElementById('matbox-image-freeze-isolation')?.remove();
        document.querySelectorAll('[data-matbox-image-freeze-occluder]').forEach((item) => item.removeAttribute('data-matbox-image-freeze-occluder'));
        document.querySelectorAll('[data-matbox-image-freeze-ancestor]').forEach((item) => item.removeAttribute('data-matbox-image-freeze-ancestor'));
        const node = Array.from(document.images).find((item) => item.getAttribute('data-matbox-image-freeze-id') === id);
        if (!node) return false;
        const source = ${JSON.stringify(imageSource)};
        const originalSource = ${JSON.stringify(image.source)};
        const originalNaturalWidth = ${JSON.stringify(image.naturalWidth)};
        const originalNaturalHeight = ${JSON.stringify(image.naturalHeight)};
        const renderedWidth = ${JSON.stringify(image.width)};
        const renderedHeight = ${JSON.stringify(image.height)};
        const authoredWidth = ${JSON.stringify(image.authoredWidth)};
        const authoredHeight = ${JSON.stringify(image.authoredHeight)};
        if (/^(?:https?:|\\\/)/i.test(originalSource)) node.setAttribute('data-matbox-original-src', originalSource);
        node.setAttribute('data-matbox-original-natural-width', String(originalNaturalWidth));
        node.setAttribute('data-matbox-original-natural-height', String(originalNaturalHeight));
        // A screenshot fallback bitmap has the rendered box dimensions, not the
        // source image's intrinsic dimensions. Flex and grid items with auto
        // sizing use that intrinsic width, so replaying at a wider viewport can
        // incorrectly fit extra columns. Preserve the source sizing semantics
        // with low-specificity HTML dimensions; authored dimensions still win.
        if (!authoredWidth && originalNaturalWidth > 0) node.setAttribute('width', String(Math.round(originalNaturalWidth)));
        if (!authoredHeight && originalNaturalWidth > 0 && renderedWidth > 0 && renderedHeight > 0) {
          node.setAttribute('height', String(Math.max(1, Math.round(originalNaturalWidth * renderedHeight / renderedWidth))));
        }
        node.setAttribute('src', source);
        node.setAttribute('data-src', source);
        node.removeAttribute('srcset');
        node.removeAttribute('data-srcset');
        node.closest('picture')?.querySelectorAll('source').forEach((item) => {
          item.removeAttribute('src');
          item.removeAttribute('srcset');
          item.removeAttribute('data-src');
          item.removeAttribute('data-srcset');
        });
        node.setAttribute('data-matbox-browser-frozen-image', 'true');
        node.setAttribute('data-matbox-browser-screenshot-image', 'true');
        return true;
      })()`,
      returnByValue: true,
    });
    if (applied.result?.value) frozen += 1;
  }
  if (frozen) {
    await client.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
  }
  return rasterizedCount + frozen;
}

async function visibleExternalImageSources(client) {
  const result = await client.send('Runtime.evaluate', {
    expression: `(() => Array.from(document.images).map((image) => {
      const source = image.currentSrc || image.src || '';
      const rect = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      if (!/^https?:\\/\\//i.test(source)) return null;
      if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || rect.width < 32 || rect.height < 32) return null;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) === 0) return null;
      return source;
    }).filter(Boolean))()`,
    returnByValue: true,
  });
  return [...new Set(result.result?.value || [])];
}

async function externalStylesheetSources(client) {
  const result = await client.send('Runtime.evaluate', {
    expression: `(() => Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'))
      .filter((link) => !link.disabled && (!link.media || matchMedia(link.media).matches))
      .map((link) => link.href)
      .filter((href) => /^https?:\\/\\//i.test(href)))()`,
    returnByValue: true,
  });
  return [...new Set(result.result?.value || [])];
}

export async function coordinateVisualAndObservedReadiness({
  settleVisual,
  waitObserved,
  sampleState,
  now = () => Date.now(),
}) {
  if (typeof settleVisual !== 'function' || typeof waitObserved !== 'function' || typeof sampleState !== 'function') {
    throw new TypeError('Coordinated readiness requires settleVisual, waitObserved, and sampleState functions');
  }
  const startedAt = now();
  let visualCompletedSample = null;
  let visualSettlementMs = 0;
  let observedReadinessMs = 0;

  const visualTask = (async () => {
    const visualStartedAt = now();
    try {
      const readiness = await settleVisual();
      visualCompletedSample = await sampleState();
      return readiness;
    } finally {
      visualSettlementMs = now() - visualStartedAt;
    }
  })();
  const observedTask = (async () => {
    const observedStartedAt = now();
    try {
      return await waitObserved();
    } finally {
      observedReadinessMs = now() - observedStartedAt;
    }
  })();

  const [visualResult, observedResult] = await Promise.allSettled([visualTask, observedTask]);
  if (visualResult.status === 'rejected') throw visualResult.reason;
  let visualReadiness = visualResult.value;
  let observedReadiness;
  let retriedObservedReadiness = false;
  if (observedResult.status === 'rejected') {
    if (observedResult.reason?.code !== 'OBSERVED_READINESS_TIMEOUT') throw observedResult.reason;
    retriedObservedReadiness = true;
    const retryObservedStartedAt = now();
    try {
      observedReadiness = await waitObserved();
    } finally {
      observedReadinessMs += now() - retryObservedStartedAt;
    }
  } else {
    observedReadiness = observedResult.value;
  }
  const finalSample = await sampleState();
  const visualSignature = String(visualCompletedSample?.signature || '');
  const finalSignature = String(finalSample?.signature || '');
  const requiresVisualRetry = finalSample?.ready === false || visualSignature !== finalSignature;
  let retryVisualSettlementMs = 0;
  if (requiresVisualRetry) {
    const retryStartedAt = now();
    visualReadiness = await settleVisual();
    retryVisualSettlementMs = now() - retryStartedAt;
  }

  return {
    visualReadiness,
    observedReadiness,
    retriedObservedReadiness,
    retriedVisualSettlement: requiresVisualRetry,
    visualSettlementMs,
    observedReadinessMs,
    retryVisualSettlementMs,
    coordinatedReadinessMs: now() - startedAt,
  };
}

async function collectArtifacts(client, options = {}) {
  const replayProfile = options.artifactProfile === 'replay';
  const hideRootScrollbar = options.hideRootScrollbar !== false;
  const collectStartedAt = Date.now();
  const captureTimings = {};
  let stageStartedAt = Date.now();
  let visualReadiness;
  let observedReadiness = null;
  if (options.observedReadinessMonitor) {
    const sampleReadiness = async () => {
      const sample = await sampleObservedPageState(client);
      return {
        ...sample,
        signature: sample.contentSignature || sample.signature,
        ready: sample.documentReady !== false,
        visualResourcesDelegated: true,
      };
    };
    const coordinated = await coordinateVisualAndObservedReadiness({
      settleVisual: () => settleVisualDocument(client),
      waitObserved: () => options.observedReadinessMonitor.waitForStable({
        ...(options.observedReadiness || {}),
        sample: sampleReadiness,
      }),
      sampleState: sampleReadiness,
    });
    visualReadiness = coordinated.visualReadiness;
    observedReadiness = coordinated.observedReadiness;
    captureTimings.settleVisualDocumentMs = coordinated.visualSettlementMs;
    captureTimings.observedReadinessMs = coordinated.observedReadinessMs;
    captureTimings.coordinatedReadinessMs = coordinated.coordinatedReadinessMs;
    captureTimings.coordinatedObservedRetry = coordinated.retriedObservedReadiness ? 1 : 0;
    captureTimings.coordinatedVisualRetry = coordinated.retriedVisualSettlement ? 1 : 0;
    if (coordinated.retriedVisualSettlement) {
      captureTimings.postObservedReadinessSettleMs = coordinated.retryVisualSettlementMs;
    }
  } else {
    stageStartedAt = Date.now();
    visualReadiness = await settleVisualDocument(client);
    captureTimings.settleVisualDocumentMs = Date.now() - stageStartedAt;
  }
  if (options.afterSettleExpression) {
    stageStartedAt = Date.now();
    await client.send('Runtime.evaluate', {
      expression: options.afterSettleExpression,
      awaitPromise: true,
      returnByValue: true,
    });
    captureTimings.afterSettleExpressionMs = Date.now() - stageStartedAt;
    stageStartedAt = Date.now();
    visualReadiness = await settleVisualDocument(client);
    captureTimings.postExpressionSettleVisualDocumentMs = Date.now() - stageStartedAt;
  }
  stageStartedAt = Date.now();
  const browserFrozenVideos = await freezeVisibleVideosWithScreenshot(client);
  captureTimings.browserVideoFreezeMs = Date.now() - stageStartedAt;
  if (browserFrozenVideos > 0) {
    stageStartedAt = Date.now();
    await settleFrozenMediaPaint(client);
    captureTimings.postBrowserVideoFreezePaintMs = Date.now() - stageStartedAt;
  }
  visualReadiness.browserFrozenVideos = browserFrozenVideos;
  if (browserFrozenVideos === 0) {
    visualReadiness.frozenDynamicMedia = Number(visualReadiness.frozenDynamicMedia || 0) + browserFrozenVideos;
    visualReadiness.decodedDynamicMedia = Number(visualReadiness.decodedDynamicMedia || 0) + browserFrozenVideos;
  }
  stageStartedAt = Date.now();
  const browserFrozenIframes = await freezeVisibleIframesWithScreenshot(client);
  captureTimings.browserIframeFreezeMs = Date.now() - stageStartedAt;
  if (browserFrozenIframes > 0) {
    stageStartedAt = Date.now();
    await settleFrozenMediaPaint(client);
    captureTimings.postBrowserIframeFreezePaintMs = Date.now() - stageStartedAt;
  }
  visualReadiness.browserFrozenVideos = browserFrozenVideos;
  visualReadiness.browserFrozenIframes = browserFrozenIframes;
  stageStartedAt = Date.now();
  const frozenStateEval = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const hideRootScrollbar = ${JSON.stringify(hideRootScrollbar)};
      const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      let freeze = document.querySelector('style[data-matbox-live-freeze]');
      if (!freeze) {
        freeze = document.createElement('style');
        freeze.setAttribute('data-matbox-live-freeze', '');
        document.head.append(freeze);
      }
      freeze.textContent = '*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}[data-ticker-track],.ticker-rail__track{transform:none!important;translate:none!important}';
      const revealNodes = Array.from(document.querySelectorAll(
        '[data-reveal], [data-reveal-item], .is-reveal-pending, .is-revealing'
      ));
      for (const node of revealNodes) {
        node.classList.remove('is-reveal-pending', 'is-revealing');
        node.classList.add('is-revealed');
        node.style.setProperty('opacity', '1', 'important');
        node.style.setProperty('transform', 'none', 'important');
        node.style.setProperty('visibility', 'visible', 'important');
      }
      const precision = (value) => Number.isFinite(value) ? String(Number(value.toFixed(3))) : '0';
      const captureViewport = innerWidth <= 767 ? 'mobile' : 'desktop';
      for (const image of Array.from(document.images)) {
        const rect = image.getBoundingClientRect();
        const containerRect = image.parentElement?.getBoundingClientRect();
        const style = getComputedStyle(image);
        const visible = rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0;
        const intrinsicWidth = Number(image.getAttribute('data-matbox-original-natural-width')) || image.naturalWidth || Number(image.getAttribute('width')) || 0;
        const intrinsicHeight = Number(image.getAttribute('data-matbox-original-natural-height')) || image.naturalHeight || Number(image.getAttribute('height')) || 0;
        const overflowPx = containerRect
          ? Math.max(0, containerRect.left - rect.left, rect.right - containerRect.right, containerRect.top - rect.top, rect.bottom - containerRect.bottom)
          : 0;
        image.setAttribute('data-matbox-image-intrinsic-width', precision(intrinsicWidth));
        image.setAttribute('data-matbox-image-intrinsic-height', precision(intrinsicHeight));
        image.setAttribute('data-matbox-image-rendered-width', precision(rect.width));
        image.setAttribute('data-matbox-image-rendered-height', precision(rect.height));
        image.setAttribute('data-matbox-image-container-width', precision(containerRect?.width || 0));
        image.setAttribute('data-matbox-image-container-height', precision(containerRect?.height || 0));
        image.setAttribute('data-matbox-image-visible', String(visible));
        image.setAttribute('data-matbox-image-object-fit', style.objectFit || 'fill');
        image.setAttribute('data-matbox-image-object-position', style.objectPosition || '50% 50%');
        image.setAttribute('data-matbox-image-viewport', captureViewport);
        image.setAttribute('data-matbox-image-viewport-width', precision(innerWidth));
        image.setAttribute('data-matbox-image-viewport-height', precision(innerHeight));
        image.setAttribute('data-matbox-image-overflow-px', precision(overflowPx));
      }
      const componentEvidenceNodes = Array.from(document.querySelectorAll(
        '.shopify-section, section, [data-widget-id], main > *, [role="main"] > *, main [id], [role="main"] [id], body > [id]'
      )).filter((node, index, entries) => node instanceof HTMLElement && entries.indexOf(node) === index);
      for (const node of componentEvidenceNodes) {
        const rect = node.getBoundingClientRect();
        const parentRect = node.parentElement?.getBoundingClientRect();
        const style = getComputedStyle(node);
        const visible = rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity || 1) > 0;
        node.setAttribute('data-matbox-component-x', precision(rect.left + scrollX));
        node.setAttribute('data-matbox-component-y', precision(rect.top + scrollY));
        node.setAttribute('data-matbox-component-width', precision(rect.width));
        node.setAttribute('data-matbox-component-height', precision(rect.height));
        node.setAttribute('data-matbox-component-parent-width', precision(parentRect?.width || 0));
        node.setAttribute('data-matbox-component-parent-height', precision(parentRect?.height || 0));
        node.setAttribute('data-matbox-component-display', style.display || 'block');
        node.setAttribute('data-matbox-component-flex-direction', style.flexDirection || 'row');
        node.setAttribute('data-matbox-component-grid-columns', style.gridTemplateColumns || 'none');
        node.setAttribute('data-matbox-component-gap', style.gap || 'normal');
        node.setAttribute('data-matbox-component-justify-content', style.justifyContent || 'normal');
        node.setAttribute('data-matbox-component-align-items', style.alignItems || 'normal');
        node.setAttribute('data-matbox-component-viewport', captureViewport);
        node.setAttribute('data-matbox-component-viewport-width', precision(innerWidth));
        node.setAttribute('data-matbox-component-viewport-height', precision(innerHeight));
        node.setAttribute('data-matbox-component-visible', visible ? 'true' : 'false');
      }
      const layoutSections = Array.from(document.querySelectorAll('.shopify-section'))
        .map((node) => ({ node, height: node.getBoundingClientRect().height }))
        .filter(({ height }) => Number.isFinite(height) && height > 0);
      for (const { node, height } of layoutSections) {
        node.style.setProperty('min-height', height + 'px', 'important');
      }
      const mainRegions = Array.from(document.querySelectorAll(
        'main > .top_level_container, [role="main"] > .top_level_container, main > [data-content-region], [role="main"] > [data-content-region], main > section, [role="main"] > section'
      ))
        .filter((node, index, entries) => entries.indexOf(node) === index)
        .filter((node) => node instanceof HTMLElement && !node.matches('script,style,.shopify-section') && !node.closest('.shopify-section'))
        .map((node) => ({ node, height: node.getBoundingClientRect().height }))
        .filter(({ height }) => Number.isFinite(height) && height > 0);
      for (const { node, height } of mainRegions) {
        node.style.setProperty('box-sizing', 'border-box', 'important');
        // Main content regions may contain viewport-relative heroes or
        // responsive grids that grow at wider/taller replay viewports. Keep
        // the captured size as a floor rather than clipping later content to
        // the capture viewport's exact height.
        node.style.setProperty('min-height', height + 'px', 'important');
        node.setAttribute('data-matbox-frozen-main-region', 'true');
      }
      const hasCollectionLandingGrid = Boolean(document.querySelector(
        'main .full_plp_top, [role="main"] .full_plp_top'
      ));
      const layoutBoxes = layoutSections.length === 0 && hasCollectionLandingGrid
        ? Array.from(document.querySelectorAll('main *, [role="main"] *'))
          .filter((node) => node instanceof HTMLElement)
          .filter((node) => {
            const display = getComputedStyle(node).display;
            return display === 'grid' || display === 'inline-grid' || display === 'flex' || display === 'inline-flex';
          })
          .flatMap((node) => [node, ...node.children])
          .filter((node, index, entries) => node instanceof HTMLElement && entries.indexOf(node) === index)
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .filter(({ rect }) => Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0)
        : [];
      const recordResponsiveWidthIntent = (node, rect) => {
        const parentRect = node.parentElement?.getBoundingClientRect();
        const parentWidth = Number.isFinite(parentRect?.width) && parentRect.width > 0
          ? parentRect.width
          : document.documentElement.clientWidth;
        const widthRatio = parentWidth > 0 ? rect.width / parentWidth : 0;
        const authoredInlineWidth = node.style.getPropertyValue('width').trim();
        const hasAuthoredFixedPixelWidth = /^\d+(?:\.\d+)?px$/i.test(authoredInlineWidth);
        const responsiveWidth = widthRatio >= 0.98 && !hasAuthoredFixedPixelWidth
          ? 'fluid'
          : 'constrained';
        node.setAttribute('data-matbox-captured-width', String(Number(rect.width.toFixed(3))));
        node.setAttribute('data-matbox-captured-parent-width', String(Number(parentWidth.toFixed(3))));
        node.setAttribute('data-matbox-width-ratio', String(Number(widthRatio.toFixed(6))));
        node.setAttribute('data-matbox-responsive-width', responsiveWidth);
      };
      for (const { node, rect } of layoutBoxes) {
        recordResponsiveWidthIntent(node, rect);
        node.style.setProperty('box-sizing', 'border-box', 'important');
        node.style.setProperty('width', rect.width + 'px', 'important');
        node.style.setProperty('height', rect.height + 'px', 'important');
        node.setAttribute('data-matbox-frozen-layout-box', 'true');
      }
      const cardGridBoxes = Array.from(document.querySelectorAll(
        '.card-grid-widget, .card-grid-widget > .productCarousel'
      ))
        .filter((node) => node instanceof HTMLElement)
        .map((node) => {
          const ownRect = node.getBoundingClientRect();
          if (ownRect.height > 0) return { node, rect: ownRect };
          const visibleDescendants = Array.from(node.querySelectorAll('*'))
            .filter((child) => child instanceof HTMLElement)
            .map((child) => ({ child, rect: child.getBoundingClientRect(), style: getComputedStyle(child) }))
            .filter(({ rect, style }) => rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden');
          const descendantBottom = visibleDescendants.reduce((bottom, item) => Math.max(bottom, item.rect.bottom), ownRect.top);
          const descendantHeight = Math.max(0, descendantBottom - ownRect.top);
          return {
            node,
            rect: {
              x: ownRect.x,
              y: ownRect.y,
              top: ownRect.top,
              right: ownRect.right,
              bottom: ownRect.top + descendantHeight,
              left: ownRect.left,
              width: ownRect.width,
              height: descendantHeight,
            },
          };
        })
        .filter(({ rect }) => Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0);
      for (const { node, rect } of cardGridBoxes) {
        recordResponsiveWidthIntent(node, rect);
        node.style.setProperty('box-sizing', 'border-box', 'important');
        node.style.setProperty('width', rect.width + 'px', 'important');
        // Card rows can become taller after responsive width restoration.
        // A fixed capture-height lets children overflow and causes the next
        // section to overlap them, so preserve only the minimum height.
        node.style.setProperty('min-height', rect.height + 'px', 'important');
        node.setAttribute('data-matbox-frozen-card-grid-box', 'true');
      }
      const scrollEffectNodes = Array.from(document.querySelectorAll(
        '.is-scroll-fx-active img, .is-scroll-fx-active video, .is-scroll-fx-active [data-scroll-fx], [data-parallax]'
      ));
      for (const node of scrollEffectNodes) {
        node.style.setProperty('transform', 'none', 'important');
        node.style.setProperty('translate', 'none', 'important');
        node.style.setProperty('scale', 'none', 'important');
        node.style.setProperty('rotate', 'none', 'important');
      }
      const motionTrackNodes = Array.from(document.querySelectorAll(
        '[data-ticker-track], .ticker-rail__track'
      ));
      for (const node of motionTrackNodes) {
        node.style.setProperty('transform', 'none', 'important');
        node.style.setProperty('translate', 'none', 'important');
        node.scrollLeft = 0;
        if (node.parentElement) node.parentElement.scrollLeft = 0;
      }
      const transformedNodes = Array.from(document.querySelectorAll('*'))
        .map((node) => ({ node, transform: getComputedStyle(node).transform }))
        .filter(({ node, transform }) => transform && transform !== 'none' && !node.closest('header, [role="banner"]'));
      for (const { node, transform } of transformedNodes) {
        node.style.setProperty('transform', transform, 'important');
      }
      const rootScrollNodes = [document.documentElement, document.body].filter(Boolean);
      for (const node of rootScrollNodes) {
        const computed = getComputedStyle(node);
        node.style.setProperty('overflow-x', computed.overflowX, 'important');
        node.style.setProperty('overflow-y', computed.overflowY, 'important');
      }
      let standardizedScrollbarGutter = 0;
      if (hideRootScrollbar && document.documentElement.scrollHeight > innerHeight) {
        document.documentElement.style.setProperty('overflow-y', 'auto', 'important');
        document.documentElement.style.setProperty('scrollbar-width', 'none', 'important');
        let hiddenScrollbar = document.querySelector('style[data-matbox-live-hidden-scrollbar]');
        if (!hiddenScrollbar) {
          hiddenScrollbar = document.createElement('style');
          hiddenScrollbar.setAttribute('data-matbox-live-hidden-scrollbar', '');
          hiddenScrollbar.textContent = 'html{scrollbar-width:none!important}html::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
          document.head.append(hiddenScrollbar);
        }
        standardizedScrollbarGutter = 1;
      }
      const headerRoots = [...new Set(Array.from(document.querySelectorAll('header, [role="banner"]')))];
      const headerNodes = [...new Set(headerRoots.flatMap((root) => [root, ...root.querySelectorAll('*')]))]
        .filter((node) => !node.closest(
          '[data-localization-drawer], [data-subscription-popup], [data-cart-drawer], [data-search-drawer], [data-drawer-menu], dialog, [role="dialog"]'
        ));
      const headerActions = Array.from(document.querySelectorAll(
        'header a, header button, [role="banner"] a, [role="banner"] button, .header a, .header button'
      )).filter((node) => !node.closest(
        '[data-localization-drawer], [data-subscription-popup], [data-cart-drawer], [data-search-drawer], [data-drawer-menu], dialog, [role="dialog"]'
      ));
      const animations = document.getAnimations ? document.getAnimations({ subtree: true }) : [];
      const animatedTargets = [...new Set(animations
        .map((animation) => animation.effect?.target)
        .filter((target) => (target instanceof HTMLElement || target instanceof SVGElement) && !target.closest('header, [role="banner"]')))];
      const animatedPresentation = animatedTargets.map((node) => {
        const computed = getComputedStyle(node);
        return {
          node,
          values: Object.fromEntries(['opacity','visibility','filter','clip-path','transform']
            .map((property) => [property, computed.getPropertyValue(property)])),
        };
      });
      for (const animation of animations) { try { animation.pause(); } catch {} }
      for (const { node, values } of animatedPresentation) {
        for (const [property, value] of Object.entries(values)) {
          if (value) node.style.setProperty(property, value, 'important');
        }
      }
      await paint();
      if (document.documentElement.scrollHeight > innerHeight) {
        standardizedScrollbarGutter = document.documentElement.clientWidth >= innerWidth ? 1 : 0;
      }
      return {
        documentHeight: document.documentElement.scrollHeight,
        frozenAnimations: animations.length,
        normalizedRevealItems: revealNodes.length,
        normalizedScrollEffects: scrollEffectNodes.length,
        normalizedMotionTracks: motionTrackNodes.length,
        frozenLayoutSections: layoutSections.length,
        frozenMainRegions: mainRegions.length,
        frozenLayoutBoxes: layoutBoxes.length,
        frozenCardGridBoxes: cardGridBoxes.length,
        collectionLandingGridDetected: hasCollectionLandingGrid,
        frozenTransforms: transformedNodes.length,
        frozenAnimatedTargets: animatedTargets.length,
        frozenRootScrollNodes: rootScrollNodes.length,
        standardizedScrollbarGutter,
        frozenHeaderNodes: 0,
        frozenHeaderActions: 0,
        responsiveHeaderNodes: headerNodes.length,
        responsiveHeaderActions: headerActions.length,
        productDiagnostics: Array.from(document.querySelectorAll('.product-block--inventory_status, .product-block--variant_picker')).map((node) => {
          const computed = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return { className: node.className, display: computed.display, visibility: computed.visibility, opacity: computed.opacity, width: rect.width, height: rect.height, top: rect.top };
        }),
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const frozenState = frozenStateEval.result?.value ?? {};
  captureTimings.freezeStateMs = Date.now() - stageStartedAt;
  stageStartedAt = Date.now();
  const postFreezeCountsEval = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const startedAt = performance.now();
      const initialObservationMs = 1000;
      const quietAfterChangeMs = 200;
      const maxWaitMs = 2000;
      let mutationCount = 0;
      let lastMutationAt = startedAt;
      const observer = new MutationObserver((records) => {
        mutationCount += records.length;
        lastMutationAt = performance.now();
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      while (performance.now() - startedAt < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const now = performance.now();
        if (mutationCount === 0 && now - startedAt >= initialObservationMs) break;
        if (mutationCount > 0 && now - lastMutationAt >= quietAfterChangeMs) break;
      }
      observer.disconnect();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        imageCount: document.images.length,
        stylesheetCount: Array.from(document.querySelectorAll('link[rel~="stylesheet"]')).length,
        documentHeight: document.documentElement.scrollHeight,
        quiescenceWaitMs: Math.round(performance.now() - startedAt),
        quiescenceMutations: mutationCount,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const postFreezeCounts = postFreezeCountsEval.result?.value ?? {};
  const expectedFrozenImageDelta = Number(browserFrozenVideos || 0) + Number(browserFrozenIframes || 0);
  const unexpectedImageGrowth = Number(postFreezeCounts.imageCount ?? 0)
    > Number(visualReadiness.imageCount ?? 0) + expectedFrozenImageDelta;
  if (unexpectedImageGrowth
    || Number(postFreezeCounts.stylesheetCount ?? 0) > Number(visualReadiness.stylesheetCount ?? 0)
    || Number(postFreezeCounts.documentHeight ?? 0) !== Number(frozenState.documentHeight ?? 0)) {
    visualReadiness = await settleVisualDocument(client);
  }
  visualReadiness.browserFrozenVideos = browserFrozenVideos;
  visualReadiness.browserFrozenIframes = browserFrozenIframes;
  captureTimings.postFreezeResourceSettleMs = Date.now() - stageStartedAt;
  captureTimings.postFreezeQuiescenceWaitMs = Number(postFreezeCounts.quiescenceWaitMs || 0);
  captureTimings.postFreezeQuiescenceMutations = Number(postFreezeCounts.quiescenceMutations || 0);
  if (Number.isFinite(postFreezeCounts.documentHeight)) visualReadiness.documentHeight = postFreezeCounts.documentHeight;
  else if (Number.isFinite(frozenState.documentHeight)) visualReadiness.documentHeight = frozenState.documentHeight;
  visualReadiness.frozenAnimations = frozenState.frozenAnimations ?? 0;
  visualReadiness.normalizedRevealItems = frozenState.normalizedRevealItems ?? 0;
  visualReadiness.normalizedScrollEffects = frozenState.normalizedScrollEffects ?? 0;
  visualReadiness.normalizedMotionTracks = frozenState.normalizedMotionTracks ?? 0;
  visualReadiness.frozenLayoutSections = frozenState.frozenLayoutSections ?? 0;
  visualReadiness.frozenCardGridBoxes = frozenState.frozenCardGridBoxes ?? 0;
  visualReadiness.frozenTransforms = frozenState.frozenTransforms ?? 0;
  visualReadiness.frozenAnimatedTargets = frozenState.frozenAnimatedTargets ?? 0;
  visualReadiness.frozenRootScrollNodes = frozenState.frozenRootScrollNodes ?? 0;
  visualReadiness.standardizedScrollbarGutter = frozenState.standardizedScrollbarGutter ?? 0;
  visualReadiness.frozenHeaderNodes = frozenState.frozenHeaderNodes ?? 0;
  visualReadiness.frozenHeaderActions = frozenState.frozenHeaderActions ?? 0;
  visualReadiness.responsiveHeaderNodes = frozenState.responsiveHeaderNodes ?? 0;
  visualReadiness.responsiveHeaderActions = frozenState.responsiveHeaderActions ?? 0;
  visualReadiness.productDiagnostics = frozenState.productDiagnostics ?? [];
  stageStartedAt = Date.now();
  const metadataEval = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const bodyStyle = getComputedStyle(document.body);
      return {
        title: document.title,
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        readyState: document.readyState,
        documentStyle: {
          backgroundColor: bodyStyle.backgroundColor,
          color: bodyStyle.color,
          fontFamily: bodyStyle.fontFamily,
          fontSize: bodyStyle.fontSize,
          lineHeight: bodyStyle.lineHeight,
          marginTop: bodyStyle.marginTop,
          marginRight: bodyStyle.marginRight,
          marginBottom: bodyStyle.marginBottom,
          marginLeft: bodyStyle.marginLeft,
        }
      };
    })()`,
    returnByValue: true,
  });

  const interactiveEval = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const selector = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[tabindex]';
      return Array.from(document.querySelectorAll(selector)).map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const hiddenAncestor = el.closest('[hidden],[aria-hidden="true"]');
        const renderVisible = r.width > 0 && r.height > 0
          && el.getClientRects().length > 0
          && cs.display !== 'none'
          && cs.visibility !== 'hidden'
          && Number(cs.opacity || 1) > 0
          && !hiddenAncestor;
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          role: el.getAttribute('role'),
          ownerId: (() => { const selector = 'article,form,aside,dialog,nav,table,[role="navigation"],[role="table"],[role="grid"],[role="listitem"],[role="dialog"],[role="search"],[id*="dropdown" i],[class*="dropdown" i],[aria-label*="filter" i],[id*="filter" i],[class*="filter" i]'; let node = el.parentElement; while (node) { if (node.matches(selector) && node.id) return node.id; node = node.parentElement; } return null; })(),
          text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 500),
          href: el.href || null,
          ariaPressed: el.getAttribute('aria-pressed'),
          ariaExpanded: el.getAttribute('aria-expanded'),
          ariaHaspopup: el.getAttribute('aria-haspopup'),
          ariaControls: el.getAttribute('aria-controls'),
          ariaSort: el.getAttribute('aria-sort'),
          ariaLabel: el.getAttribute('aria-label'),
          inputType: el.getAttribute('type'),
          checked: 'checked' in el ? Boolean(el.checked) : null,
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
          tabIndex: el.tabIndex,
          bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          renderVisible,
        };
      });
    })()`,
    returnByValue: true,
  });

  const componentCandidatesEval = replayProfile ? { result: { value: [] } } : await client.send('Runtime.evaluate', {
    expression: `(() => {
      const textOf = (el) => (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      const priceRe = /(?:[$€£¥₹]\\s?\\d[\\d,.]*|\\d[\\d,.]*\\s?(?:USD|EUR|GBP|CNY|RMB|JPY))/i;
      const headingSelector = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
      const mediaSelector = 'img,picture,video';
      const actionSelector = 'a[href],button,input[type="button"],input[type="submit"],[role="button"]';
      const styleSnapshot = (node) => {
        if (!node) return null;
        const s = getComputedStyle(node);
        return {
          display: s.display,
          position: s.position,
          width: s.width,
          height: s.height,
          boxSizing: s.boxSizing,
          marginTop: s.marginTop,
          marginRight: s.marginRight,
          marginBottom: s.marginBottom,
          marginLeft: s.marginLeft,
          paddingTop: s.paddingTop,
          paddingRight: s.paddingRight,
          paddingBottom: s.paddingBottom,
          paddingLeft: s.paddingLeft,
          gap: s.gap,
          flexDirection: s.flexDirection,
          justifyContent: s.justifyContent,
          alignItems: s.alignItems,
          gridTemplateColumns: s.gridTemplateColumns,
          fontFamily: s.fontFamily,
          fontSize: s.fontSize,
          fontWeight: s.fontWeight,
          lineHeight: s.lineHeight,
          color: s.color,
          backgroundColor: s.backgroundColor,
          borderTopWidth: s.borderTopWidth,
          borderRightWidth: s.borderRightWidth,
          borderBottomWidth: s.borderBottomWidth,
          borderLeftWidth: s.borderLeftWidth,
          borderTopColor: s.borderTopColor,
          borderRightColor: s.borderRightColor,
          borderBottomColor: s.borderBottomColor,
          borderLeftColor: s.borderLeftColor,
          borderTopStyle: s.borderTopStyle,
          borderRightStyle: s.borderRightStyle,
          borderBottomStyle: s.borderBottomStyle,
          borderLeftStyle: s.borderLeftStyle,
          borderRadius: s.borderRadius,
          boxShadow: s.boxShadow,
          opacity: s.opacity,
          transform: s.transform,
          textAlign: s.textAlign,
          overflow: s.overflow,
        };
      };

      const roleForNode = (node) => {
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role');
        if (role) return role;
        if (/^h[1-6]$/.test(tag)) return 'heading';
        if (tag === 'img' || tag === 'picture' || tag === 'video') return 'media';
        if (tag === 'a') return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'input' || tag === 'textarea') return 'textbox';
        if (priceRe.test(textOf(node)) && ['p','span','strong','b'].includes(tag)) return 'price';
        return tag;
      };

      const slotFor = (node) => {
        const role = roleForNode(node);
        if (role === 'media') return 'media';
        if (role === 'heading') return 'title';
        if (role === 'price') return 'meta';
        if (['button','link'].includes(role)) return 'actions';
        if (['textbox','searchbox'].includes(role)) return 'input';
        return 'body';
      };

      const classSignature = (el) => Array.from(el.classList)
        .filter((name) => !/^(is-|has-|active|selected|hover|focus|open|closed|compact|dense|large|small)/i.test(name))
        .sort().join('.');
      const childSignature = (el) => Array.from(el.children).slice(0, 8).map((c) => c.tagName.toLowerCase()).join('>');
      const repeated = new Set();
      for (const parent of document.querySelectorAll('main,section,ul,ol,div')) {
        const groups = new Map();
        for (const child of Array.from(parent.children)) {
          const sig = child.tagName.toLowerCase() + '|' + classSignature(child) + '|' + childSignature(child);
          if (!groups.has(sig)) groups.set(sig, []);
          groups.get(sig).push(child);
        }
        for (const group of groups.values()) {
          if (group.length < 2) continue;
          for (const child of group) {
            if (child.querySelector(headingSelector) || child.querySelector(mediaSelector) || child.querySelector(actionSelector)) repeated.add(child);
          }
        }
      }

      const roots = new Set([
        ...document.querySelectorAll('article,form,aside,dialog,nav,table,[role="listitem"],[role="dialog"],[role="search"],[role="navigation"],[role="table"],[role="grid"],[role="combobox"]'),
        ...repeated,
      ]);
      for (const el of document.querySelectorAll('section,div,aside,form')) {
        const filterish = el.matches('[aria-label*="filter" i],[id*="filter" i],[class*="filter" i]');
        const dropdownish = Boolean(el.querySelector(':scope > [aria-haspopup="menu"],:scope > [aria-haspopup="listbox"],:scope > [role="combobox"]'));
        if (filterish || dropdownish) roots.add(el);
      }

      const inferSemanticRole = (el) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const text = textOf(el);
        const hasHeading = Boolean(el.querySelector(headingSelector));
        const hasMedia = Boolean(el.querySelector(mediaSelector));
        const hasPrice = priceRe.test(text);
        const isSearch = role === 'search' || Boolean(el.querySelector('input[type="search"],input[name*="search" i],input[placeholder*="search" i]'));
        const filterish = el.matches('[aria-label*="filter" i],[id*="filter" i],[class*="filter" i]') && Boolean(el.querySelector('input,select,button,[role="checkbox"],[role="radio"]'));
        const dropdownish = role === 'combobox' || Boolean(el.querySelector(':scope > [aria-haspopup="menu"],:scope > [aria-haspopup="listbox"],:scope > [role="combobox"]'));
        if (tag === 'nav' || role === 'navigation') return 'navigation';
        if (tag === 'dialog' || role === 'dialog') return 'modal';
        if (tag === 'table' || role === 'table' || role === 'grid') return 'data-table';
        if (dropdownish) return 'dropdown';
        if (filterish) return 'filter-panel';
        if (tag === 'form' && isSearch) return 'search-form';
        if (tag === 'aside') return 'sidebar';
        if (hasPrice && hasHeading) return 'product-card';
        if (hasHeading && (tag === 'article' || role === 'listitem' || repeated.has(el))) return 'content-card';
        return null;
      };

      const componentNameFor = (role) => ({
        'product-card': 'ProductCard',
        'content-card': 'ContentCard',
        'search-form': 'SearchForm',
        'navigation': 'Navigation',
        'filter-panel': 'FilterPanel',
        'dropdown': 'Dropdown',
        'data-table': 'DataTable',
        'modal': 'Modal',
        'sidebar': 'Sidebar',
      }[role] || role.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(''));

      const candidateEntries = [];
      let generatedIndex = 0;
      for (const el of roots) {
        const semanticRole = inferSemanticRole(el);
        if (!semanticRole) continue;
        const cs = getComputedStyle(el);
        const rootRole = el.getAttribute('role') || '';
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        const descendants = Array.from(el.querySelectorAll('*')).slice(0, 64);
        const heading = el.querySelector(headingSelector);
        const media = el.querySelector('img,video,source');
        const priceNode = descendants.find((node) => priceRe.test(textOf(node)) && ['P','SPAN','STRONG','B'].includes(node.tagName));
        const actionNodes = Array.from(el.querySelectorAll(actionSelector)).slice(0, 12);
        const actionLabels = actionNodes.map((node) => (node.innerText || node.value || node.getAttribute('aria-label') || '').trim()).filter(Boolean);
        const actions = actionNodes.map((node) => {
          const tag = node.tagName.toLowerCase();
          if (tag === 'a') return 'navigate';
          if (node.type === 'submit') return semanticRole === 'search-form' ? 'search' : 'submit';
          return 'interact';
        });
        const padding = parseFloat(cs.paddingTop) || 0;
        const density = padding <= 12 ? 'compact' : 'medium';
        const variant = semanticRole.endsWith('-card') && density === 'compact' ? 'compact' : 'default';
        const id = el.id || ('candidate-' + (++generatedIndex));
        const tableColumns = semanticRole === 'data-table' ? Array.from(el.querySelectorAll('thead th,[role="columnheader"]')).map((node) => textOf(node)).filter(Boolean) : [];
        const tableRowCount = semanticRole === 'data-table' ? el.querySelectorAll('tbody tr').length : null;
        const detectedStates = [];
        if (semanticRole === 'data-table') {
          const alertText = Array.from(el.querySelectorAll('[role="alert"]')).map((node) => textOf(node)).join(' ');
          const statusText = Array.from(el.querySelectorAll('[role="status"],[aria-live]')).map((node) => textOf(node)).join(' ');
          const isError = Boolean(alertText) || /(?:failed|error|unable to|could not)/i.test(statusText);
          const isLoading = el.getAttribute('aria-busy') === 'true' || /(?:loading|please wait|fetching)/i.test(statusText);
          const isEmpty = tableRowCount === 0 && /(?:no\\s+(?:results?|data|orders?|items?|records?)|nothing\\s+(?:found|here)|empty)/i.test(statusText + ' ' + textOf(el));
          if (isError) detectedStates.push('error');
          else if (isLoading) detectedStates.push('loading');
          else if (isEmpty) detectedStates.push('empty');
        }
        const navItems = semanticRole === 'navigation' ? Array.from(el.querySelectorAll('a[href],button')).map((node) => textOf(node)).filter(Boolean).slice(0, 24) : [];
        const optionLabels = ['filter-panel','dropdown'].includes(semanticRole) ? Array.from(el.querySelectorAll('option,label,[role="option"],[role="menuitem"]')).map((node) => textOf(node)).filter(Boolean).slice(0, 24) : [];
        const candidate = {
          id,
          domId: el.id || null,
          componentName: componentNameFor(semanticRole),
          semanticRole,
          variant,
          structure: {
            tag: el.tagName.toLowerCase(),
            childRoles: descendants.map(roleForNode),
            slots: [...new Set(descendants.map(slotFor))],
          },
          style: styleSnapshot(el),
          slotStyles: {
            title: styleSnapshot(heading),
            price: styleSnapshot(priceNode),
            action: styleSnapshot(actionNodes[0] ?? null),
            media: styleSnapshot(media),
          },
          visual: {
            aspectRatioBucket: r.width > r.height * 1.2 ? 'landscape' : (r.height > r.width * 1.2 ? 'portrait' : 'square'),
            density,
          },
          behavior: {
            role: rootRole || (semanticRole === 'search-form' ? 'search' : (el.tagName.toLowerCase() === 'article' ? 'group' : el.tagName.toLowerCase())),
            sideEffectClass: semanticRole === 'search-form' ? 'network-read' : 'none',
            actions: [...new Set(actions)],
          },
          detectedStates,
          content: {
            title: heading ? textOf(heading) : null,
            price: priceNode ? (textOf(priceNode).match(priceRe)?.[0] || textOf(priceNode)) : null,
            media: media ? (media.getAttribute('src') || media.getAttribute('srcset') || null) : null,
            actionLabels,
            columns: tableColumns,
            rowCount: tableRowCount,
            items: navItems,
            options: optionLabels,
            text: textOf(el).slice(0, 1000),
          },
          bbox: { x: r.x, y: r.y, width: r.width, height: r.height },
          parentCandidateId: null,
          childCandidateIds: [],
        };
        candidateEntries.push({ candidate, el });
      }

      const entryByElement = new Map(candidateEntries.map((entry) => [entry.el, entry]));
      for (const entry of candidateEntries) {
        let parent = entry.el.parentElement;
        while (parent && !entryByElement.has(parent)) parent = parent.parentElement;
        const parentEntry = parent ? entryByElement.get(parent) : null;
        if (parentEntry) {
          entry.candidate.parentCandidateId = parentEntry.candidate.id;
          parentEntry.candidate.childCandidateIds.push(entry.candidate.id);
        }
      }
      return candidateEntries.map((entry) => entry.candidate);
    })()`,
    returnByValue: true,
  });

  const linksEval = await client.send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('a[href]')).map((a) => a.href || a.getAttribute('href')).filter(Boolean)`,
    returnByValue: true,
  });
  captureTimings.inventoryMs = Date.now() - stageStartedAt;

  stageStartedAt = Date.now();
  const visibleImageSources = await visibleExternalImageSources(client);
  const stylesheetSources = await externalStylesheetSources(client);
  const assetDataUrls = options.imageResponseCollector
    ? Object.fromEntries(await options.imageResponseCollector.dataUrls(visibleImageSources))
    : {};
  visualReadiness = reconcileVisualReadinessWithCapturedAssets(visualReadiness, Object.keys(assetDataUrls));
  if (options.imageResponseCollector) {
    const stylesheetStatus = options.imageResponseCollector.stylesheetStatus(stylesheetSources);
    visualReadiness.externalStylesheetCount = stylesheetStatus.stylesheetCount;
    visualReadiness.capturedStylesheets = stylesheetStatus.capturedStylesheets;
    visualReadiness.failedStylesheets = stylesheetStatus.failedStylesheets;
    visualReadiness.uncapturedStylesheets = stylesheetStatus.uncapturedStylesheets;
    visualReadiness.failedStylesheetDetails = stylesheetStatus.failedStylesheetDetails;
    visualReadiness.uncapturedStylesheetDetails = stylesheetStatus.uncapturedStylesheetDetails;
    const fontStatus = options.imageResponseCollector.fontStatus();
    visualReadiness.fontCount = fontStatus.fontCount;
    visualReadiness.capturedFonts = fontStatus.capturedFonts;
    visualReadiness.failedFonts = fontStatus.failedFonts;
    visualReadiness.uncapturedFonts = fontStatus.uncapturedFonts;
    visualReadiness.failedFontDetails = fontStatus.failedFontDetails;
    visualReadiness.uncapturedFontDetails = fontStatus.uncapturedFontDetails;
    Object.assign(visualReadiness, options.imageResponseCollector.networkStatus());
  } else {
    visualReadiness.externalStylesheetCount = stylesheetSources.length;
    visualReadiness.capturedStylesheets = 0;
    visualReadiness.failedStylesheets = 0;
    visualReadiness.uncapturedStylesheets = stylesheetSources.length;
    visualReadiness.failedStylesheetDetails = [];
    visualReadiness.uncapturedStylesheetDetails = stylesheetSources.slice(0, 20).map((url) => ({
      url,
      errorText: 'stylesheet-response-not-captured',
    }));
    visualReadiness.fontCount = 0;
    visualReadiness.capturedFonts = 0;
    visualReadiness.failedFonts = 0;
    visualReadiness.uncapturedFonts = 0;
    visualReadiness.failedFontDetails = [];
    visualReadiness.uncapturedFontDetails = [];
    visualReadiness.failedNetworkRequests = 0;
    visualReadiness.failedNetworkRequestDetails = [];
  }
  captureTimings.assetCollectionMs = Date.now() - stageStartedAt;
  stageStartedAt = Date.now();
  const browserFrozenUncapturedImages = await freezeUncapturedVisibleImagesWithScreenshot(client, Object.keys(assetDataUrls));
  captureTimings.browserImageFallbackFreezeMs = Date.now() - stageStartedAt;
  visualReadiness.browserFrozenUncapturedImages = browserFrozenUncapturedImages;
  if (options.beforeSnapshotExpression) {
    stageStartedAt = Date.now();
    await client.send('Runtime.evaluate', {
      expression: options.beforeSnapshotExpression,
      awaitPromise: true,
      returnByValue: true,
    });
    await client.send('Runtime.evaluate', {
      expression: `(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return true;
      })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    captureTimings.beforeSnapshotExpressionMs = Date.now() - stageStartedAt;
  }
  stageStartedAt = Date.now();
  const screenshotCapture = await capturePaintedScreenshot(client, options);
  captureTimings.screenshotMs = Date.now() - stageStartedAt;
  visualReadiness.screenshotTileCount = screenshotCapture.tileCount;
  stageStartedAt = Date.now();
  // A responsive or lazy image can switch currentSrc while the full-page paint
  // is being captured. Freeze every remaining non-data image after that paint;
  // images already embedded from response bodies are skipped automatically.
  const postScreenshotFrozenImages = await freezeUncapturedVisibleImagesWithScreenshot(client, Object.keys(assetDataUrls));
  captureTimings.postScreenshotImageFallbackFreezeMs = Date.now() - stageStartedAt;
  visualReadiness.postScreenshotFrozenImages = postScreenshotFrozenImages;
  visualReadiness.browserFrozenUncapturedImages += postScreenshotFrozenImages;
  if (options.beforeSnapshotExpression) {
    stageStartedAt = Date.now();
    await client.send('Runtime.evaluate', {
      expression: options.beforeSnapshotExpression,
      awaitPromise: true,
      returnByValue: true,
    });
    captureTimings.beforeSerializationExpressionMs = Date.now() - stageStartedAt;
  }
  stageStartedAt = Date.now();
  const renderedDocumentEval = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const assetDataUrls = ${JSON.stringify(assetDataUrls)};
      const clone = document.documentElement.cloneNode(true);
      const sourceClientWidth = document.documentElement.clientWidth;
      const sourceInnerWidth = innerWidth;
      const sourceHasNoScrollbarGutter = document.documentElement.scrollHeight > innerHeight && sourceClientWidth >= sourceInnerWidth;
      clone.setAttribute('data-matbox-source-client-width', String(sourceClientWidth));
      clone.setAttribute('data-matbox-source-inner-width', String(sourceInnerWidth));
      const liveNodes = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
      const clonedNodes = [clone, ...clone.querySelectorAll('*')];
      const absolute = (value) => {
        if (!value || /^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) return value;
        try { return new URL(value, location.href).href; } catch { return value; }
      };
      const absoluteSrcset = (value) => String(value || '').split(',').map((part) => {
        const match = part.trim().match(/^(\S+)(\s+.+)?$/);
        return match ? absolute(match[1]) + (match[2] || '') : part;
      }).join(', ');
      const rewriteCssUrls = (value) => String(value || '').replace(/url\\(\\s*(['"]?)([^'")]+)\\1\\s*\\)/gi, (match, quote, rawUrl) => {
        const resolved = absolute(rawUrl.trim());
        const replacement = assetDataUrls[resolved];
        return replacement ? 'url("' + replacement + '")' : match;
      });
      for (let index = 0; index < Math.min(liveNodes.length, clonedNodes.length); index++) {
        const source = liveNodes[index];
        const target = clonedNodes[index];
        for (const name of ['src','href','poster','action']) {
          if (target.hasAttribute?.(name)) target.setAttribute(name, absolute(target.getAttribute(name)));
        }
        if (target.hasAttribute?.('srcset')) target.setAttribute('srcset', absoluteSrcset(target.getAttribute('srcset')));
        if (source instanceof HTMLStyleElement) {
          target.textContent = rewriteCssUrls(source.textContent);
          if (source.sheet) {
            try {
              const cssText = Array.from(source.sheet.cssRules || []).map((rule) => rule.cssText).join('\\n');
              if (cssText) {
                target.textContent = rewriteCssUrls(cssText);
                target.setAttribute('data-matbox-frozen-cssom', 'true');
              }
            } catch {}
          }
        }
        if (target.hasAttribute?.('style')) target.setAttribute('style', rewriteCssUrls(target.getAttribute('style')));
        if (source.style?.getPropertyValue('--swatch-background')) {
          const computed = getComputedStyle(source);
          target.style.setProperty('background-color', computed.backgroundColor);
          target.style.setProperty('background-image', computed.backgroundImage);
        }
        if (source instanceof HTMLLinkElement && source.relList?.contains('stylesheet') && source.sheet) {
          const frozenHref = assetDataUrls[absolute(source.href)];
          if (frozenHref) target.setAttribute('href', frozenHref);
          try {
            const cssText = Array.from(source.sheet.cssRules || []).map((rule) => rule.cssText).join('\\n');
            const style = document.createElement('style');
            style.setAttribute('data-matbox-frozen-stylesheet', 'true');
            style.setAttribute('data-source-href', source.sheet.href || source.href || '');
            style.media = source.media || 'all';
            style.textContent = rewriteCssUrls(cssText);
            target.replaceWith(style);
          } catch {}
        }
        if (source instanceof HTMLImageElement && source.currentSrc) {
          target.setAttribute('src', assetDataUrls[source.currentSrc] || source.currentSrc);
          target.removeAttribute('srcset');
          target.removeAttribute('loading');
          for (const attribute of ['data-src','data-lazy-src','data-original','data-srcset','data-lazy-srcset']) target.removeAttribute(attribute);
          target.closest?.('picture')?.querySelectorAll('source').forEach((item) => {
            for (const attribute of ['src','srcset','data-src','data-lazy-src','data-original','data-srcset','data-lazy-srcset']) item.removeAttribute(attribute);
          });
        } else if (source instanceof HTMLImageElement && !source.currentSrc && !String(source.getAttribute('src') || '').trim()) {
          target.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==');
          target.removeAttribute('srcset');
          for (const attribute of ['data-src','data-lazy-src','data-original','data-srcset','data-lazy-srcset']) target.removeAttribute(attribute);
          target.setAttribute('data-matbox-empty-image-placeholder', 'true');
        }
        if (source instanceof HTMLCanvasElement && source.getAttribute('data-matbox-frozen-media') === 'true') {
          const image = document.createElement('img');
          for (const attribute of Array.from(target.attributes)) {
            if (!['width','height','data-matbox-frozen-src'].includes(attribute.name)) image.setAttribute(attribute.name, attribute.value);
          }
          image.setAttribute('src', source.getAttribute('data-matbox-frozen-src') || source.toDataURL('image/png'));
          image.setAttribute('alt', '');
          target.replaceWith(image);
        }
        if (source instanceof HTMLInputElement) {
          target.setAttribute('value', source.value);
          if (source.checked) target.setAttribute('checked', ''); else target.removeAttribute('checked');
        }
        if (source instanceof HTMLTextAreaElement) target.textContent = source.value;
        if (source instanceof HTMLSelectElement) {
          Array.from(target.options || []).forEach((option, optionIndex) => {
            if (source.options[optionIndex]?.selected) option.setAttribute('selected', '');
            else option.removeAttribute('selected');
          });
        }
        if (source instanceof HTMLDetailsElement && source.open) target.setAttribute('open', '');
      }
      const runtimeCarouselSelector = '.slick-list,.slick-track,.slick-slide';
      for (let index = 0; index < Math.min(liveNodes.length, clonedNodes.length); index++) {
        const source = liveNodes[index];
        const target = clonedNodes[index];
        if (!(source instanceof HTMLElement) || !source.matches(runtimeCarouselSelector) || !(target instanceof HTMLElement)) continue;
        const computed = getComputedStyle(source);
        const width = computed.width;
        if (width && width !== 'auto') target.style.setProperty('width', width, 'important');
        const flexBasis = computed.flexBasis;
        if (flexBasis && flexBasis !== 'auto') target.style.setProperty('flex-basis', flexBasis, 'important');
        target.setAttribute('data-matbox-frozen-carousel-geometry', 'true');
      }
      const paragraphBlockSelector = 'address,article,aside,blockquote,div,dl,fieldset,figure,footer,form,h1,h2,h3,h4,h5,h6,header,hgroup,hr,main,nav,ol,p,pre,section,table,ul';
      for (let index = 0; index < Math.min(liveNodes.length, clonedNodes.length); index++) {
        const source = liveNodes[index];
        const target = clonedNodes[index];
        if (!(source instanceof HTMLParagraphElement) || !source.querySelector(paragraphBlockSelector) || !target?.parentNode) continue;
        const replacement = document.createElement('div');
        for (const attribute of Array.from(target.attributes || [])) replacement.setAttribute(attribute.name, attribute.value);
        replacement.setAttribute('data-matbox-original-tag', 'p');
        while (target.firstChild) replacement.append(target.firstChild);
        const computed = getComputedStyle(source);
        for (const property of ['display','margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','box-sizing','font-family','font-size','font-style','font-weight','line-height','letter-spacing','text-align','text-transform','white-space']) {
          replacement.style.setProperty(property, computed.getPropertyValue(property), 'important');
        }
        target.replaceWith(replacement);
      }
      const liveVideos = Array.from(document.querySelectorAll('video'));
      const clonedVideos = Array.from(clone.querySelectorAll('video'));
      for (let index = 0; index < Math.min(liveVideos.length, clonedVideos.length); index++) {
        const source = liveVideos[index];
        const target = clonedVideos[index];
        if (!source.poster || source.getAttribute('data-matbox-frozen-video') !== 'true') continue;
        target.setAttribute('poster', source.poster);
        target.setAttribute('data-matbox-frozen-video', 'true');
        target.removeAttribute('autoplay');
        target.removeAttribute('src');
        target.querySelectorAll('source').forEach((item) => item.removeAttribute('src'));
      }
      clone.querySelectorAll('script').forEach((node) => {
        node.removeAttribute('src');
        node.setAttribute('type', 'application/x-matbox-disabled');
        node.textContent = '';
      });
      clone.querySelectorAll('noscript,meta[http-equiv="Content-Security-Policy" i]').forEach((node) => node.remove());
      const head = clone.querySelector('head');
      if (head) {
        if (!sourceHasNoScrollbarGutter) {
          head.querySelectorAll('style[data-matbox-live-hidden-scrollbar],style[data-matbox-hidden-scrollbar]').forEach((node) => node.remove());
          clone.style.removeProperty('scrollbar-width');
        }
        head.querySelectorAll('base').forEach((node) => node.remove());
        const base = document.createElement('base');
        base.setAttribute('href', location.href);
        head.prepend(base);
        const freeze = document.createElement('style');
        freeze.setAttribute('data-matbox-render-freeze', '');
        freeze.textContent = '*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}';
        head.append(freeze);
        if (sourceHasNoScrollbarGutter) {
          clone.style.setProperty('overflow-y', 'auto', 'important');
          clone.style.setProperty('scrollbar-width', 'none', 'important');
          const hiddenScrollbar = document.createElement('style');
          hiddenScrollbar.setAttribute('data-matbox-hidden-scrollbar', '');
          hiddenScrollbar.textContent = 'html{scrollbar-width:none!important}html::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
          head.append(hiddenScrollbar);
        }
      }
      return { sourceUrl: location.href, html: '<!doctype html>\\n' + clone.outerHTML };
    })()`,
    returnByValue: true,
  });
  if (renderedDocumentEval.exceptionDetails) {
    const detail = renderedDocumentEval.exceptionDetails.exception?.description || renderedDocumentEval.exceptionDetails.text || 'unknown serialization error';
    throw new Error(`Rendered document serialization failed: ${detail}`);
  }
  captureTimings.renderedDocumentMs = Date.now() - stageStartedAt;

  stageStartedAt = Date.now();
  const domSnapshot = replayProfile ? null : await client.send('DOMSnapshot.captureSnapshot', {
    computedStyles: COMPUTED_STYLES,
    includePaintOrder: true,
    includeDOMRects: true,
    includeBlendedBackgroundColors: true,
    includeTextColorOpacities: true,
  });
  const axTree = replayProfile ? null : await client.send('Accessibility.getFullAXTree');
  captureTimings.analysisMs = Date.now() - stageStartedAt;
  captureTimings.collectTotalMs = Date.now() - collectStartedAt;

  const interactiveElements = interactiveEval.result?.value ?? [];
  return {
    metadata: {
      ...(metadataEval.result?.value ?? {}),
      visualReadiness,
      ...(observedReadiness ? { observedReadiness } : {}),
      captureTimings,
      interactionInventory: summarizeInteractionInventory(interactiveElements),
    },
    domSnapshot,
    axTree,
    interactiveElements,
    componentCandidates: componentCandidatesEval.result?.value ?? [],
    componentHints: componentCandidatesEval.result?.value ?? [],
    links: linksEval.result?.value ?? [],
    renderedDocument: renderedDocumentEval.result?.value ?? null,
    screenshot: screenshotCapture.buffer,
    computedStyleProperties: COMPUTED_STYLES,
  };
}

async function capturePaintedScreenshot(client, options = {}) {
  const base = { format: 'png', fromSurface: true, captureBeyondViewport: true };
  if (options.screenshotClip) {
    const result = await client.send('Page.captureScreenshot', { ...base, clip: options.screenshotClip });
    return { buffer: Buffer.from(result.data, 'base64'), tileCount: 1 };
  }

  const metrics = await client.send('Page.getLayoutMetrics');
  const content = metrics.cssContentSize ?? metrics.contentSize;
  const width = Math.max(
    1,
    Math.ceil(content?.width ?? 1),
    Math.ceil(Number(options.viewport?.width ?? 1)),
  );
  const height = Math.max(1, Math.ceil(content?.height ?? 1));
  const viewportHeight = Math.max(1, Number(options.viewport?.height ?? 900));
  const tileHeight = Math.min(2048, Math.max(1024, Math.ceil(viewportHeight * 2)));
  if (height <= Math.max(tileHeight, 16000)) {
    const result = await client.send('Page.captureScreenshot', {
      ...base,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return { buffer: Buffer.from(result.data, 'base64'), tileCount: 1 };
  }

  const tiles = [];
  for (let y = 0; y < height; y += tileHeight) {
    const cssHeight = Math.min(tileHeight, height - y);
    const result = await client.send('Page.captureScreenshot', {
      ...base,
      clip: { x: 0, y, width, height: cssHeight, scale: 1 },
    });
    tiles.push({ y, cssHeight, image: PNG.sync.read(Buffer.from(result.data, 'base64')) });
  }
  const pixelScale = tiles[0].image.width / width;
  const output = new PNG({
    width: tiles[0].image.width,
    height: Math.round(height * pixelScale),
  });
  for (const tile of tiles) {
    const targetY = Math.round(tile.y * pixelScale);
    const copyHeight = Math.min(tile.image.height, output.height - targetY);
    PNG.bitblt(tile.image, output, 0, 0, tile.image.width, copyHeight, 0, targetY);
  }
  return { buffer: PNG.sync.write(output), tileCount: tiles.length };
}

async function withChromium(options, runner) {
  const chromiumPath = await resolveChromiumPath(process.env.MATBOX_CHROMIUM_PATH || options.chromiumPath);
  assertBrowserLaunchAllowed(chromiumPath);
  const timeoutMs = options.timeoutMs ?? 15000;
  const profileRoot = options.profileRoot ?? os.tmpdir();
  await fs.mkdir(profileRoot, { recursive: true });
  const profileDir = await fs.mkdtemp(path.join(profileRoot, 'component-capture-chrome-'));
  if (options.profileSeedDir) {
    await fs.cp(options.profileSeedDir, profileDir, { recursive: true, force: true });
    await Promise.all([
      'DevToolsActivePort',
      'SingletonCookie',
      'SingletonLock',
      'SingletonSocket',
    ].map((name) => fs.rm(path.join(profileDir, name), { force: true })));
  }
  const chromium = spawn(chromiumPath, [
    '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
    '--disable-background-networking','--disable-component-update','--disable-default-apps',
    '--disable-extensions','--disable-sync','--metrics-recording-only','--no-first-run',
    '--edge-skip-compat-layer-relaunch',
    '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',
    `--user-data-dir=${profileDir}`,'about:blank',
  ], { stdio: 'ignore' });

  let client;
  try {
    const port = await waitForDevToolsPort(profileDir, chromium, timeoutMs);
    const target = await getPageTarget(port, timeoutMs);
    client = new CdpClient(target.webSocketDebuggerUrl, { timeoutMs });
    await client.connect();
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    if (options.artifactProfile !== 'replay') await client.send('Accessibility.enable');
    if (options.viewport) {
      const width = Number(options.viewport.width);
      const height = Number(options.viewport.height);
      const mobile = Boolean(options.viewport.mobile);
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: Number(options.viewport.deviceScaleFactor ?? 1),
        mobile,
        screenWidth: width,
        screenHeight: height,
      });
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
    }
    return await runner(client, timeoutMs);
  } finally {
    try { await client?.close(); } catch {}
    if (chromium.exitCode === null) chromium.kill('SIGTERM');
    await new Promise((resolve) => {
      if (chromium.exitCode !== null) return resolve();
      const timer = setTimeout(() => { try { chromium.kill('SIGKILL'); } catch {}; resolve(); }, 1500);
      chromium.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

async function setHtmlDocument(client, html, timeoutMs) {
  const frameTree = await client.send('Page.getFrameTree');
  const frameId = frameTree.frameTree?.frame?.id;
  if (!frameId) throw new Error('Unable to resolve main frame');
  await client.send('Page.setDocumentContent', { frameId, html });
  await waitForReadyState(client, timeoutMs, ['complete']);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function observeElementById(client, id) {
  const encoded = JSON.stringify(id);
  const result = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.getElementById(${encoded});
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        id: el.id,
        ariaExpanded: el.getAttribute('aria-expanded'),
        ariaPressed: el.getAttribute('aria-pressed'),
        ariaSort: el.getAttribute('aria-sort'),
        ariaSelected: el.getAttribute('aria-selected'),
        checked: 'checked' in el ? Boolean(el.checked) : null,
        hidden: Boolean(el.hidden),
        active: document.activeElement === el,
        text: (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 1000),
        childCount: el.querySelectorAll('*').length,
        display: cs.display,
        visibility: cs.visibility,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        boxShadow: cs.boxShadow,
        transform: cs.transform,
        opacity: cs.opacity,
        outlineColor: cs.outlineColor,
        outlineWidth: cs.outlineWidth,
        borderColor: cs.borderTopColor,
        bbox: { x: r.x, y: r.y, width: r.width, height: r.height }
      };
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? null;
}

function comparableObservation(observation) {
  if (!observation) return null;
  const { bbox, ...rest } = observation;
  return rest;
}

function observationsDiffer(before, after) {
  return JSON.stringify(comparableObservation(before)) !== JSON.stringify(comparableObservation(after));
}

function buildAutoStatePlan(base, maxStateSteps = 12) {
  const steps = [];
  const seen = new Set();
  const candidateByDomId = new Map((base.componentCandidates ?? []).filter((candidate) => candidate.domId).map((candidate) => [candidate.domId, candidate]));
  const push = (step) => {
    const key = `${step.state}:${step.targetId}`;
    if (seen.has(key) || steps.length >= maxStateSteps) return;
    seen.add(key);
    steps.push(step);
  };

  for (const candidate of base.componentCandidates ?? []) {
    if (!candidate.domId) continue;
    if (['product-card','content-card','modal','sidebar'].includes(candidate.semanticRole)) {
      push({ action: 'hover', state: 'hover', targetId: candidate.domId, ownerCandidateId: candidate.id });
    }
  }

  for (const element of base.interactiveElements ?? []) {
    if (!element.id) continue;
    if (element.ariaHaspopup === 'dialog' && element.ariaControls) {
      push({ action: 'click', event: 'open', state: 'open', targetId: element.id, ownerCandidateId: element.ownerId, revealTargetId: element.ariaControls });
      continue;
    }

    const controlledCandidate = element.ariaControls ? candidateByDomId.get(element.ariaControls) : null;
    const paginationIntent = /(?:next|previous|prev|page)/i.test(`${element.ariaLabel ?? ''} ${element.text ?? ''}`);
    if (controlledCandidate?.semanticRole === 'data-table' && paginationIntent) {
      push({ action: 'click', event: 'paginate', state: 'paginated', targetId: element.id, ownerCandidateId: controlledCandidate.id, revealTargetId: element.ariaControls });
    }

    if (!element.ownerId) continue;
    if (element.ariaSort !== null && element.ariaSort !== undefined) {
      push({ action: 'click', event: 'sort', state: 'sorted', targetId: element.id, ownerCandidateId: element.ownerId });
    }
    if (['input','textarea','select'].includes(element.tag)) {
      push({ action: 'focus', event: 'focus', state: 'focus', targetId: element.id, ownerCandidateId: element.ownerId });
    }
    if (element.tag === 'input' && ['checkbox','radio'].includes(String(element.inputType ?? '').toLowerCase())) {
      push({ action: 'click', event: 'toggle-selection', state: 'selected', targetId: element.id, ownerCandidateId: element.ownerId });
    }
    if (element.ariaExpanded === 'false') {
      push({ action: 'click', event: 'toggle-expanded', state: 'expanded', targetId: element.id, ownerCandidateId: element.ownerId });
    }
    if (element.ariaPressed !== null && element.ariaPressed !== undefined) {
      push({ action: 'click', event: 'toggle-selected', state: 'selected', targetId: element.id, ownerCandidateId: element.ownerId });
    }
  }
  return steps;
}

async function applyStateAction(client, step) {
  if (step.action === 'hover') {
    const observation = await observeElementById(client, step.targetId);
    if (!observation?.bbox) return false;
    const x = observation.bbox.x + observation.bbox.width / 2;
    const y = observation.bbox.y + observation.bbox.height / 2;
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    return true;
  }
  const encoded = JSON.stringify(step.targetId);
  const method = step.action === 'focus' ? 'focus' : 'click';
  const result = await client.send('Runtime.evaluate', {
    expression: `(() => { const el = document.getElementById(${encoded}); if (!el) return false; el.${method}(); return true; })()`,
    returnByValue: true,
  });
  return Boolean(result.result?.value);
}

async function runBeforeCollectHooks(client, options) {
  const trustedClickSelector = options.beforeCollectTrustedClickSelector;
  let trustedTargetAvailable = false;
  if (trustedClickSelector) {
    await client.send('Runtime.evaluate', {
      expression: 'window.__matboxUseTrustedClick = true',
      returnByValue: true,
    });
  }
  if (options.beforeCollectExpression) {
    await client.send('Runtime.evaluate', {
      expression: options.beforeCollectExpression,
      awaitPromise: true,
      returnByValue: true,
    });
  }
  if (trustedClickSelector) {
    const selector = JSON.stringify(trustedClickSelector);
    const target = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const element = document.querySelector(${selector});
        if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return null;
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility !== 'visible' || rect.width <= 1 || rect.height <= 1) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
      returnByValue: true,
    });
    if (target.result?.value) {
      trustedTargetAvailable = true;
      const { x, y } = target.result.value;
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      await client.send('Runtime.evaluate', {
        expression: 'document.documentElement.setAttribute("data-matbox-trusted-click", "dispatched")',
        returnByValue: true,
      });
    } else {
      await client.send('Runtime.evaluate', {
        expression: 'document.documentElement.setAttribute("data-matbox-trusted-click", "target-missing")',
        returnByValue: true,
      });
    }
  }
  let afterTrustedResult = null;
  if (options.afterTrustedClickExpression) {
    afterTrustedResult = await client.send('Runtime.evaluate', {
      expression: options.afterTrustedClickExpression,
      awaitPromise: true,
      returnByValue: true,
    });
  }
  if (trustedClickSelector
    && trustedTargetAvailable
    && afterTrustedResult?.result?.value?.progressed === false) {
    const selector = JSON.stringify(trustedClickSelector);
    const fallback = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const element = document.querySelector(${selector});
        if (!element || element.disabled || element.getAttribute('aria-disabled') === 'true') return false;
        element.click();
        document.documentElement.setAttribute('data-matbox-trusted-click', 'dom-fallback');
        return true;
      })()`,
      returnByValue: true,
    });
    if (fallback.result?.value && options.afterTrustedClickExpression) {
      await client.send('Runtime.evaluate', {
        expression: options.afterTrustedClickExpression,
        awaitPromise: true,
        returnByValue: true,
      });
    }
  }
}

async function withRequestGuard(client, options, defaultEnabled, runner) {
  const enabled = options.requestGuard ?? defaultEnabled;
  const guard = enabled ? await installBrowserRequestGuard(client, { resolver: options.resolver }) : null;
  const blockSyntheticNetwork = !enabled && options.allowNetwork !== true;
  if (blockSyntheticNetwork) {
    await ensureNetworkEnabled(client);
    await client.send('Network.setBlockedURLs', { urls: ['http://*', 'https://*'] });
  }
  try {
    const value = await runner();
    await guard?.drain();
    return guard ? { ...value, requestGuard: { allowed: [...guard.stats.allowed], blocked: [...guard.stats.blocked] } } : value;
  } finally {
    if (blockSyntheticNetwork) {
      await client.send('Network.disable');
      networkEnabledClients.delete(client);
    }
    await guard?.close();
  }
}

export async function capturePage(url, options = {}) {
  return withChromium(options, async (client, timeoutMs) => withRequestGuard(client, options, true, async () => {
    const imageResponseCollector = await createImageResponseCollector(client);
    const observedReadinessMonitor = options.observedReadiness
      ? await createObservedPageReadinessMonitor(client)
      : null;
    try {
      const navigationStartedAt = Date.now();
      const navigateCommandStartedAt = Date.now();
      const nav = await client.send('Page.navigate', { url });
      const pageNavigateCommandMs = Date.now() - navigateCommandStartedAt;
      if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
      const readyStateStartedAt = Date.now();
      await waitForReadyState(client, timeoutMs);
      const readyStateWaitMs = Date.now() - readyStateStartedAt;
      const navigationReadyAt = Date.now();
      const hooksStartedAt = Date.now();
      await runBeforeCollectHooks(client, options);
      const beforeCollectHooksMs = Date.now() - hooksStartedAt;
      const result = await collectArtifacts(client, { ...options, imageResponseCollector, observedReadinessMonitor });
      result.metadata.captureTimings.pageNavigationAndReadyMs = navigationReadyAt - navigationStartedAt;
      result.metadata.captureTimings.pageNavigateCommandMs = pageNavigateCommandMs;
      result.metadata.captureTimings.readyStateWaitMs = readyStateWaitMs;
      result.metadata.captureTimings.beforeCollectHooksMs = beforeCollectHooksMs;
      result.metadata.captureTimings.navigationMs = Date.now() - navigationStartedAt - result.metadata.captureTimings.collectTotalMs;
      return result;
    } finally {
      observedReadinessMonitor?.close();
      imageResponseCollector.close();
    }
  }));
}

async function captureEntryWithClient(client, timeoutMs, entry, options) {
  const attempts = Math.max(1, Number(options.attempts ?? 1));
  const delayMs = Math.max(0, Number(options.retryDelayMs ?? 0));
  const url = typeof entry === 'string' ? entry : entry.url;
  const entryViewport = typeof entry === 'string' ? null : entry.viewport;
  const entryKey = typeof entry === 'string' ? undefined : entry.key;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let imageResponseCollector;
    try {
      imageResponseCollector = await createImageResponseCollector(client);
      if (entryViewport) {
        const width = Number(entryViewport.width);
        const height = Number(entryViewport.height);
        const mobile = Boolean(entryViewport.mobile);
        await client.send('Emulation.setDeviceMetricsOverride', {
          width,
          height,
          deviceScaleFactor: Number(entryViewport.deviceScaleFactor ?? 1),
          mobile,
          screenWidth: width,
          screenHeight: height,
        });
        await client.send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      }
      const navigationStartedAt = Date.now();
      const nav = await client.send('Page.navigate', { url });
      if (nav.errorText) throw new Error(`Navigation failed: ${nav.errorText}`);
      await waitForReadyState(client, timeoutMs);
      await runBeforeCollectHooks(client, options);
      const result = await collectArtifacts(client, {
        ...options,
        ...(entryViewport ? { viewport: entryViewport } : {}),
        imageResponseCollector,
      });
      result.metadata.captureTimings.navigationMs = Date.now() - navigationStartedAt - result.metadata.captureTimings.collectTotalMs;
      if (options.validateResult) await options.validateResult(result, url, entry);
      if (options.onResult) await options.onResult(result, url, entry);
      return { url, key: entryKey, ok: true, attempt };
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      imageResponseCollector?.close();
    }
  }
  return { url, key: entryKey, ok: false, error: String(lastError?.stack || lastError) };
}

export async function capturePageBatch(urls, options = {}) {
  return withChromium(options, async (client, timeoutMs) => withRequestGuard(client, options, true, async () => {
    const results = [];
    for (const entry of urls) results.push(await captureEntryWithClient(client, timeoutMs, entry, options));
    return results;
  }));
}

export async function capturePagePool(urls, options = {}) {
  const entries = [...urls];
  if (!entries.length) return [];
  const workerCount = Math.max(1, Math.floor(Number(options.workerCount) || 1));
  return runPersistentWorkerPool(entries, workerCount, async ({ drain }) => (
    withChromium(options, async (client, timeoutMs) => withRequestGuard(client, options, true, async () => (
      drain((entry) => captureEntryWithClient(client, timeoutMs, entry, options))
    )))
  ));
}

export async function captureHtml(html, options = {}) {
  return withChromium(options, async (client, timeoutMs) => withRequestGuard(client, options, false, async () => {
    const observedReadinessMonitor = options.observedReadiness
      ? await createObservedPageReadinessMonitor(client, { trackNetwork: false })
      : null;
    try {
      const navigationStartedAt = Date.now();
      await setHtmlDocument(client, html, timeoutMs);
      const result = await collectArtifacts(client, {
        ...options,
        observedReadinessDomOnly: true,
        observedReadinessMonitor,
      });
      result.metadata.captureTimings.navigationMs = Date.now() - navigationStartedAt - result.metadata.captureTimings.collectTotalMs;
      return result;
    } finally {
      observedReadinessMonitor?.close();
    }
  }));
}

export async function captureHtmlWithAutoStates(html, options = {}) {
  return withChromium(options, async (client, timeoutMs) => withRequestGuard(client, options, false, async () => {
    await setHtmlDocument(client, html, timeoutMs);
    const base = await collectArtifacts(client);
    const plan = buildAutoStatePlan(base, options.maxStateSteps ?? 12);
    const stateCaptures = [];

    for (const step of plan) {
      // Reset every experiment so state transitions cannot contaminate each other.
      await setHtmlDocument(client, html, timeoutMs);
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const before = await observeElementById(client, step.targetId);
      const beforeReveal = step.revealTargetId ? await observeElementById(client, step.revealTargetId) : null;
      const applied = await applyStateAction(client, step);
      await new Promise((resolve) => setTimeout(resolve, 60));
      const after = await observeElementById(client, step.targetId);
      const afterReveal = step.revealTargetId ? await observeElementById(client, step.revealTargetId) : null;
      const changed = applied && (observationsDiffer(before, after) || observationsDiffer(beforeReveal, afterReveal));
      if (!changed && options.includeUnchangedStates !== true) {
        stateCaptures.push({ ...step, applied, changed, before, after, beforeReveal, afterReveal });
        continue;
      }
      const capture = changed ? await collectArtifacts(client) : null;
      const baseIds = new Set((base.componentCandidates ?? []).map((candidate) => candidate.id));
      const revealedCandidateIds = capture ? (capture.componentCandidates ?? []).map((candidate) => candidate.id).filter((id) => !baseIds.has(id)) : [];
      stateCaptures.push({ ...step, applied, changed, before, after, beforeReveal, afterReveal, revealedCandidateIds, capture });
    }

    return { ...base, base, statePlan: plan, stateCaptures };
  }));
}
