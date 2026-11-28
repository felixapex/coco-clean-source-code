import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MIME_TYPES = new Map([
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
]);

async function collectFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function collectVerifiedPublicAssets(rootDirectory, { publicDirectories = [], readConcurrency = 32 } = {}) {
  if (!Number.isInteger(readConcurrency) || readConcurrency < 1) {
    throw new TypeError('readConcurrency must be a positive integer');
  }
  const root = path.resolve(rootDirectory);
  const files = [];
  for (const relativeDirectory of publicDirectories) {
    const normalized = String(relativeDirectory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized.split('/').includes('..')) throw new TypeError(`Invalid public asset directory: ${relativeDirectory}`);
    const directory = path.resolve(root, normalized);
    if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new TypeError(`Public asset directory escapes root: ${relativeDirectory}`);
    try {
      files.push(...await collectFiles(directory));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const assets = await mapConcurrent([...new Set(files)].sort(), readConcurrency, async (file) => {
    const buffer = await fs.readFile(file);
    const relative = path.relative(root, file).split(path.sep).join('/');
    return {
      href: `/${relative}`,
      byteLength: buffer.byteLength,
      mimeType: MIME_TYPES.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    };
  });
  return assets;
}
