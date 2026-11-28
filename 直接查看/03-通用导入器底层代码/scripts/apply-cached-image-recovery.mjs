import fs from 'node:fs/promises';
import path from 'node:path';

import { decodeCachedResourceText } from './lib/capture-validation.mjs';
import { localizeRecoveredImages } from './lib/image-recovery-patch.mjs';
import { writeAtomicVerified } from './lib/verified-write.mjs';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const artifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const evidence = JSON.parse(await fs.readFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), 'utf8'));
const cacheAudit = JSON.parse(await fs.readFile(path.join(artifactRoot, 'missing-image-cache-audit.json'), 'utf8'));
const recoveryBySource = new Map();

for (const recovery of cacheAudit.recovered) {
  const decoded = decodeCachedResourceText(await fs.readFile(recovery.cacheFile, 'utf8'));
  if (!String(decoded.contentType || '').toLowerCase().startsWith('image/') || !decoded.buffer.length) {
    throw new Error(`Invalid cached image recovery: ${recovery.targetSource}`);
  }
  recoveryBySource.set(recovery.targetSource, {
    dataUrl: `data:${decoded.contentType};base64,${decoded.buffer.toString('base64')}`,
  });
}

const affectedByFile = new Map();
let expectedReplacements = 0;
for (const failure of evidence.failures) {
  if (!recoveryBySource.has(failure.source)) continue;
  expectedReplacements += 1;
  if (!affectedByFile.has(failure.filename)) {
    affectedByFile.set(failure.filename, { route: failure.routes[0], filename: failure.filename });
  }
}

const stagingRoot = path.join(artifactRoot, `cache-recovery-staging-${process.pid}`);
await fs.mkdir(stagingRoot, { recursive: true });
const staged = [];
let replacements = 0;
for (const entry of affectedByFile.values()) {
  const sourcePath = path.join(replayRoot, entry.filename);
  const html = await fs.readFile(sourcePath, 'utf8');
  const patched = localizeRecoveredImages(html, recoveryBySource);
  if (patched.replaced === 0) throw new Error(`Expected cached image recovery in ${entry.filename}`);
  replacements += patched.replaced;
  const stagedPath = path.join(stagingRoot, entry.filename);
  await fs.writeFile(stagedPath, patched.html, 'utf8');
  staged.push({ ...entry, sourcePath, stagedPath, replacements: patched.replaced });
}

if (replacements !== expectedReplacements) {
  throw new Error(`Cached recovery replacement mismatch: expected ${expectedReplacements}, received ${replacements}`);
}

for (const entry of staged) {
  await writeAtomicVerified(entry.sourcePath, await fs.readFile(entry.stagedPath, 'utf8'));
}

const queue = staged.map(({ route, filename }) => ({ route, filename }));
const queuePath = path.join(artifactRoot, 'cached-image-recovery-geometry-queue.json');
const reportPath = path.join(artifactRoot, 'cached-image-recovery-report.json');
await fs.writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
await fs.writeFile(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  recoveredUniqueSources: recoveryBySource.size,
  replacements,
  affectedFiles: staged.length,
  queuePath,
  files: staged.map(({ route, filename, replacements: count }) => ({ route, filename, replacements: count })),
}, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  recoveredUniqueSources: recoveryBySource.size,
  replacements,
  affectedFiles: staged.length,
  queuePath,
  reportPath,
}, null, 2)}\n`);
