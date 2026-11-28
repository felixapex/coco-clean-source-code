import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

async function fileMetadata(root, directory = root) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const rows = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      rows.push(...await fileMetadata(root, absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(absolute);
    rows.push({
      path: path.relative(root, absolute).replaceAll('\\', '/'),
      size: stat.size,
      mtimeMs: Math.trunc(stat.mtimeMs),
    });
  }
  return rows;
}

export async function candidateBuildStamp(distRoot) {
  const metadata = await fileMetadata(distRoot);
  return createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
}
