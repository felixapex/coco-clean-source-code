import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeCachedResourceText } from './lib/capture-validation.mjs';
import { imageSourceIdentity } from './lib/image-recovery-index.mjs';

const root = path.resolve(import.meta.dirname, '..');
const auditPath = path.resolve(
  process.argv.find((value) => value.startsWith('--audit='))?.slice('--audit='.length)
    || path.join(root, 'artifacts', 'component-geometry-migration', 'source-image-evidence-audit.json'),
);
const cacheRoot = path.resolve(
  process.argv.find((value) => value.startsWith('--cache='))?.slice('--cache='.length)
    || path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache'),
);
const outputPath = path.resolve(
  process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length)
    || path.join(root, 'artifacts', 'component-geometry-migration', 'missing-image-cache-audit.json'),
);

const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
const targets = [...new Set(audit.failures.map((failure) => failure.source).filter(Boolean))];
const targetIdentities = new Set(targets.map(imageSourceIdentity));
const candidatesByIdentity = new Map();
let scannedCacheFiles = 0;

async function readFirstLine(file) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(16_384);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    if (newline < 0) return '';
    return buffer.subarray(0, newline).toString('utf8').replace(/\r$/, '');
  } finally {
    await handle.close();
  }
}

for (const entry of await fs.readdir(cacheRoot, { withFileTypes: true }).catch(() => [])) {
  if (!entry.isFile() || !entry.name.endsWith('.resource')) continue;
  const cacheFile = path.join(cacheRoot, entry.name);
  scannedCacheFiles += 1;
  const source = await readFirstLine(cacheFile);
  const identity = imageSourceIdentity(source);
  if (!targetIdentities.has(identity)) continue;
  const text = await fs.readFile(cacheFile, 'utf8');
  const decoded = decodeCachedResourceText(text);
  if (!String(decoded.contentType || '').toLowerCase().startsWith('image/') || !decoded.buffer.length) continue;
  if (!candidatesByIdentity.has(identity)) candidatesByIdentity.set(identity, []);
  candidatesByIdentity.get(identity).push({
    source,
    cacheFile,
    contentType: decoded.contentType,
    byteLength: decoded.buffer.length,
  });
}

const recovered = [];
const missing = [];
for (const source of targets) {
  const candidates = candidatesByIdentity.get(imageSourceIdentity(source)) || [];
  const exact = candidates.find((candidate) => candidate.source === source);
  const selected = exact || candidates.sort((left, right) => right.byteLength - left.byteLength)[0] || null;
  if (selected) recovered.push({ targetSource: source, ...selected });
  else missing.push(source);
}

const report = {
  generatedAt: new Date().toISOString(),
  scannedCacheFiles,
  uniqueTargetCount: targets.length,
  recoveredCount: recovered.length,
  missingCount: missing.length,
  recovered,
  missing,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  scannedCacheFiles,
  uniqueTargetCount: targets.length,
  recoveredCount: recovered.length,
  missingCount: missing.length,
  outputPath,
}, null, 2)}\n`);
