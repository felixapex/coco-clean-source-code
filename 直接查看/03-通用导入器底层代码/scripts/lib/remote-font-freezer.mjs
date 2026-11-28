import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REMOTE_URL = /https?:\/\/[^\s"')]+/gi;
const DATA_CSS_BASE64 = /data:text\/css(?:;[^,"']*)?;base64,([a-z0-9+/=]+)/gi;
const verifiedFontBufferCache = new Map();

function isFontUrl(value) {
  try {
    const url = new URL(value);
    return /\.(?:woff2?|ttf|otf)$/i.test(url.pathname)
      || (url.hostname === 'use.typekit.net' && /^\/af\//.test(url.pathname));
  } catch {
    return false;
  }
}

function fontUrlsIn(value) {
  return [...String(value || '').matchAll(REMOTE_URL)].map((match) => match[0]).filter(isFontUrl);
}

function filenameFor(url) {
  const parsed = new URL(url);
  let extension = parsed.pathname.match(/\.(woff2?|ttf|otf)$/i)?.[1]?.toLowerCase();
  if (!extension && parsed.hostname === 'use.typekit.net') {
    const typekitFormat = parsed.pathname.split('/').filter(Boolean).at(-1);
    extension = ({ l: 'woff2', d: 'woff', a: 'otf' })[typekitFormat] || 'bin';
  }
  extension ||= 'bin';
  const digest = crypto.createHash('sha256').update(url).digest('hex').slice(0, 24);
  return `${digest}.${extension}`;
}

export async function downloadRemoteAssetWithCurl(url, { partialPath } = {}) {
  const managedTemporary = !partialPath;
  const targetPath = partialPath || path.join(os.tmpdir(), `matbox-curl-${crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 24)}.partial`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const child = spawn(executable, [
      '--http1.1', '--location', '--fail', '--silent', '--show-error',
      '--retry', '8', '--retry-all-errors', '--retry-delay', '1',
      '--connect-timeout', '15', '--max-time', '120', '--continue-at', '-', '--output', targetPath,
      String(url),
    ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `curl exited ${code}`));
    });
  });
  try {
    const buffer = await fs.readFile(targetPath);
    if (!buffer.length) throw new Error('curl produced an empty file');
    return buffer;
  } finally {
    if (managedTemporary) await fs.rm(targetPath, { force: true });
  }
}

function assertFallbackFontLooksValid(buffer, filename) {
  if (!buffer?.length) throw new Error('empty fallback response body');
  const signature = buffer.subarray(0, 4).toString('latin1');
  if (/\.woff2$/i.test(filename) && signature !== 'wOF2') throw new Error('invalid WOFF2 signature');
  if (/\.woff$/i.test(filename) && signature !== 'wOFF') throw new Error('invalid WOFF signature');
}

export async function freezeRemoteFontAssets(html, {
  cacheDir,
  fetchImpl = globalThis.fetch,
  fallbackDownloadImpl = downloadRemoteAssetWithCurl,
  publicBase = '/frozen-assets/fonts',
} = {}) {
  if (!cacheDir) throw new Error('cacheDir is required');
  const source = String(html || '');
  const embeddedCss = [...source.matchAll(DATA_CSS_BASE64)].map((match) => {
    try { return Buffer.from(match[1], 'base64').toString('utf8'); } catch { return ''; }
  });
  const urls = [...new Set([
    ...fontUrlsIn(source),
    ...embeddedCss.flatMap(fontUrlsIn),
  ])];
  if (!urls.length) return { html: source, assets: [] };
  await fs.mkdir(cacheDir, { recursive: true });
  const assets = [];
  for (const url of urls) {
    const filename = filenameFor(url);
    const cachePath = path.join(cacheDir, filename);
    let buffer = verifiedFontBufferCache.get(cachePath);
    if (!buffer) {
      try {
        buffer = await fs.readFile(cachePath);
        verifiedFontBufferCache.set(cachePath, buffer);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    if (!buffer) {
      let lastError;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const response = await fetchImpl(url);
          if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
          const candidate = Buffer.from(await response.arrayBuffer());
          if (!candidate.length) throw new Error('empty response body');
          buffer = candidate;
          break;
        } catch (fetchError) {
          lastError = fetchError;
        }
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
      if (!buffer?.length && fallbackDownloadImpl) {
        try {
          const candidate = Buffer.from(await fallbackDownloadImpl(url, { partialPath: `${cachePath}.partial` }));
          assertFallbackFontLooksValid(candidate, filename);
          buffer = candidate;
        } catch (fallbackError) {
          lastError = new Error(`${lastError?.message || 'fetch failed'}; fallback failed: ${fallbackError?.message || fallbackError}`);
        }
      }
      if (!buffer?.length) throw new Error(`Unable to freeze font ${url}: ${lastError?.message || 'download failed'}`);
      const temporary = `${cachePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, buffer);
      await fs.rename(temporary, cachePath);
      await fs.rm(`${cachePath}.partial`, { force: true });
      verifiedFontBufferCache.set(cachePath, buffer);
    }
    assets.push({
      url,
      filename,
      cachePath,
      byteLength: buffer.length,
      href: `${publicBase}/${filename}`,
    });
  }
  const hrefByUrl = new Map(assets.map((asset) => [asset.url, asset.href]));
  const rewrite = (value) => String(value || '').replace(REMOTE_URL, (url) => hrefByUrl.get(url) || url);
  let rewritten = rewrite(source);
  rewritten = rewritten.replace(DATA_CSS_BASE64, (full, payload) => {
    try {
      const css = Buffer.from(payload, 'base64').toString('utf8');
      const localCss = rewrite(css).replace(/@import\s+url\(["']https?:\/\/[^"']+["']\)\s*;?/gi, '');
      return `data:text/css;base64,${Buffer.from(localCss, 'utf8').toString('base64')}`;
    } catch {
      return full;
    }
  });
  return {
    html: rewritten,
    assets,
  };
}

export async function preflightRemoteFontAssets(htmlSources, options = {}) {
  const urls = new Set();
  for await (const html of htmlSources || []) {
    const source = String(html || '');
    for (const url of fontUrlsIn(source)) urls.add(url);
    for (const match of source.matchAll(DATA_CSS_BASE64)) {
      try {
        const css = Buffer.from(match[1], 'base64').toString('utf8');
        for (const url of fontUrlsIn(css)) urls.add(url);
      } catch {}
    }
  }
  if (!urls.size) return { assets: [] };
  const manifest = [...urls].map((url) => `url("${url}")`).join('\n');
  const result = await freezeRemoteFontAssets(manifest, options);
  return { assets: result.assets };
}
