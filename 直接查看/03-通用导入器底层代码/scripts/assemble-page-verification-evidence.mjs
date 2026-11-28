import fs from 'node:fs/promises';
import path from 'node:path';
import { assemblePageVerificationEvidence, groupPageCompositions } from './lib/page-verification-evidence.mjs';

const root = process.cwd();
const argument = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const selectedRoutes = process.argv.filter((item) => item.startsWith('--route=')).map((item) => item.slice('--route='.length));
const distRoot = path.resolve(root, argument('dist', process.env.MATBOX_DIST_DIR || '.dist-staging'));
const artifactRoot = path.resolve(root, 'artifacts');
const outputRoot = path.resolve(root, argument('output', path.join('artifacts', 'page-verification')));

async function readJson(file) {
  return JSON.parse(await fs.readFile(path.resolve(root, file), 'utf8'));
}

async function acceptedComponentIds() {
  const acceptedRoot = path.join(artifactRoot, 'incremental-build', 'accepted');
  let folders = [];
  try { folders = await fs.readdir(acceptedRoot); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const ids = [];
  for (const folder of folders) {
    try {
      const manifest = await readJson(path.join(acceptedRoot, folder, 'accepted-unit-manifest.json'));
      if (manifest.pass === true && manifest.unitId) ids.push(manifest.unitId);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return ids;
}

const compositions = groupPageCompositions(await readJson(path.join(distRoot, 'component-library', 'page-compositions.json')));
const fidelity = await readJson(argument('fidelity', path.join('artifacts', 'full-site-audit', 'fidelity', 'summary.json')));
const responsive = await readJson(argument('responsive', path.join('artifacts', 'full-site-audit', 'responsive-layout.json')));
const interactions = {
  desktop: await readJson(argument('interaction-desktop', path.join('artifacts', 'full-site-audit', 'source-local-interaction-parity-targeted-desktop.json'))),
  mobile: await readJson(argument('interaction-mobile', path.join('artifacts', 'full-site-audit', 'source-local-interaction-parity-targeted-mobile.json'))),
};
const accepted = await acceptedComponentIds();
const pages = selectedRoutes.length ? compositions.filter((page) => selectedRoutes.includes(page.route)) : compositions;
await fs.mkdir(outputRoot, { recursive: true });
const results = [];
for (const composition of pages) {
  const evidence = assemblePageVerificationEvidence({ composition, acceptedComponentIds: accepted, fidelity, responsive, interactions });
  const output = path.join(outputRoot, `${encodeURIComponent(composition.route)}.json`);
  await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  const acceptedSet = new Set(evidence.acceptedComponentIds);
  const pass = evidence.componentIds.every((componentId) => acceptedSet.has(componentId))
    && Object.values(evidence.viewports).every((viewport) => viewport.visual.pass && viewport.geometry.pass)
    && evidence.interactions.pass;
  results.push({ route: composition.route, pass, output });
}
const report = { generatedAt: new Date().toISOString(), pageCount: results.length, passed: results.filter((item) => item.pass).length, failed: results.filter((item) => !item.pass).length, results };
await fs.writeFile(path.join(outputRoot, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.failed > 0 || report.pageCount === 0) process.exitCode = 2;

