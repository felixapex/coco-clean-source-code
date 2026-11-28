import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateComponentCandidate } from './lib/unit-self-verification.mjs';

const root = path.resolve(import.meta.dirname, '..');
const stageArgument = process.argv.find((value) => value.startsWith('--stage='))?.slice('--stage='.length);
if (!stageArgument) throw new Error('Missing --stage=...');
const stage = path.resolve(root, stageArgument);
const library = path.join(stage, 'component-library');
const registry = JSON.parse(await fs.readFile(path.join(library, 'component-registry.json'), 'utf8'));
const availableAssetHrefs = JSON.parse(await fs.readFile(path.join(library, 'asset-manifest.json'), 'utf8')).map((asset) => asset.href);
const counts = { total: 0, complete: 0, missing: 0, legacy: 0, explicit: 0, sizes: 0, style: 0, none: 0 };
const samples = { legacy: [], explicit: [], sizes: [], style: [], none: [] };
const failedComponents = [];

for (const component of registry.components || []) {
  const variant = component.variants?.[0];
  const markup = await fs.readFile(path.join(stage, variant.markupHref.replace(/^\//, '')), 'utf8');
  const result = evaluateComponentCandidate({ ...component, sourceMarkup: markup }, { availableAssetHrefs });
  if (!result.pass) failedComponents.push({
    componentId: component.matboxComponentId,
    componentType: component.sourceSectionType,
    failures: result.failures,
  });
  for (const match of markup.matchAll(/<img\b[^>]*>/gi)) {
    counts.total += 1;
    const tag = match[0];
    if (/data-matbox-image-intrinsic-width=/i.test(tag) && /data-matbox-image-rendered-width=/i.test(tag)) {
      counts.complete += 1;
      continue;
    }
    counts.missing += 1;
    let category = 'none';
    if (/data-matbox-captured-width=/i.test(tag) || /data-matbox-original-natural-width=/i.test(tag)) category = 'legacy';
    else if (/\bwidth=["'][^"']+/i.test(tag) && /\bheight=["'][^"']+/i.test(tag)) category = 'explicit';
    else if (/\bsizes=["'][^"']+/i.test(tag)) category = 'sizes';
    else if (/\bstyle=["'][^"']*(?:width|height)/i.test(tag)) category = 'style';
    counts[category] += 1;
    if (samples[category].length < 3) samples[category].push(tag.slice(0, 1000));
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  stage,
  componentCount: registry.components?.length || 0,
  failedComponentCount: failedComponents.length,
  counts,
  samples,
  failuresByType: Object.entries(failedComponents.flatMap((entry) => entry.failures).reduce((accumulator, failure) => {
    accumulator[failure.type] = (accumulator[failure.type] || 0) + 1;
    return accumulator;
  }, {})),
};
const output = path.join(root, 'artifacts', 'full-site-audit', 'component-image-geometry-audit.json');
await fs.writeFile(output, `${JSON.stringify({ ...report, failedComponents }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...report, output }, null, 2));
if (failedComponents.length > 0) process.exitCode = 1;
