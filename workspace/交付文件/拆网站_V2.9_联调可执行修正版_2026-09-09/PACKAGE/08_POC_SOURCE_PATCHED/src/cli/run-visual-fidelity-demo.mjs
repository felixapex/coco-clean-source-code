import fs from 'node:fs/promises';
import path from 'node:path';
import { captureHtml } from '../capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { renderIrPreviewHtml } from '../compiler/ir-preview.mjs';
import { compileReactScaffold } from '../compiler/react-scaffold.mjs';
import { comparePngBuffers } from '../visual/image-diff.mjs';
import { runVisualRepairLoop } from '../visual/repair-loop.mjs';
import { buildCodexVisualRepairRequest } from '../providers/codex-visual-repair.mjs';
import {
  captureVisualWorkspaceRevision,
  applyDeterministicVisualRepair,
  restoreVisualWorkspaceRevision,
} from '../providers/local-style-repair.mjs';
import { visualFidelityHtml } from '../../examples/visual-fidelity-site.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const outDir = path.resolve(arg('--out', './artifacts/visual-fidelity'));
const strictTarget = Number(arg('--target', '0.98'));
const pocFloor = Number(arg('--floor', '0.90'));
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const captureFn = async () => captureHtml(visualFidelityHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
const result = await runSiteComponentPipeline({
  startUrl: 'https://visual.example.com/',
  captureFn,
  resolver: async () => [{ address: '93.184.216.34', family: 4 }],
  outputRoot: path.join(outDir, 'evidence'),
  maxPages: 1,
  clusterThreshold: 0.65,
});

const routeId = result.ir.routes[0].id;
const source = await captureHtml(visualFidelityHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
const referenceEvidenceId = result.ir.routes[0].evidenceIds.find((id) => result.ir.evidence.find((e) => e.id === id)?.type === 'screenshot') ?? null;
const reactWorkspace = path.join(outDir, 'generated-react');
await compileReactScaffold(result.ir, reactWorkspace, { includeVisualStyles: false });

const renderCache = new Map();
async function renderWorkspaceRevision(revision) {
  if (renderCache.has(revision.id)) return renderCache.get(revision.id);
  const componentCss = revision.files?.['src/component-styles.css'] ?? '';
  const layoutCss = revision.files?.['src/layout.css'] ?? '';
  const html = renderIrPreviewHtml(result.ir, routeId, { componentCss, layoutCss });
  const capture = await captureHtml(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const rendered = {
    screenshot: capture.screenshot,
    artifact: `${revision.id}.png`,
    html,
  };
  renderCache.set(revision.id, rendered);
  return rendered;
}

const initialRevision = await captureVisualWorkspaceRevision(reactWorkspace, { id: 'structure-only' });
const baseline = await renderWorkspaceRevision(initialRevision);
const baselineDiff = await comparePngBuffers(source.screenshot, baseline.screenshot, { includeDiffImage: true });

const sourcePath = path.join(outDir, 'source.png');
const baselineDiffPath = path.join(outDir, 'baseline-diff.png');
await Promise.all([
  fs.writeFile(sourcePath, source.screenshot),
  fs.writeFile(path.join(outDir, 'baseline-preview.png'), baseline.screenshot),
  fs.writeFile(baselineDiffPath, baselineDiff.diffImage),
]);

let firstRepairTask = null;
let codexRepairRequest = null;
const autoRepairLoop = await runVisualRepairLoop({
  routeId,
  referencePng: source.screenshot,
  threshold: strictTarget,
  maxIterations: 2,
  referenceEvidenceId,
  initialRevision,
  renderRevision: renderWorkspaceRevision,
  onRepairTask: async ({ task }) => {
    firstRepairTask ??= task;
    codexRepairRequest ??= buildCodexVisualRepairRequest({
      task,
      workspaceDir: reactWorkspace,
      referenceScreenshot: sourcePath,
      diffScreenshot: baselineDiffPath,
    });
  },
  repairRevision: async ({ iteration }) => applyDeterministicVisualRepair({
    ir: result.ir,
    workspaceDir: reactWorkspace,
    id: `evidence-style-${iteration}`,
  }),
  restoreRevision: async (revision) => restoreVisualWorkspaceRevision(revision, reactWorkspace),
});

const bestRendered = await renderWorkspaceRevision(autoRepairLoop.bestRevision);
const finalDiff = await comparePngBuffers(source.screenshot, bestRendered.screenshot, { includeDiffImage: true });

const report = {
  version: '0.8',
  routeId,
  metric: finalDiff.metric,
  baselineSimilarity: baselineDiff.similarity,
  styledSimilarity: finalDiff.similarity,
  improvement: finalDiff.similarity - baselineDiff.similarity,
  strictTarget,
  pocFloor,
  passesPocFloor: finalDiff.similarity >= pocFloor,
  meetsStrictTarget: finalDiff.similarity >= strictTarget,
  repairTaskEmitted: Boolean(firstRepairTask),
  autoRepairStatus: autoRepairLoop.status,
  autoRepairBestSimilarity: autoRepairLoop.bestSimilarity,
  autoRepairHistory: autoRepairLoop.history,
  repairExecution: {
    provider: 'local-deterministic-style',
    codexStatus: codexRepairRequest ? 'prepared-not-executed' : 'not-needed',
    maxIterations: 2,
    rollbackEnabled: true,
  },
};

await Promise.all([
  fs.writeFile(path.join(outDir, 'styled-preview.png'), bestRendered.screenshot),
  fs.writeFile(path.join(outDir, 'diff.png'), finalDiff.diffImage),
  fs.writeFile(path.join(outDir, 'preview.html'), bestRendered.html, 'utf8'),
  fs.writeFile(path.join(outDir, 'component-ir.json'), JSON.stringify(result.ir, null, 2) + '\n', 'utf8'),
  fs.writeFile(path.join(outDir, 'visual-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8'),
  fs.writeFile(path.join(outDir, 'visual-repair-task.json'), JSON.stringify(firstRepairTask, null, 2) + '\n', 'utf8'),
  fs.writeFile(path.join(outDir, 'codex-repair-request.json'), JSON.stringify(codexRepairRequest, null, 2) + '\n', 'utf8'),
]);

console.log(JSON.stringify(report, null, 2));
if (!report.passesPocFloor) process.exitCode = 1;
