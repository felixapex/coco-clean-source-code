import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function run(label, command, args) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function manifestsUnder(root) {
  const found = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.name === 'manifest.json') found.push(p);
    }
  }
  await walk(root);
  return found;
}

async function requireArtifact(root, type) {
  const manifests = await manifestsUnder(root);
  for (const manifestPath of manifests) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (manifest.artifacts?.some((artifact) => artifact.type === type)) return manifestPath;
  }
  throw new Error(`Verification artifact '${type}' not found under ${root}`);
}

run('Full test suite', process.execPath, ['scripts/run-tests.mjs']);

const controlledRoot = path.resolve('.verify-artifacts/controlled');
await fs.rm(controlledRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Controlled single-page Chromium/CDP demo', process.execPath, ['src/cli/capture-fixture-demo.mjs', '--out', controlledRoot]);
await requireArtifact(controlledRoot, 'benchmark');

const siteRoot = path.resolve('.verify-artifacts/site');
await fs.rm(siteRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('One-URL multi-page component-library demo', process.execPath, ['src/cli/run-site-fixture-demo.mjs', '--out', siteRoot]);
const siteManifest = await requireArtifact(siteRoot, 'component-library');
await requireArtifact(siteRoot, 'component-ir');

const complexRoot = path.resolve('.verify-artifacts/complex-site');
await fs.rm(complexRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Complex component hierarchy/state demo', process.execPath, ['src/cli/run-complex-site-demo.mjs', '--out', complexRoot]);
await requireArtifact(complexRoot, 'component-library');
await requireArtifact(complexRoot, 'component-ir');

await fs.access(path.join(siteRoot, 'replay', 'manifest.json'));
await fs.access(path.join(complexRoot, 'replay', 'manifest.json'));

const benchmarkRoot = path.resolve('.verify-artifacts/golden-benchmark');
await fs.rm(benchmarkRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Offline Golden replay benchmark', process.execPath, [
  'src/cli/run-golden-benchmark-demo.mjs',
  '--site-replay', path.join(siteRoot, 'replay'),
  '--complex-replay', path.join(complexRoot, 'replay'),
  '--out', benchmarkRoot,
]);
const goldenReport = JSON.parse(await fs.readFile(path.join(benchmarkRoot, 'golden-benchmark-report.json'), 'utf8'));
if (!goldenReport.passed) throw new Error(`Golden benchmark gates failed: ${JSON.stringify(goldenReport.failedGates)}`);
if (goldenReport.siteCount !== 2) throw new Error(`Expected 2 Golden benchmark sites, got ${goldenReport.siteCount}`);
if (goldenReport.aggregate.coverage !== 1) throw new Error(`Golden coverage mismatch: ${goldenReport.aggregate.coverage}`);
if (goldenReport.aggregate.clustering.f1 !== 1) throw new Error(`Golden clustering F1 mismatch: ${goldenReport.aggregate.clustering.f1}`);

const realReleaseRoot = path.resolve('.verify-artifacts/real-release-workflow');
await fs.rm(realReleaseRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Authorized capture -> approved Gold -> release-gate workflow demo', process.execPath, [
  'src/cli/run-real-release-workflow-demo.mjs',
  '--site-replay', path.join(siteRoot, 'replay'),
  '--complex-replay', path.join(complexRoot, 'replay'),
  '--out', realReleaseRoot,
]);
const releaseReport = JSON.parse(await fs.readFile(path.join(realReleaseRoot, 'benchmark', 'golden-benchmark-report.json'), 'utf8'));
if (!releaseReport.passed) throw new Error(`Real release workflow gates failed: ${JSON.stringify(releaseReport.failedGates)}`);
if (releaseReport.siteCount !== 2) throw new Error(`Expected 2 controlled release sites, got ${releaseReport.siteCount}`);
await fs.access(path.join(realReleaseRoot, 'real-site-suite.json'));
await fs.access(path.join(realReleaseRoot, 'real-site-capture-report.json'));
await fs.access(path.join(realReleaseRoot, 'golden', 'fixture-shop.golden.json'));

const tableRoot = path.resolve('.verify-artifacts/data-table-state-site');
await fs.rm(tableRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Runtime DataTable state-machine demo', process.execPath, ['src/cli/run-data-table-state-demo.mjs', '--out', tableRoot]);
await requireArtifact(tableRoot, 'component-library');
await requireArtifact(tableRoot, 'component-ir');

const reactRoot = path.resolve('.verify-artifacts/generated-react');
await fs.rm(reactRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Component IR -> React scaffold compiler', process.execPath, ['src/cli/compile-ir-to-react.mjs', '--ir', path.join(tableRoot, 'component-ir.json'), '--out', reactRoot]);
run('Generated React TypeScript verification', 'tsc', ['-p', path.join(reactRoot, 'tsconfig.json'), '--noEmit']);
await fs.access(path.join(reactRoot, 'src', 'component-registry.ts'));
await fs.access(path.join(reactRoot, 'src', 'component-styles.css'));
await fs.access(path.join(reactRoot, 'src', 'layout.css'));

const visualRoot = path.resolve('.verify-artifacts/visual-fidelity');
await fs.rm(visualRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
run('Evidence -> CSS -> screenshot visual-fidelity demo', process.execPath, ['src/cli/run-visual-fidelity-demo.mjs', '--out', visualRoot, '--target', '0.98']);
const visualReport = JSON.parse(await fs.readFile(path.join(visualRoot, 'visual-report.json'), 'utf8'));
if (visualReport.version !== '0.8') throw new Error(`Unexpected visual report version: ${visualReport.version}`);
if (!(visualReport.styledSimilarity > visualReport.baselineSimilarity)) throw new Error(`Visual repair did not improve baseline: ${JSON.stringify(visualReport)}`);
if (!visualReport.meetsStrictTarget) throw new Error(`Visual fidelity target not met: ${JSON.stringify(visualReport)}`);
if (visualReport.autoRepairStatus !== 'passed') throw new Error(`Visual repair loop did not pass: ${JSON.stringify(visualReport)}`);
if (!(visualReport.autoRepairHistory?.length >= 2)) throw new Error(`Visual repair loop did not iterate: ${JSON.stringify(visualReport)}`);
if (visualReport.repairExecution?.codexStatus !== 'prepared-not-executed') throw new Error(`Codex repair request was not prepared: ${JSON.stringify(visualReport)}`);
await fs.access(path.join(visualRoot, 'source.png'));
await fs.access(path.join(visualRoot, 'baseline-preview.png'));
await fs.access(path.join(visualRoot, 'baseline-diff.png'));
await fs.access(path.join(visualRoot, 'styled-preview.png'));
await fs.access(path.join(visualRoot, 'diff.png'));
await fs.access(path.join(visualRoot, 'component-ir.json'));
await fs.access(path.join(visualRoot, 'visual-repair-task.json'));
await fs.access(path.join(visualRoot, 'codex-repair-request.json'));
const visualReactRoot = path.join(visualRoot, 'generated-react');
run('Repaired visual React TypeScript verification', 'tsc', ['-p', path.join(visualReactRoot, 'tsconfig.json'), '--noEmit']);
const repairedVisualCss = await fs.readFile(path.join(visualReactRoot, 'src', 'component-styles.css'), 'utf8');
if (!repairedVisualCss.includes('background-color:')) throw new Error('Visual repair did not update generated React CSS');

console.log(`\nVerification passed. Site manifest: ${siteManifest}. Visual similarity: ${visualReport.styledSimilarity}. Auto repair: ${visualReport.autoRepairStatus}`);
