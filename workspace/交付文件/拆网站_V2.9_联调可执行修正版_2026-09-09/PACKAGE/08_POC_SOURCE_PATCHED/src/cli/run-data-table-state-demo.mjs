import fs from 'node:fs/promises';
import path from 'node:path';
import { captureHtmlWithAutoStates } from '../capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../pipeline/run-site-component-pipeline.mjs';
import { dataTableStateSite } from '../../examples/data-table-state-site.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const out = path.resolve(arg('--out', './artifacts/data-table-state-site'));
await fs.mkdir(out, { recursive: true });
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const captureFn = async (url) => {
  const html = dataTableStateSite[url];
  if (!html) throw new Error(`Fixture page missing: ${url}`);
  return captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 20 });
};

const result = await runSiteComponentPipeline({
  startUrl: 'https://data.example.com/',
  captureFn,
  resolver,
  outputRoot: out,
  maxPages: 4,
  clusterThreshold: 0.65,
});

await fs.writeFile(path.join(out, 'component-library.json'), JSON.stringify(result.componentLibrary, null, 2));
await fs.writeFile(path.join(out, 'component-ir.json'), JSON.stringify(result.ir, null, 2));

const tableFamily = result.ir.componentFamilies.find((family) => family.semanticRole === 'data-table');
const tableInstances = result.ir.componentInstances.filter((instance) => instance.familyId === tableFamily?.id);
const interaction = result.ir.interactions.find((item) => item.componentFamilyId === tableFamily?.id);

console.log(JSON.stringify({
  routes: result.ir.routes.map((route) => route.path),
  dataTable: tableFamily ? {
    occurrenceCount: tableFamily.occurrenceCount,
    states: tableFamily.states,
    props: tableFamily.propsSchema,
    instanceStates: tableInstances.map((instance) => ({ routeId: instance.routeId, state: instance.state, availableStates: instance.availableStates })),
    transitions: interaction?.transitions ?? [],
  } : null,
  output: out,
}, null, 2));
