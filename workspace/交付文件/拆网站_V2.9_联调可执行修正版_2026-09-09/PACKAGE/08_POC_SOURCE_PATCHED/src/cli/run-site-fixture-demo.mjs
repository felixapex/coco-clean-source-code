import fs from 'node:fs/promises';
import path from 'node:path';
import { captureHtmlWithAutoStates } from '../capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { writeCaptureBundle } from '../replay/capture-bundle.mjs';
import { multiPageSite } from '../../examples/multi-page-site.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const out = path.resolve(arg('--out', './artifacts/site-fixture'));
await fs.mkdir(out, { recursive: true });
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const captureFn = async (url) => {
  const html = multiPageSite[url];
  if (!html) throw new Error(`Fixture page missing: ${url}`);
  return captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 10 });
};

const result = await runSiteComponentPipeline({
  startUrl: 'https://shop.example.com/',
  captureFn,
  resolver,
  outputRoot: out,
  maxPages: 3,
  clusterThreshold: 0.78,
});

await writeCaptureBundle({
  startUrl: result.ir.site.sourceUrl,
  pages: result.crawl.pages,
  outputRoot: path.join(out, 'replay'),
});

console.log(JSON.stringify({
  routes: result.ir.routes.map((route) => route.path),
  families: result.componentLibrary.families.map((family) => ({
    name: family.name,
    semanticRole: family.semanticRole,
    occurrenceCount: family.occurrenceCount,
    variants: family.variants,
    states: family.states,
    props: Object.keys(family.propsSchema),
  })),
  crawlErrors: result.crawl.errors,
  manifestDir: path.dirname(result.siteManifest.artifacts[0]?.path ?? out),
}, null, 2));
