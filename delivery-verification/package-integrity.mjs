import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function listFiles(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(fullPath));
    else output.push(fullPath);
  }
  return output.sort();
}

export async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export function createVerificationPlan({ routeCount, imageCount, rounds }) {
  return Array.from({ length: rounds }, (_, index) => ({
    round: index + 1,
    desktopRoutesChecked: routeCount,
    mobileRoutesChecked: routeCount,
    imagesChecked: imageCount,
  }));
}

export async function readManifest(manifestPath) {
  const entries = new Map();
  const lines = (await fs.readFile(manifestPath, 'utf8')).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw new Error(`invalid SHA256 manifest line: ${line}`);
    if (entries.has(match[2])) throw new Error(`duplicate SHA256 manifest entry: ${match[2]}`);
    entries.set(match[2], match[1]);
  }
  return entries;
}

async function checkMany(items, worker, concurrency = 8) {
  let index = 0;
  const failures = [];
  async function run() {
    while (index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (error) {
        failures.push(String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, run));
  if (failures.length) throw new Error(failures.slice(0, 20).join('\n'));
}

export async function verifyManifest(packageRoot, manifestName = 'SHA256SUMS.txt') {
  const manifestPath = path.join(packageRoot, manifestName);
  const entries = await readManifest(manifestPath);
  const payloadFiles = (await listFiles(packageRoot)).filter(file => path.basename(file) !== manifestName);
  const relativeFiles = payloadFiles.map(file => path.relative(packageRoot, file).split(path.sep).join('/')).sort();
  const missing = relativeFiles.filter(file => !entries.has(file));
  const extra = [...entries.keys()].filter(file => !relativeFiles.includes(file));
  if (missing.length || extra.length) {
    throw new Error(`SHA256 manifest coverage mismatch; missing=${missing.length}, extra=${extra.length}`);
  }
  await checkMany(relativeFiles, async relativePath => {
    const actual = await hashFile(path.join(packageRoot, ...relativePath.split('/')));
    const expected = entries.get(relativePath);
    if (actual !== expected) throw new Error(`SHA256 mismatch: ${relativePath}`);
  });
  return { payloadFilesChecked: relativeFiles.length, manifestEntries: entries.size, pass: true };
}
