import fs from 'node:fs/promises';
import path from 'node:path';
import { readCaptureBundle, createReplayCaptureFn } from '../replay/capture-bundle.mjs';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { assertGoldenApproved, createGoldenDraft, evaluateGoldenSite, evaluateGoldenSuite } from './golden-set.mjs';

async function loadGolden(value, baseDir = process.cwd()) {
  if (value && typeof value === 'object') return value;
  if (typeof value === 'string') {
    const file = path.isAbsolute(value) ? value : path.resolve(baseDir, value);
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
  throw new Error('Golden annotations must be an object or JSON path');
}

export async function runGoldenSuite({ suite, outputRoot, resolver }) {
  if (!suite || suite.version !== '0.1' || !Array.isArray(suite.sites)) throw new Error('Invalid Golden suite');
  if (!outputRoot) throw new Error('outputRoot is required');
  const root = path.resolve(outputRoot);
  await fs.mkdir(root, { recursive: true });
  const siteReports = [];
  const execution = [];
  // Replay is intentionally offline: URL syntax/IP policy still runs, but DNS is not queried.
  // The live capture phase already performs real resolution and browser request guarding.
  const replayResolver = resolver ?? (async () => [{ address: '93.184.216.34', family: 4 }]);

  for (const site of suite.sites) {
    if (!site.id || !site.replayRoot || !site.startUrl) throw new Error('Each Golden suite site requires id, replayRoot, and startUrl');
    const siteRoot = path.join(root, 'sites', site.id);
    await fs.mkdir(siteRoot, { recursive: true });
    const bundle = await readCaptureBundle(site.replayRoot);
    const captureFn = createReplayCaptureFn(bundle);
    const pipeline = await runSiteComponentPipeline({
      startUrl: site.startUrl,
      outputRoot: path.join(siteRoot, 'evidence'),
      captureFn,
      resolver: replayResolver,
      maxPages: site.maxPages ?? bundle.pages.length,
      clusterThreshold: site.clusterThreshold ?? 0.80,
    });
    const golden = await loadGolden(site.golden, site.replayRoot);
    if (suite.requireApprovedGold) assertGoldenApproved(golden);
    const draft = createGoldenDraft(pipeline.ir);
    const report = evaluateGoldenSite({ ir: pipeline.ir, golden });

    await fs.writeFile(path.join(siteRoot, 'component-ir.json'), `${JSON.stringify(pipeline.ir, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(siteRoot, 'component-library.json'), `${JSON.stringify(pipeline.componentLibrary, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(siteRoot, 'golden-draft.json'), `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    await fs.writeFile(path.join(siteRoot, 'site-benchmark-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    siteReports.push(report);
    execution.push({
      siteId: site.id,
      replayRoot: path.resolve(site.replayRoot),
      capturedRoutes: pipeline.ir.routes.length,
      componentFamilies: pipeline.ir.componentFamilies.length,
      componentInstances: pipeline.ir.componentInstances.length,
      crawlErrors: pipeline.crawl.errors,
    });
  }

  const aggregate = evaluateGoldenSuite(siteReports, suite.gates ?? {});
  const report = { ...aggregate, execution };
  await fs.writeFile(path.join(root, 'golden-benchmark-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}
