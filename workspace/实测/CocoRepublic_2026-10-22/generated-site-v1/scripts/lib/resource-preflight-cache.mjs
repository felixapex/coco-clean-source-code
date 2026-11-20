import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_CONTRACT_VERSION = 1;

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

async function statInventory(sourceReplayDir, replayFiles) {
  const inventory = [];
  for (const name of [...new Set(replayFiles || [])].sort()) {
    const stat = await fs.stat(path.join(sourceReplayDir, name));
    inventory.push({ name, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) });
  }
  return inventory;
}

export async function buildReplayPreflightCacheKey({ sourceReplayDir, replayFiles } = {}) {
  if (!sourceReplayDir) throw new TypeError('sourceReplayDir is required');
  const inventory = await statInventory(sourceReplayDir, replayFiles);
  return digest(JSON.stringify({ contractVersion: CACHE_CONTRACT_VERSION, inventory }));
}

async function cachedResourcesStillMatch(cache) {
  const resources = [
    ...(cache?.fontPreflight?.assets || []),
    ...(cache?.documentPreflight?.documents || []),
  ];
  for (const resource of resources) {
    if (!resource?.cachePath || !Number.isFinite(resource?.byteLength)) return false;
    try {
      const stat = await fs.stat(resource.cachePath);
      if (!stat.isFile() || stat.size !== resource.byteLength) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function loadReplayPreflightCache({ cachePath, cacheKey } = {}) {
  if (!cachePath || !cacheKey) throw new TypeError('cachePath and cacheKey are required');
  let cache;
  try {
    cache = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { hit: false, reason: 'cache-missing-or-invalid' };
    throw error;
  }
  if (cache?.contractVersion !== CACHE_CONTRACT_VERSION || cache?.cacheKey !== cacheKey) {
    return { hit: false, reason: 'cache-key-mismatch' };
  }
  if (!await cachedResourcesStillMatch(cache)) {
    return { hit: false, reason: 'cached-resource-missing-or-changed' };
  }
  return {
    hit: true,
    reason: 'cache-hit',
    fontPreflight: cache.fontPreflight || { assets: [] },
    documentPreflight: cache.documentPreflight || { documents: [], failures: [] },
  };
}

export async function writeReplayPreflightCache({
  cachePath,
  cacheKey,
  fontPreflight,
  documentPreflight,
} = {}) {
  if (!cachePath || !cacheKey) throw new TypeError('cachePath and cacheKey are required');
  const record = {
    contractVersion: CACHE_CONTRACT_VERSION,
    cacheKey,
    generatedAt: new Date().toISOString(),
    fontPreflight: fontPreflight || { assets: [] },
    documentPreflight: documentPreflight || { documents: [], failures: [] },
  };
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const temporary = `${cachePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await fs.rm(cachePath, { force: true });
  await fs.rename(temporary, cachePath);
  return record;
}
