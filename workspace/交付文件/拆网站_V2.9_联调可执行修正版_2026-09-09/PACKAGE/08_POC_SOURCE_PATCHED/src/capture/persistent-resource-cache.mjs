import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const cacheStates = new Map();

function optionsFor(options = {}) {
  const cacheDir = String(options.cacheDir ?? process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_DIR ?? '').trim();
  const configuredMax = Number(options.maxBytes ?? process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_BYTES ?? DEFAULT_MAX_BYTES);
  return {
    cacheDir: cacheDir ? path.resolve(cacheDir) : '',
    maxBytes: Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_BYTES,
  };
}

function cacheFile(cacheDir, url) {
  const key = crypto.createHash('sha256').update(String(url)).digest('hex');
  return path.join(cacheDir, `${key}.resource`);
}

async function stateFor(cacheDir) {
  if (cacheStates.has(cacheDir)) return cacheStates.get(cacheDir);
  const promise = (async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    const files = new Map();
    let totalBytes = 0;
    for (const entry of await fs.readdir(cacheDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.resource')) continue;
      const file = path.join(cacheDir, entry.name);
      try {
        const stats = await fs.stat(file);
        files.set(file, { size: stats.size, mtimeMs: stats.mtimeMs });
        totalBytes += stats.size;
      } catch {}
    }
    return { files, totalBytes };
  })();
  cacheStates.set(cacheDir, promise);
  return promise;
}

async function prune(cacheDir, maxBytes, state) {
  if (state.totalBytes <= maxBytes) return;
  const oldestFirst = [...state.files.entries()].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs);
  for (const [file, metadata] of oldestFirst) {
    if (state.totalBytes <= maxBytes) break;
    try {
      await fs.unlink(file);
      state.totalBytes -= metadata.size;
      state.files.delete(file);
    } catch {}
  }
}

export async function loadPersistentResourceDataUrl(url, options = {}) {
  const source = String(url || '');
  const { cacheDir } = optionsFor(options);
  if (!cacheDir || !/^https?:\/\//i.test(source)) return null;
  const file = cacheFile(cacheDir, source);
  try {
    const content = await fs.readFile(file, 'utf8');
    const separator = content.indexOf('\n');
    if (separator < 0 || content.slice(0, separator) !== source) return null;
    const dataUrl = content.slice(separator + 1);
    if (!/^data:[^,]+,/i.test(dataUrl)) return null;
    const now = new Date();
    await fs.utimes(file, now, now).catch(() => {});
    return dataUrl;
  } catch {
    return null;
  }
}

export async function storePersistentResourceDataUrl(url, dataUrl, options = {}) {
  const source = String(url || '');
  const value = String(dataUrl || '');
  const { cacheDir, maxBytes } = optionsFor(options);
  if (!cacheDir || !/^https?:\/\//i.test(source) || !/^data:[^,]+,/i.test(value)) return false;
  const content = `${source}\n${value}`;
  const size = Buffer.byteLength(content, 'utf8');
  if (size > maxBytes) return false;
  const state = await stateFor(cacheDir);
  const file = cacheFile(cacheDir, source);
  if (state.files.has(file)) return true;
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temp, content, { flag: 'wx' });
    try {
      await fs.rename(temp, file);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      return true;
    }
    const now = Date.now();
    state.files.set(file, { size, mtimeMs: now });
    state.totalBytes += size;
    await prune(cacheDir, maxBytes, state);
    return state.files.has(file);
  } catch {
    await fs.unlink(temp).catch(() => {});
    return false;
  }
}
