import fs from 'node:fs/promises';

export function createRouteManifestCache({ staticMode = false, stat = fs.stat, readFile = fs.readFile } = {}) {
  const entries = new Map();
  return {
    async read(filePath) {
      const existing = entries.get(filePath);
      if (staticMode && existing) return existing.value;
      const metadata = await stat(filePath);
      if (existing && existing.mtimeMs === metadata.mtimeMs && existing.size === metadata.size) return existing.value;
      const value = JSON.parse(await readFile(filePath, 'utf8'));
      entries.set(filePath, { mtimeMs: metadata.mtimeMs, size: metadata.size, value });
      return value;
    },
  };
}
