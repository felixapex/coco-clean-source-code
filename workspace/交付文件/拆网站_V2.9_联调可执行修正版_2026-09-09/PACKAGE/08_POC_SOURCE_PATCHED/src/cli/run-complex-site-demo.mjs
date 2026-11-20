import fs from 'node:fs/promises';
import path from 'node:path';
import { captureHtmlWithAutoStates } from '../capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { writeCaptureBundle } from '../replay/capture-bundle.mjs';
import { complexSite } from '../../examples/complex-site.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const out = path.resolve(arg('--out', './artifacts/complex-site'));
await fs.mkdir(out, { recursive: true });
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const captureFn = async (url) => {
  const html = complexSite[url];
  if (!html) throw new Error(`Fixture page missing: ${url}`);
  return captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 20 });
};

const result = await runSiteComponentPipeline({
  startUrl: 'https://app.example.com/',
  captureFn,
  resolver,
  outputRoot: out,
  maxPages: 2,
  clusterThreshold: 0.72,
});

await writeCaptureBundle({
  startUrl: result.ir.site.sourceUrl,
  pages: result.crawl.pages,
  outputRoot: path.join(out, 'replay'),
});

await fs.writeFile(path.join(out, 'component-library.json'), JSON.stringify(result.componentLibrary, null, 2));
await fs.writeFile(path.join(out, 'component-ir.json'), JSON.stringify(result.ir, null, 2));

const familyById = new Map(result.ir.componentFamilies.map((family) => [family.id, family]));
console.log(JSON.stringify({
  routes: result.ir.routes.map((route) => route.path),
  families: result.componentLibrary.families.map((family) => ({
    name: family.name,
    semanticRole: family.semanticRole,
    occurrenceCount: family.occurrenceCount,
    states: family.states,
    props: Object.keys(family.propsSchema),
    parents: (family.parentFamilyIds ?? []).map((id) => familyById.get(id)?.canonicalName ?? id),
    children: (family.childFamilyIds ?? []).map((id) => familyById.get(id)?.canonicalName ?? id),
  })),
  nestedInstances: result.ir.componentInstances.filter((instance) => instance.parentInstanceId).map((instance) => ({
    id: instance.id,
    family: familyById.get(instance.familyId)?.canonicalName,
    parentInstanceId: instance.parentInstanceId,
  })),
  discoveredInState: result.ir.componentInstances.filter((instance) => instance.discoveredInState).map((instance) => ({
    id: instance.id,
    family: familyById.get(instance.familyId)?.canonicalName,
    state: instance.discoveredInState,
  })),
  output: out,
}, null, 2));
