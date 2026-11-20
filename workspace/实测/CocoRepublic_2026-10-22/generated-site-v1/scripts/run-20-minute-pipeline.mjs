import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { evaluatePipelineBudget, resolveWorkerCount, resolveOriginWorkerCount, resolveAuditWorkerCount, resolveResumeMode } from './lib/pipeline-budget.mjs';
import { parseImportArguments, selectImporter } from './importers/select-importer.mjs';
import { decideRouteClosureStep } from './lib/route-closure-pipeline.mjs';
import { runTimedStage } from './lib/pipeline-timing.mjs';
import { buildFinalVerificationReport, buildStylesheetRecoveryGate, writeFinalVerificationReport } from './lib/final-verification-report.mjs';

const root = path.resolve(import.meta.dirname, '..');
const importRequest = parseImportArguments(process.argv.slice(2));
const importer = selectImporter(importRequest.platform);
const importContext = await importer.prepare(importRequest);
const sourceOrigin = importContext.sourceOrigin;
const startedAt = Date.now();
const workerCount = resolveWorkerCount(process.env.MATBOX_WORKERS);
let originWorkerCount = resolveOriginWorkerCount(process.env.MATBOX_SOURCE_WORKERS, workerCount);
const auditWorkerCount = resolveAuditWorkerCount(process.env.MATBOX_AUDIT_WORKERS, workerCount);
const resumeMode = resolveResumeMode(process.env.MATBOX_RESUME);
const timings = [];
const output = path.join(root, 'artifacts', 'full-site-audit');
const maxRouteClosurePasses = Math.max(1, Number.parseInt(process.env.MATBOX_ROUTE_CLOSURE_PASSES || '4', 10) || 4);
let server;
let failure;
let localOrigin = null;

async function readCurrentJson(fileName) {
  const filePath = path.join(output, fileName);
  try {
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs < startedAt) return null;
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeReport(status, error = null) {
  const elapsedMs = Date.now() - startedAt;
  const report = { importerId: importContext.importerId, platform: importContext.platform, mode: importContext.mode, sourceOrigin, localOrigin, generatedAt: new Date().toISOString(), status, workerCount, originWorkerCount, auditWorkerCount, resumeMode, elapsedMs, budget: evaluatePipelineBudget(elapsedMs), timings, failure: error };
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, '20-minute-pipeline.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function runStage(name, command, args, extraEnv = {}) {
  return runTimedStage({
    name,
    timings,
    checkpoint: async (timing) => writeReport('running', timing.error || null),
    execute: () => new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, MATBOX_IMPORT_PLATFORM: importContext.platform, MATBOX_IMPORT_MODE: importContext.mode, MATBOX_SOURCE_URL: sourceOrigin, MATBOX_WORKERS: String(workerCount), MATBOX_RESUME: resumeMode, ...extraEnv },
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`${name} failed with exit code ${code}`));
      });
    }),
  });
}

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Unable to allocate a local validation port'));
        else resolve(port);
      });
    });
  });
}

async function waitForServer(origin) {
  const limit = 15000;
  const until = Date.now() + limit;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${origin}/`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Local validation server did not start');
}

try {
  await runStage('route-discovery', process.execPath, ['scripts/discover-site-routes.mjs']);
  const routeInventory = JSON.parse(await fs.readFile(path.join(output, 'route-inventory.json'), 'utf8'));
  originWorkerCount = resolveOriginWorkerCount(process.env.MATBOX_SOURCE_WORKERS, workerCount, routeInventory.routeCount);
  await runStage('desktop-rendered-golden-capture', process.execPath, ['scripts/capture-rendered-golden.mjs', '--viewport=desktop'], { MATBOX_WORKERS: String(originWorkerCount) });
  for (let passIndex = 0; passIndex < maxRouteClosurePasses; passIndex += 1) {
    await runStage(`route-closure-stage-build-${passIndex + 1}`, process.execPath, ['scripts/build.mjs', '--stage-only']);
    const routeLinkAudit = JSON.parse(await fs.readFile(path.join(output, 'route-link-audit.json'), 'utf8'));
    const decision = decideRouteClosureStep(routeLinkAudit, { passIndex, maxPasses: maxRouteClosurePasses });
    timings.push({
      name: `route-closure-decision-${passIndex + 1}`,
      action: decision.action,
      missingRouteCount: decision.missingRouteCount,
    });
    if (decision.action === 'complete') break;
    if (decision.action === 'fail') throw new Error(`${decision.code}: ${decision.missingRouteCount} uncaptured local routes`);
    await runStage(`route-closure-expand-${passIndex + 1}`, process.execPath, ['scripts/extend-route-inventory-from-link-closure.mjs']);
    await runStage(`route-closure-capture-${passIndex + 1}`, process.execPath, ['scripts/capture-rendered-golden.mjs', '--viewport=desktop'], {
      MATBOX_WORKERS: String(originWorkerCount),
      MATBOX_RESUME: '1',
    });
  }
  await runStage('build', process.execPath, ['scripts/build.mjs']);
  const validationPort = await findAvailablePort();
  localOrigin = `http://127.0.0.1:${validationPort}`;
  server = spawn(process.execPath, ['scripts/serve.mjs'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(validationPort) },
  });
  await waitForServer(localOrigin);
  await runStage('desktop-fidelity', process.execPath, ['scripts/audit-full-site-fidelity.mjs', '--viewport=desktop'], { MATBOX_LOCAL_ORIGIN: localOrigin, MATBOX_WORKERS: String(auditWorkerCount) });
  await runStage('responsive-layout-gate', process.execPath, ['scripts/audit-responsive-layout.mjs'], { MATBOX_LOCAL_ORIGIN: localOrigin });
  await runStage('all-control-click-gate', process.execPath, ['scripts/audit-all-interactions.mjs'], { MATBOX_LOCAL_ORIGIN: localOrigin });
  await runStage('source-local-interaction-parity', process.execPath, ['scripts/audit-source-local-interactions.mjs'], { MATBOX_LOCAL_ORIGIN: localOrigin });
  await runStage('automated-regression', process.execPath, ['--test', '--test-concurrency=2', 'tests/*.test.mjs']);
} catch (error) {
  failure = String(error?.stack || error);
} finally {
  if (server?.exitCode === null) server.kill('SIGTERM');
}

const elapsedMs = Date.now() - startedAt;
const report = await writeReport(failure ? 'failed' : 'passed', failure || null);
const [routeLinkAudit, responsiveAudit, interactionAudit, editableAudit, generationTiming, baseline, stylesheetRecoveryLedger] = await Promise.all([
  readCurrentJson('route-link-audit.json'),
  readCurrentJson('responsive-layout.json'),
  readCurrentJson('interaction-click-audit.json'),
  readCurrentJson('editable-contract-audit.json'),
  readCurrentJson('generation-timing.json'),
  fs.readFile(path.join(output, 'generation-performance-baseline.json'), 'utf8').then(JSON.parse).catch(() => null),
  fs.readFile(path.join(output, 'recovery', 'stylesheets', 'recovery-ledger.json'), 'utf8').then(JSON.parse).catch(() => null),
]);
const finalVerification = buildFinalVerificationReport({
  routeLinkAudit,
  responsiveAudit,
  interactionAudit,
  editableAudit,
  stylesheetRecovery: buildStylesheetRecoveryGate(stylesheetRecoveryLedger),
  generationTiming,
  baseline,
  extraGates: { pipeline: { pass: !failure, failure: failure || null } },
});
await writeFinalVerificationReport(path.join(output, 'recovery', 'coco', 'final-verification.json'), finalVerification);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (failure) process.exitCode = 2;
