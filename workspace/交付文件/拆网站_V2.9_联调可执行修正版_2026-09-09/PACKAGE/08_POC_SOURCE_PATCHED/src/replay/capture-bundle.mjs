import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}


function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relativePath);
  if (absolute !== resolvedRoot && !absolute.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`Replay path escapes bundle root: ${relativePath}`);
  }
  return absolute;
}

function safePageDir(index) {
  return String(index + 1).padStart(4, '0');
}

async function externalize(value, { root, pageDir, blobs, counter }) {
  if (Buffer.isBuffer(value)) {
    const id = counter.value++;
    const relative = path.posix.join('pages', pageDir, 'blobs', `${String(id).padStart(4, '0')}.bin`);
    const absolute = path.join(root, ...relative.split('/'));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, value);
    const hash = sha256(value);
    blobs.push({ path: relative, sha256: hash, bytes: value.length });
    return { $binary: relative, sha256: hash, bytes: value.length };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await externalize(item, { root, pageDir, blobs, counter }));
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = await externalize(child, { root, pageDir, blobs, counter });
    }
    return out;
  }
  return value;
}

async function rehydrate(value, root) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => rehydrate(item, root)));
  if (value && typeof value === 'object') {
    if (typeof value.$binary === 'string') {
      const absolute = resolveInside(root, value.$binary);
      const buffer = await fs.readFile(absolute);
      const actual = sha256(buffer);
      if (actual !== value.sha256) throw new Error(`SHA-256 mismatch for replay blob ${value.$binary}`);
      return buffer;
    }
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = await rehydrate(child, root);
    return out;
  }
  return value;
}

export async function writeCaptureBundle({ startUrl, pages, outputRoot, metadata = {} }) {
  if (!startUrl) throw new Error('startUrl is required');
  if (!Array.isArray(pages) || !pages.length) throw new Error('pages must be a non-empty array');
  if (!outputRoot) throw new Error('outputRoot is required');

  const root = path.resolve(outputRoot);
  await fs.mkdir(root, { recursive: true });
  const blobs = [];
  const pageEntries = [];

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    if (!page?.url || !page.capture) throw new Error(`Invalid page at index ${index}`);
    const pageDir = safePageDir(index);
    const relativeCapture = path.posix.join('pages', pageDir, 'capture.json');
    const absoluteCapture = path.join(root, ...relativeCapture.split('/'));
    const counter = { value: 1 };
    const externalized = await externalize(page.capture, { root, pageDir, blobs, counter });
    await fs.mkdir(path.dirname(absoluteCapture), { recursive: true });
    await fs.writeFile(absoluteCapture, `${JSON.stringify(externalized, null, 2)}\n`, 'utf8');
    pageEntries.push({ url: new URL(page.url).href, capture: relativeCapture });
  }

  const manifest = {
    version: '0.1',
    startUrl: new URL(startUrl).href,
    createdAt: new Date().toISOString(),
    pages: pageEntries,
    blobs,
    metadata,
  };
  await fs.writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export async function readCaptureBundle(root) {
  const resolved = path.resolve(root);
  const manifest = JSON.parse(await fs.readFile(path.join(resolved, 'manifest.json'), 'utf8'));
  if (manifest.version !== '0.1') throw new Error(`Unsupported replay bundle version: ${manifest.version}`);

  // Verify every declared blob before returning any replay data.
  for (const blob of manifest.blobs ?? []) {
    const absolute = resolveInside(resolved, blob.path);
    const buffer = await fs.readFile(absolute);
    const actual = sha256(buffer);
    if (actual !== blob.sha256) throw new Error(`SHA-256 mismatch for replay blob ${blob.path}`);
  }

  const pages = [];
  for (const page of manifest.pages ?? []) {
    const capturePath = resolveInside(resolved, page.capture);
    const raw = JSON.parse(await fs.readFile(capturePath, 'utf8'));
    pages.push({ url: page.url, capture: await rehydrate(raw, resolved) });
  }
  return { root: resolved, manifest, pages };
}

export function createReplayCaptureFn(bundle) {
  if (!bundle?.pages) throw new Error('Replay bundle pages are required');
  const byUrl = new Map(bundle.pages.map((page) => [new URL(page.url).href, page.capture]));
  return async (rawUrl) => {
    const url = new URL(rawUrl).href;
    const capture = byUrl.get(url);
    if (!capture) throw new Error(`Replay page missing: ${url}`);
    return capture;
  };
}
