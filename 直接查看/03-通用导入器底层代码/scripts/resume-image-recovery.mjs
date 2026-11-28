import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const chromium = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dryRun = process.argv.includes('--dry-run');
const steps = [
  'compile-current-blockers',
  'recover-from-same-sku-product-pages',
  'retry-pending-network-images',
  'apply-newly-recovered-images',
  'remeasure-only-changed-pages',
  'recompile-blockers-and-problem-list',
  'publish-recovered-images-to-dist',
];

if (/msedge\.exe$/i.test(chromium)) throw new Error('Microsoft Edge automation is forbidden in this workspace');
if (dryRun) {
  process.stdout.write(`${JSON.stringify({ steps, chromium }, null, 2)}\n`);
  process.exit(0);
}

function runNode(args, { allowedExitCodes = [0], echo = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, MATBOX_CHROMIUM_PATH: chromium },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (echo) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (echo) process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (allowedExitCodes.includes(code)) resolve({ code, stdout, stderr });
      else reject(new Error(`Command failed (${code ?? signal}): node ${args.join(' ')}\n${stderr || stdout}`));
    });
  });
}

await runNode(['scripts/compile-image-recovery-blockers.mjs']);
await runNode(['scripts/recover-images-from-same-sku-pages.mjs']);
const sameSkuApplyResult = await runNode([
  'scripts/apply-network-image-recovery.mjs',
  '--manifest=artifacts/component-geometry-migration/same-sku-page-image-recovery-manifest.json',
  '--prefix=same-sku-page-image-recovery-resume',
], { echo: false });
const sameSkuApplySummary = JSON.parse(sameSkuApplyResult.stdout);
process.stdout.write(`${JSON.stringify({ step: 'apply-same-sku-page-images', ...sameSkuApplySummary }, null, 2)}\n`);
await runNode(['scripts/recover-missing-images-from-network.mjs'], { allowedExitCodes: [0, 2] });
const applyResult = await runNode([
  'scripts/apply-network-image-recovery.mjs',
  '--manifest=artifacts/component-geometry-migration/network-image-recovery-manifest.json',
  '--prefix=network-image-recovery-resume',
], { echo: false });
const applySummary = JSON.parse(applyResult.stdout);
process.stdout.write(`${JSON.stringify({ step: 'apply-newly-recovered-images', ...applySummary }, null, 2)}\n`);

const changedQueues = [sameSkuApplySummary, applySummary]
  .filter((summary) => summary.affectedFiles > 0)
  .map((summary) => summary.queuePath);
if (changedQueues.length > 0) {
  for (const queuePath of changedQueues) {
    await runNode([
      '--expose-gc',
      'scripts/enrich-local-component-geometry.mjs',
      '--workers=2',
      '--chunk-size=6',
      '--measurement-only',
      '--force',
      `--queue-file=${queuePath}`,
    ]);
  }
} else {
  process.stdout.write('IMAGE_RECOVERY_REMEASURE skipped=no-changed-pages\n');
}

await runNode(['scripts/compile-image-recovery-blockers.mjs']);
await runNode(['scripts/publish-recovered-images-to-dist.mjs']);
const blockerPath = path.join(root, 'artifacts', 'component-geometry-migration', 'image-recovery-blockers.json');
const issueListPath = path.join(root, 'artifacts', 'full-site-audit', 'validation-issues.json');
const [blockers, issueList] = await Promise.all([
  fs.readFile(blockerPath, 'utf8').then(JSON.parse),
  fs.readFile(issueListPath, 'utf8').then(JSON.parse),
]);
process.stdout.write(`${JSON.stringify({
  status: blockers.pass ? 'complete' : 'blocked',
  remainingUniqueSources: blockers.blockedUniqueSourceCount,
  remainingOccurrences: blockers.blockedOccurrenceCount,
  remainingFiles: blockers.blockedFileCount,
  openIssues: issueList.summary?.open || 0,
  blockerPath,
  issueListPath,
}, null, 2)}\n`);
if (!blockers.pass) process.exitCode = 2;
