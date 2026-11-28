import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { evaluateInteractionConsensusRounds } from '../src/import-core/capture/interaction-stability.mjs';
import { routeFilename } from './lib/site-inventory.mjs';

const root = path.resolve(import.meta.dirname, '..');
const goldenRoot = path.join(root, 'artifacts', 'full-site-audit', 'golden');
const replayRoot = path.join(root, 'src', 'replay');
const stabilityRoundsRoot = path.join(goldenRoot, 'stability-rounds');
const reportPath = path.join(goldenRoot, 'representative-interaction-stability.json');
const roundCount = Math.max(3, Number.parseInt(process.env.MATBOX_STABILITY_ROUNDS || '3', 10) || 3);
const evaluateOnly = process.argv.includes('--evaluate-only');
const routes = process.argv.filter((argument) => argument.startsWith('--route=')).map((argument) => argument.slice(8));
const representativeRoutes = routes.length ? [...new Set(routes)] : [
  '/',
  '/-archer-deep-sofa.html',
  '/blog/4-ideas-you-can-steal-from-hotels-coco-republic-',
  '/bedroom/bedheads',
  '/4-parramatta-square',
  '/-architect-outdoor-jumbo-daybed.html',
  '/-ashley-sofa-3-seat.html',
  '/-camden-bedside-table.html',
];

function slug(route) {
  return routeFilename(route).replace(/^route-|\.html$/g, '');
}

function runCaptureRound(round) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/capture-rendered-golden.mjs',
      '--viewport=desktop',
      ...representativeRoutes.map((route) => `--route=${route}`),
    ], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        MATBOX_RESUME: '0',
        MATBOX_WORKERS: process.env.MATBOX_STABILITY_WORKERS || '1',
      },
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Representative capture round ${round} failed with exit code ${code}`));
    });
  });
}

async function readRound(round) {
  const inventories = {};
  const archiveRoot = path.join(stabilityRoundsRoot, `round-${round}`);
  await fs.mkdir(archiveRoot, { recursive: true });
  for (const route of representativeRoutes) {
    const metadataPath = path.join(goldenRoot, `${slug(route)}-desktop.json`);
    const screenshotPath = path.join(goldenRoot, `${slug(route)}-desktop.png`);
    const replayPath = path.join(replayRoot, routeFilename(route));
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    if (!metadata.metadata?.interactionInventory) throw new Error(`Missing interaction inventory for ${route}`);
    inventories[route] = metadata.metadata.interactionInventory;
    await Promise.all([
      fs.copyFile(metadataPath, path.join(archiveRoot, `${slug(route)}-desktop.json`)),
      fs.copyFile(screenshotPath, path.join(archiveRoot, `${slug(route)}-desktop.png`)),
      fs.copyFile(replayPath, path.join(archiveRoot, `${slug(route)}-desktop.html`)),
    ]);
  }
  return { round, capturedAt: new Date().toISOString(), inventories };
}

async function restoreRepresentativeArtifacts(routesReport) {
  const restored = [];
  for (const routeReport of routesReport) {
    if (!routeReport.pass || !routeReport.representativeRound) continue;
    const archiveRoot = path.join(stabilityRoundsRoot, `round-${routeReport.representativeRound}`);
    const route = routeReport.route;
    await Promise.all([
      fs.copyFile(path.join(archiveRoot, `${slug(route)}-desktop.json`), path.join(goldenRoot, `${slug(route)}-desktop.json`)),
      fs.copyFile(path.join(archiveRoot, `${slug(route)}-desktop.png`), path.join(goldenRoot, `${slug(route)}-desktop.png`)),
      fs.copyFile(path.join(archiveRoot, `${slug(route)}-desktop.html`), path.join(replayRoot, routeFilename(route))),
    ]);
    restored.push({ route, representativeRound: routeReport.representativeRound });
  }
  return restored;
}

const startedAt = Date.now();
let rounds = [];
let failure = null;
if (evaluateOnly) {
  try {
    const previousReport = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    rounds = previousReport.rounds || [];
    if (rounds.length < roundCount) throw new Error(`Stored stability evidence has only ${rounds.length}/${roundCount} rounds`);
  } catch (error) {
    failure = String(error?.stack || error);
  }
} else {
  try {
    for (let round = 1; round <= roundCount; round += 1) {
      process.stdout.write(`STABILITY_ROUND ${round}/${roundCount} routes=${representativeRoutes.length}\n`);
      await runCaptureRound(round);
      rounds.push(await readRound(round));
    }
  } catch (error) {
    failure = String(error?.stack || error);
  }
}

const routesReport = representativeRoutes.map((route) => ({
  route,
  ...evaluateInteractionConsensusRounds(rounds.map((round) => round.inventories[route]).filter(Boolean), {
    minimumRounds: roundCount,
  }),
}));
const restoredArtifacts = failure ? [] : await restoreRepresentativeArtifacts(routesReport);
const report = {
  generatedAt: new Date().toISOString(),
  evaluationMode: evaluateOnly ? 'stored-evidence' : 'fresh-capture',
  elapsedMs: Date.now() - startedAt,
  pass: !failure && routesReport.every((route) => route.pass),
  failure,
  roundCount,
  routeCount: representativeRoutes.length,
  restoredArtifacts,
  routes: routesReport,
  rounds,
};
await fs.mkdir(goldenRoot, { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ pass: report.pass, roundCount, routeCount: representativeRoutes.length, elapsedMs: report.elapsedMs, failure }, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
