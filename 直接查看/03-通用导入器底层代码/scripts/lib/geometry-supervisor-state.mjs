import fs from 'node:fs/promises';
import path from 'node:path';

export async function findCompleteGeometryFiles(batch, {
  replayRoot,
  readFile = fs.readFile,
  isComplete,
}) {
  const complete = new Set();
  for (const entry of batch) {
    const html = await readFile(path.join(replayRoot, entry.filename), 'utf8');
    if (isComplete(html)) complete.add(entry.filename);
  }
  return complete;
}

export function reconcileGeometryBatch(batch, geometryPresentFilenames, completedAt = new Date().toISOString()) {
  const completed = [];
  const incomplete = [];
  for (const entry of batch) {
    if (geometryPresentFilenames.has(entry.filename)) completed.push({ ...entry, completedAt });
    else incomplete.push(entry);
  }
  return { completed, incomplete };
}
