import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  findCompleteGeometryFiles,
  reconcileGeometryBatch,
} from './lib/geometry-supervisor-state.mjs';
import { hasCompleteImageGeometryEvidence } from './lib/local-component-geometry.mjs';
import { writeAtomicVerified } from './lib/verified-write.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const reportRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const viewportName = process.argv.find((value) => value.startsWith('--viewport='))?.slice('--viewport='.length) || 'desktop';
if (!['desktop', 'mobile'].includes(viewportName)) throw new Error(`Unknown viewport: ${viewportName}`);
const suffix = viewportName === 'mobile' ? '-mobile' : '';
const statePath = path.join(reportRoot, `supervisor-state${suffix}.json`);
const batchPath = path.join(reportRoot, `supervisor-current-batch${suffix}.json`);
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const workers = Math.max(1, Number(process.argv.find((value) => value.startsWith('--workers='))?.slice('--workers='.length) || 4));
const batchSize = Math.max(workers, Number(process.argv.find((value) => value.startsWith('--batch-size='))?.slice('--batch-size='.length) || 48));
const maxAttempts = Math.max(1, Number(process.argv.find((value) => value.startsWith('--max-attempts='))?.slice('--max-attempts='.length) || 3));

if (/msedge\.exe$/i.test(chromiumPath)) throw new Error('Microsoft Edge automation is forbidden in this workspace');

async function saveState(state) {
  state.updatedAt = new Date().toISOString();
  await writeAtomicVerified(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function geometryPresentFiles(batch = null) {
  if (batch) {
    return findCompleteGeometryFiles(batch, {
      replayRoot,
      isComplete: (html) => html.includes('data-matbox-component-width=')
        && hasCompleteImageGeometryEvidence(html),
    });
  }
  try {
    const { stdout } = await execFileAsync('rg', [
      '-l',
      '--glob', '*.html',
      'data-matbox-image-container-ancestor-depth=',
      replayRoot,
    ], { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    return new Set(stdout.split(/\r?\n/).filter(Boolean).map((file) => path.basename(file)));
  } catch (error) {
    if (error.code === 1) return new Set();
    throw error;
  }
}

async function createState() {
  const routes = JSON.parse(await fs.readFile(path.join(replayRoot, `routes${suffix}.json`), 'utf8'));
  process.stdout.write(`SUPERVISOR_PREFLIGHT routes=${Object.keys(routes).length}\n`);
  const present = await geometryPresentFiles();
  const byFile = new Map();
  for (const [route, filename] of Object.entries(routes)) {
    if (!byFile.has(filename)) byFile.set(filename, route);
  }
  const pending = [...byFile.entries()]
    .filter(([filename]) => !present.has(filename))
    .map(([filename, route]) => ({ route, filename }));
  const state = {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    routeCount: Object.keys(routes).length,
    uniqueFileCount: byFile.size,
    initiallyPresent: byFile.size - pending.length,
    pending,
    completed: [],
    failed: [],
  };
  await saveState(state);
  return state;
}

async function loadOrCreateState() {
  try {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    if (state.schemaVersion === 2 && Array.isArray(state.pending) && Array.isArray(state.completed)) return state;
  } catch {}
  return createState();
}

async function runChild(batch, { childWorkers = workers, childChunkSize = 12 } = {}) {
  await writeAtomicVerified(batchPath, `${JSON.stringify(batch, null, 2)}\n`);
  const args = [
    '--expose-gc',
    path.join(root, 'scripts', 'enrich-local-component-geometry.mjs'),
    `--workers=${childWorkers}`,
    `--viewport=${viewportName}`,
    `--chunk-size=${Math.max(childWorkers, Math.min(childChunkSize, batch.length))}`,
    '--measurement-only',
    `--queue-file=${batchPath}`,
  ];
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, MATBOX_CHROMIUM_PATH: chromiumPath },
    stdio: 'inherit',
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Geometry child failed code=${code} signal=${signal || 'none'}`));
    });
  });
}

const state = await loadOrCreateState();
const startedAt = Date.now();
process.stdout.write(`SUPERVISOR_START pending=${state.pending.length} completed=${state.completed.length} batchSize=${batchSize}\n`);

while (state.pending.length > 0) {
  const originalBatch = state.pending.slice(0, batchSize);
  let batch = originalBatch;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts && batch.length > 0; attempt += 1) {
    lastError = null;
    try {
      await runChild(batch, {
        childWorkers: attempt === 1 ? workers : 1,
        childChunkSize: attempt === 1 ? 12 : 1,
      });
    } catch (error) {
      lastError = error;
    }

    const present = await geometryPresentFiles(batch);
    const reconciled = reconcileGeometryBatch(batch, present);
    if (reconciled.completed.length > 0) {
      const completedNames = new Set(reconciled.completed.map((entry) => entry.filename));
      state.completed.push(...reconciled.completed);
      state.pending = state.pending.filter((entry) => !completedNames.has(entry.filename));
    }
    batch = reconciled.incomplete;
    if (lastError || batch.length > 0) {
      state.failed.push({
        at: new Date().toISOString(),
        attempt,
        batch,
        error: String(lastError?.stack || lastError || 'Child exited without complete geometry evidence'),
      });
    }
    await saveState(state);
    process.stdout.write(`SUPERVISOR_ATTEMPT attempt=${attempt} recovered=${reconciled.completed.length} retry=${batch.length}\n`);
  }

  if (batch.length > 0) {
    throw lastError || new Error(`Geometry batch remained incomplete after ${maxAttempts} attempts: ${batch.map((entry) => entry.route).join(', ')}`);
  }
  await saveState(state);
  process.stdout.write(`SUPERVISOR_BATCH_COMPLETE batch=${originalBatch.length} completed=${state.completed.length} pending=${state.pending.length} elapsedMs=${Date.now() - startedAt}\n`);
}

process.stdout.write(`${JSON.stringify({
  status: 'complete',
  completed: state.completed.length,
  pending: state.pending.length,
  failedBatches: state.failed.length,
  elapsedMs: Date.now() - startedAt,
  statePath,
}, null, 2)}\n`);
