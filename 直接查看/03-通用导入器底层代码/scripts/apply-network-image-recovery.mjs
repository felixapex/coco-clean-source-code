import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { localizeRecoveredImages } from './lib/image-recovery-patch.mjs';
import { writeAtomicVerified } from './lib/verified-write.mjs';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const artifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const evidence = JSON.parse(await fs.readFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), 'utf8'));
const manifestArgument = process.argv.find((value) => value.startsWith('--manifest='))?.slice('--manifest='.length);
const prefix = process.argv.find((value) => value.startsWith('--prefix='))?.slice('--prefix='.length) || 'network-image-recovery';
const manifestPath = path.resolve(manifestArgument || path.join(artifactRoot, 'network-image-recovery-manifest.json'));
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const recoveryBySource = new Map();

for (const [source, recovery] of Object.entries(manifest.entries || {})) {
  if (recovery.status !== 'recovered') continue;
  const buffer = await fs.readFile(recovery.file);
  const actual = crypto.createHash('sha256').update(buffer).digest('hex');
  if (actual !== recovery.sha256 || buffer.length !== recovery.byteLength) {
    throw new Error(`Network recovery verification failed: ${source}`);
  }
  recoveryBySource.set(source, {
    dataUrl: `data:${recovery.contentType};base64,${buffer.toString('base64')}`,
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

const stagingRoot = path.join(artifactRoot, `${prefix}-staging-${process.pid}`);
await fs.mkdir(stagingRoot, { recursive: true });
const staged = [];
let replacements = 0;
const replacementsBySource = {};
let alreadyLocalized = 0;
const alreadyLocalizedBySource = {};
for (const entry of affectedByFile.values()) {
  const sourcePath = path.join(replayRoot, entry.filename);
  const html = await fs.readFile(sourcePath, 'utf8');
  const patched = localizeRecoveredImages(html, recoveryBySource);
  replacements += patched.replaced;
  for (const [source, count] of Object.entries(patched.replacementsBySource)) {
    replacementsBySource[source] = (replacementsBySource[source] || 0) + count;
  }
  for (const [source, count] of Object.entries(patched.alreadyLocalizedBySource)) {
    alreadyLocalized += count;
    alreadyLocalizedBySource[source] = (alreadyLocalizedBySource[source] || 0) + count;
  }
  if (patched.replaced === 0) continue;
  const stagedPath = path.join(stagingRoot, entry.filename);
  await fs.writeFile(stagedPath, patched.html, 'utf8');
  staged.push({ ...entry, sourcePath, stagedPath, replacements: patched.replaced });
}

const expectedBySource = evidence.failures.reduce((counts, failure) => {
  if (recoveryBySource.has(failure.source)) counts[failure.source] = (counts[failure.source] || 0) + 1;
  return counts;
}, {});
const missingReplacements = Object.entries(expectedBySource).filter(([source, count]) => (
  (replacementsBySource[source] || 0) + (alreadyLocalizedBySource[source] || 0)
) < count);
if (missingReplacements.length) {
  throw new Error(`Network recovery replacement mismatch: ${JSON.stringify(missingReplacements.slice(0, 10))}`);
}
for (const entry of staged) {
  await writeAtomicVerified(entry.sourcePath, await fs.readFile(entry.stagedPath));
}

const queue = staged.map(({ route, filename }) => ({ route, filename }));
const queuePath = path.join(artifactRoot, `${prefix}-geometry-queue.json`);
const reportPath = path.join(artifactRoot, `${prefix}-report.json`);
await writeAtomicVerified(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
await writeAtomicVerified(reportPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  manifestPath,
  recoveredUniqueSources: recoveryBySource.size,
  replacements,
  alreadyLocalized,
  evidenceReplacements: expectedReplacements,
  additionalSameSourceReplacements: replacements - expectedReplacements,
  affectedFiles: staged.length,
  queuePath,
  files: staged.map(({ route, filename, replacements: count }) => ({ route, filename, replacements: count })),
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ recoveredUniqueSources: recoveryBySource.size, replacements, alreadyLocalized, affectedFiles: staged.length, queuePath, reportPath }, null, 2)}\n`);
