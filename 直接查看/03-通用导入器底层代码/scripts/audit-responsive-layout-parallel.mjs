import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assignResponsiveAuditShards, mergeResponsiveAuditReports } from './lib/responsive-audit-shards.mjs';

const root = path.resolve(import.meta.dirname, '..');
const distRoot = path.join(root, process.env.MATBOX_DIST_DIR || 'dist');
const workerArgument = process.argv.find((argument) => argument.startsWith('--workers='));
const workerCount = Math.max(1, Number.parseInt(workerArgument?.slice('--workers='.length) || process.env.MATBOX_RESPONSIVE_WORKERS || '6', 10));
const desktopRoutes = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'routes.json'), 'utf8'));
const mobileRoutes = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'routes-mobile.json'), 'utf8'));
const routeFileArgument = process.argv.find((argument) => argument.startsWith('--route-file='));
const routeFileRoutes = routeFileArgument
  ? JSON.parse(await fs.readFile(path.resolve(routeFileArgument.slice('--route-file='.length)), 'utf8'))
  : [];
const requestedRoutes = [
  ...process.argv.filter((argument) => argument.startsWith('--route=')).map((argument) => argument.slice('--route='.length)),
  ...routeFileRoutes,
];
const routes = (requestedRoutes.length ? [...new Set(requestedRoutes)] : Object.keys(desktopRoutes)).sort();
for (const route of routes) {
  if (!desktopRoutes[route]) throw new Error(`Unknown responsive audit route: ${route}`);
}
const weights = new Map();
for (const route of routes) {
  const files = [desktopRoutes[route], mobileRoutes[route]].filter(Boolean);
  let weight = 0;
  for (const file of files) {
    weight += (await fs.stat(path.join(distRoot, 'replay', file))).size;
  }
  weights.set(route, Math.max(1, weight));
}
const shards = assignResponsiveAuditShards(routes, weights, workerCount);
const runRoot = path.join(root, 'artifacts', 'full-site-audit', 'responsive-shards', String(Date.now()));
await fs.mkdir(runRoot, { recursive: true });

const executions = shards.map(async (shard) => {
  const routeFile = path.join(runRoot, `routes-${shard.index}.json`);
  const outputFile = path.join(runRoot, `report-${shard.index}.json`);
  await fs.writeFile(routeFile, `${JSON.stringify(shard.routes, null, 2)}\n`, 'utf8');
  const child = spawn(process.execPath, [
    'scripts/audit-responsive-layout.mjs',
    `--route-file=${routeFile}`,
    `--output=${outputFile}`,
  ], { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const lines = output.split(/\r?\n/);
    output = lines.pop() || '';
    for (const line of lines.filter(Boolean)) process.stdout.write(`[responsive-${shard.index + 1}] ${line}\n`);
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[responsive-${shard.index + 1}] ${chunk}`));
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (output.trim()) process.stdout.write(`[responsive-${shard.index + 1}] ${output.trim()}\n`);
  let report = null;
  try { report = JSON.parse(await fs.readFile(outputFile, 'utf8')); } catch {}
  return { shard, outputFile, exitCode, report };
});

const results = await Promise.all(executions);
const profiles = results.find((result) => result.report)?.report?.profiles || [];
const merged = mergeResponsiveAuditReports({ routes, profiles, reports: results.map((result) => result.report) });
merged.workerCount = shards.length;
merged.shards = results.map(({ shard, outputFile, exitCode, report }) => ({
  index: shard.index,
  routeCount: shard.routes.length,
  weight: shard.weight,
  outputFile,
  exitCode,
  pass: report?.pass === true,
}));
if (results.some((result) => !result.report)) {
  merged.pass = false;
  merged.coverageFailures.push({ type: 'responsive-shard-report-missing' });
}
const outputPath = path.join(root, 'artifacts', 'full-site-audit', 'responsive-layout.json');
await fs.writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ routeCount: merged.routeCount, cellCount: merged.cellCount, passedCells: merged.passedCells, failedCells: merged.failedCells, coverageFailures: merged.coverageFailures.length, workerCount: merged.workerCount, pass: merged.pass }, null, 2)}\n`);
if (!merged.pass) process.exitCode = 2;
