import fs from 'node:fs/promises';
import path from 'node:path';

import {
  buildReplayPreflightCacheKey,
  writeReplayPreflightCache,
} from './lib/resource-preflight-cache.mjs';

const root = process.cwd();
const sourceReplayDir = path.join(root, 'src', 'replay');
const auditRoot = path.join(root, 'artifacts', 'full-site-audit');
const fontCacheDir = path.join(root, 'artifacts', 'frozen-remote-assets', 'fonts');
const cachePath = path.join(auditRoot, 'resource-preflight-cache.json');
const replayFiles = new Set();
for (const manifestName of ['routes.json', 'routes-mobile.json']) {
  const manifest = JSON.parse(await fs.readFile(path.join(sourceReplayDir, manifestName), 'utf8'));
  for (const replayFile of Object.values(manifest || {})) replayFiles.add(replayFile);
}

let newestSourceMtimeMs = 0;
for (const replayFile of replayFiles) {
  const stat = await fs.stat(path.join(sourceReplayDir, replayFile));
  newestSourceMtimeMs = Math.max(newestSourceMtimeMs, stat.mtimeMs);
}
const history = (await fs.readFile(path.join(auditRoot, 'generation-timing-history.jsonl'), 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((record) => record?.status === 'passed' && record?.generatedAt)
  .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt));
const acceptedRun = history[0];
if (!acceptedRun || Date.parse(acceptedRun.generatedAt) < newestSourceMtimeMs) {
  throw new Error('Cannot bootstrap preflight cache: no successful build newer than the replay sources');
}

const documentPreflight = JSON.parse(await fs.readFile(path.join(auditRoot, 'document-preflight.json'), 'utf8'));
if ((documentPreflight.failures || []).length > 0) {
  throw new Error('Cannot bootstrap preflight cache from a document preflight with failures');
}
const fontFiles = await fs.readdir(fontCacheDir, { withFileTypes: true });
const fontAssets = [];
for (const entry of fontFiles.filter((item) => item.isFile() && !item.name.endsWith('.partial'))) {
  const cachePathForAsset = path.join(fontCacheDir, entry.name);
  const stat = await fs.stat(cachePathForAsset);
  fontAssets.push({ cachePath: cachePathForAsset, byteLength: stat.size });
}
const cacheKey = await buildReplayPreflightCacheKey({ sourceReplayDir, replayFiles: [...replayFiles] });
await writeReplayPreflightCache({
  cachePath,
  cacheKey,
  fontPreflight: { assets: fontAssets },
  documentPreflight,
});
console.log(JSON.stringify({
  ok: true,
  cachePath,
  acceptedRun: acceptedRun.generatedAt,
  replayFiles: replayFiles.size,
  fontAssets: fontAssets.length,
  documents: (documentPreflight.documents || []).length,
}, null, 2));
