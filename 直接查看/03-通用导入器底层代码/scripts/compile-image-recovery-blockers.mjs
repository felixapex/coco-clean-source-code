import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeAtomicVerified } from './lib/verified-write.mjs';
import { buildImageRecoveryIssues } from './lib/validation-issue-list.mjs';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const artifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const evidence = JSON.parse(await fs.readFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), 'utf8'));
const recovered = new Set();

const cacheAudit = JSON.parse(await fs.readFile(path.join(artifactRoot, 'missing-image-cache-audit.json'), 'utf8'));
for (const entry of cacheAudit.recovered || []) recovered.add(entry.targetSource);
for (const name of [
  'network-image-recovery-manifest.json',
  'same-sku-page-image-recovery-manifest.json',
  'local-product-card-recovery-manifest.json',
  'historical-component-recovery-manifest.json',
]) {
  let report;
  try {
    report = JSON.parse(await fs.readFile(path.join(artifactRoot, name), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') continue;
    throw error;
  }
  if (!report) continue;
  for (const [source, entry] of Object.entries(report.entries || {})) if (entry.status === 'recovered') recovered.add(source);
}

const failures = evidence.failures.filter((failure) => !recovered.has(failure.source));
const byFile = new Map();
for (const failure of failures) {
  if (!byFile.has(failure.filename)) byFile.set(failure.filename, { filename: failure.filename, routes: new Set(), sources: new Set(), occurrences: 0 });
  const record = byFile.get(failure.filename);
  for (const route of failure.routes || []) record.routes.add(route);
  record.sources.add(failure.source);
  record.occurrences += 1;
}

const files = [];
for (const record of byFile.values()) {
  const buffer = await fs.readFile(path.join(replayRoot, record.filename));
  files.push({
    filename: record.filename,
    routes: [...record.routes].sort(),
    sources: [...record.sources].sort(),
    occurrences: record.occurrences,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  });
}
files.sort((left, right) => left.filename.localeCompare(right.filename));
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  pass: failures.length === 0,
  reason: failures.length ? 'source-image-network-unavailable-and-no-verified-local-candidate' : null,
  recoveredUniqueSources: recovered.size,
  blockedOccurrenceCount: failures.length,
  blockedUniqueSourceCount: new Set(failures.map((failure) => failure.source)).size,
  blockedFileCount: files.length,
  blockedRouteCount: new Set(files.flatMap((file) => file.routes)).size,
  networkEvidence: {
    direct: 'connection-reset',
    weserv: 'network-error',
    wsrv: 'network-error',
    cloudinary: 'canary-0-of-3',
  },
  files,
};
const reportPath = path.join(artifactRoot, 'image-recovery-blockers.json');
const queuePath = path.join(artifactRoot, 'image-recovery-resume-queue.json');
const issueListPath = path.join(root, 'artifacts', 'full-site-audit', 'validation-issues.json');
const existingIssueList = await fs.readFile(issueListPath, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error?.code === 'ENOENT') return { issues: [] };
    throw error;
  });
const issues = [
  ...(existingIssueList.issues || []).filter((issue) => issue.type !== 'unresolved-source-images'),
  ...buildImageRecoveryIssues(report),
].sort((left, right) => left.id.localeCompare(right.id));
await writeAtomicVerified(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await writeAtomicVerified(queuePath, `${JSON.stringify(files.map(({ filename, routes }) => ({ filename, route: routes[0] })), null, 2)}\n`);
await writeAtomicVerified(issueListPath, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  pass: issues.length === 0,
  summary: {
    total: issues.length,
    open: issues.filter((issue) => issue.status === 'open').length,
    blocking: issues.filter((issue) => issue.severity === 'blocking').length,
  },
  issues,
}, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, files: undefined, reportPath, queuePath, issueListPath }, null, 2)}\n`);
