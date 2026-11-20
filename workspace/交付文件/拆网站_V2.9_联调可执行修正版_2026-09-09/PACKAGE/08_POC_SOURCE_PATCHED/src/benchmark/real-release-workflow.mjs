import fs from 'node:fs/promises';
import path from 'node:path';
import { readCaptureBundle, createReplayCaptureFn } from '../replay/capture-bundle.mjs';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { createGoldenDraft } from './golden-set.mjs';
import { runGoldenSuite } from './run-golden-suite.mjs';
import { validateRealSiteSuite } from './real-site-suite.mjs';

const replayResolver = async () => [{ address: '93.184.216.34', family: 4 }];

function captureById(captureReport) {
  return new Map((captureReport?.sites ?? []).map((site) => [site.siteId, site]));
}

export async function createGoldenDraftsFromCaptureReport({ captureReport, outputRoot }) {
  if (!captureReport || captureReport.version !== '1.0' || !Array.isArray(captureReport.sites)) throw new Error('Invalid real-site capture report');
  const root = path.resolve(outputRoot);
  await fs.mkdir(root, { recursive: true });
  const sites = [];

  for (const site of captureReport.sites) {
    if (!site.replayRoot || site.capturedPages <= 0) continue;
    const bundle = await readCaptureBundle(site.replayRoot);
    const pipeline = await runSiteComponentPipeline({
      startUrl: bundle.manifest.startUrl,
      outputRoot: path.join(root, '.evidence', site.siteId),
      captureFn: createReplayCaptureFn(bundle),
      resolver: replayResolver,
      maxPages: bundle.pages.length,
    });
    const draft = createGoldenDraft(pipeline.ir);
    const goldenPath = path.join(root, `${site.siteId}.golden.json`);
    await fs.writeFile(goldenPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    sites.push({ siteId: site.siteId, goldenPath, itemCount: draft.items.length, reviewStatus: 'unreviewed' });
  }

  const report = { version: '1.0', generatedAt: new Date().toISOString(), sites };
  await fs.writeFile(path.join(root, 'golden-draft-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

export async function runRealReleaseBenchmark({ realSuite: rawRealSuite, captureReport, goldenRoot, outputRoot }) {
  const realSuite = validateRealSiteSuite(rawRealSuite);
  if (!captureReport || captureReport.version !== '1.0') throw new Error('Invalid real-site capture report');
  const byId = captureById(captureReport);
  const missingCaptures = [];
  const sites = [];

  for (const site of realSuite.sites) {
    const captured = byId.get(site.id);
    if (!captured?.replayRoot || captured.capturedPages <= 0) {
      missingCaptures.push(site.id);
      continue;
    }
    const golden = path.join(path.resolve(goldenRoot), `${site.id}.golden.json`);
    sites.push({
      id: site.id,
      replayRoot: captured.replayRoot,
      startUrl: site.url,
      maxPages: site.capturePolicy.maxPages,
      clusterThreshold: site.clusterThreshold,
      golden,
    });
  }

  if (missingCaptures.length) {
    throw new Error(`Release benchmark requires successful capture for every configured site: ${missingCaptures.join(', ')}`);
  }

  return runGoldenSuite({
    suite: {
      version: '0.1',
      requireApprovedGold: true,
      gates: realSuite.releaseGates,
      sites,
    },
    outputRoot,
  });
}
