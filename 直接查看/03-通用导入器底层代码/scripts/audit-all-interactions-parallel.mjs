import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assignInteractionAuditShards, mergeInteractionAuditReports } from './lib/interaction-audit-shards.mjs';

const root = path.resolve(import.meta.dirname, '..');
const distRoot = path.join(root, process.env.MATBOX_DIST_DIR || 'dist');
const workerArgument = process.argv.find((argument) => argument.startsWith('--workers='));
const workerCount = Math.min(2, Math.max(1, Number.parseInt(workerArgument?.slice('--workers='.length) || '2', 10)));
const routeManifest = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'routes.json'), 'utf8'));
const routes = Object.keys(routeManifest).sort();
const weights = new Map();
for (const route of routes) {
  const stat = await fs.stat(path.join(distRoot, 'replay', routeManifest[route]));
  weights.set(route, Math.max(1, stat.size));
}
const shards = assignInteractionAuditShards(routes, weights, workerCount);
const runRoot = path.join(root, 'artifacts', 'full-site-audit', 'interaction-shards', String(Date.now()));
await fs.mkdir(runRoot, { recursive: true });
const activeChildren = new Set();
let circuitOpened = false;

const executions = shards.map(async (shard) => {
  const routeFile = path.join(runRoot, `routes-${shard.index}.json`);
  const outputFile = path.join(runRoot, `report-${shard.index}.json`);
  const checkpointFile = path.join(runRoot, `checkpoint-${shard.index}.json`);
  await fs.writeFile(routeFile, `${JSON.stringify(shard.routes, null, 2)}\n`, 'utf8');
  const child = spawn(process.execPath, [
    'scripts/audit-all-interactions.mjs',
    `--route-file=${routeFile}`,
    `--output=${outputFile}`,
    `--checkpoint=${checkpointFile}`,
  ], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  activeChildren.add(child);
  let pending = '';
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines.filter(Boolean)) process.stdout.write(`[interaction-${shard.index + 1}] ${line}\n`);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[interaction-${shard.index + 1}] ${chunk}`));
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  activeChildren.delete(child);
  if (exitCode === 3 && !circuitOpened) {
    circuitOpened = true;
    for (const sibling of activeChildren) {
      if (sibling.exitCode === null) sibling.kill();
    }
  }
  if (pending.trim()) process.stdout.write(`[interaction-${shard.index + 1}] ${pending.trim()}\n`);
  let report = null;
  try { report = JSON.parse(await fs.readFile(outputFile, 'utf8')); } catch {}
  return { shard, outputFile, checkpointFile, exitCode, report };
});

const results = await Promise.all(executions);
const report = mergeInteractionAuditReports({ routes, reports: results.map((result) => result.report) });
report.workerCount = shards.length;
report.circuitOpened = circuitOpened;
report.shards = results.map(({ shard, outputFile, checkpointFile, exitCode, report: shardReport }) => ({
  index: shard.index,
  routeCount: shard.routes.length,
  weight: shard.weight,
  outputFile,
  checkpointFile,
  exitCode,
  pass: shardReport?.pass === true,
}));
if (results.some((result) => !result.report)) {
  report.pass = false;
  report.coverageFailures.push({ type: 'interaction-shard-report-missing' });
}
const outputPath = path.join(root, 'artifacts', 'full-site-audit', 'interaction-click-audit.json');
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  pass: report.pass,
  routes: report.sourceRouteCount,
  controls: report.visibleControlInstances,
  anchors: report.anchorInstances,
  buttonsClicked: report.clickedButtonInstances,
  internalTargets: report.uniqueInternalTargets,
  validatedTargets: report.validatedInternalTargets,
  failures: report.failures.length,
  coverageFailures: report.coverageFailures.length,
  workerCount: report.workerCount,
}, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
