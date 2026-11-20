import fs from 'node:fs/promises';
import path from 'node:path';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { createIsolatedProjectWorkspace } from '../pipeline/project-workspace.mjs';
import { evaluatePipelineBudget, PIPELINE_BUDGET_MS, runWithPipelineDeadline } from '../pipeline/pipeline-policy.mjs';

function value(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const url = value('--url');
if (!url) {
  console.error('Usage: npm run url -- --url https://example.com --out ./artifacts/example --max-pages 20');
  process.exit(2);
}
const explicitOut = value('--out');
const projectsRoot = path.resolve(value('--projects-root', './artifacts/projects'));
const maxPages = Number(value('--max-pages', '20'));
const budgetMs = Number(value('--budget-ms', String(PIPELINE_BUDGET_MS)));
if (!Number.isInteger(maxPages) || maxPages <= 0) throw new Error('--max-pages must be a positive integer');
if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('--budget-ms must be a positive number');
const workspace = explicitOut
  ? { projectId: path.basename(path.resolve(explicitOut)), projectRoot: path.resolve(explicitOut) }
  : await createIsolatedProjectWorkspace({ projectsRoot, sourceUrl: url });
const out = workspace.projectRoot;
await fs.mkdir(out, { recursive: true });

const startedAt = Date.now();
const result = await runWithPipelineDeadline(() => runSiteComponentPipeline({
    startUrl: url,
    outputRoot: out,
    maxPages,
    clusterThreshold: 0.80,
  }), { budgetMs });
const budget = evaluatePipelineBudget(Date.now() - startedAt, budgetMs);

console.log(JSON.stringify({
  projectId: workspace.projectId,
  sourceUrl: result.ir.site.sourceUrl,
  routes: result.ir.routes.length,
  componentFamilies: result.ir.componentFamilies.length,
  componentInstances: result.ir.componentInstances.length,
  crawlErrors: result.crawl.errors,
  outputRoot: out,
  budget,
}, null, 2));
