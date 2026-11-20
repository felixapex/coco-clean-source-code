import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CAPTURE_CONTRACT_VERSION,
  captureContentSha256,
} from './lib/capture-cache.mjs';
import { routeFilename } from './lib/site-inventory.mjs';
import { writeAtomicVerified } from './lib/verified-write.mjs';

const root = path.resolve(import.meta.dirname, '..');
const auditRoot = path.join(root, 'artifacts', 'full-site-audit');
const goldenRoot = path.join(auditRoot, 'golden');
const replayRoot = path.join(root, 'src', 'replay');
const summary = JSON.parse(await fs.readFile(path.join(auditRoot, 'fidelity', 'summary.json'), 'utf8'));
const routes = JSON.parse(await fs.readFile(path.join(replayRoot, 'routes.json'), 'utf8'));
const selectedRoutes = process.argv.filter((arg) => arg.startsWith('--route=')).map((arg) => arg.slice(8));
const routeEntries = selectedRoutes.length
  ? selectedRoutes.map((route) => {
      if (!routes[route]) throw new Error(`Unknown route requested for sealing: ${route}`);
      return [route, routes[route]];
    })
  : Object.entries(routes);
const expectedVerifiedRoutes = routeEntries.length;

if (!summary.pass
  || summary.testedCells !== summary.expectedCells
  || summary.passedCells !== summary.expectedCells
  || summary.failedCells !== 0
  || summary.errorCells !== 0
  || summary.routeCount !== expectedVerifiedRoutes
  || (selectedRoutes.length && summary.results?.some((result) => !selectedRoutes.includes(result.route)))) {
  throw new Error(`Refusing to seal an unverified capture set: ${JSON.stringify({
    pass: summary.pass,
    routeCount: summary.routeCount,
    manifestRoutes: Object.keys(routes).length,
    selectedRoutes,
    expectedCells: summary.expectedCells,
    testedCells: summary.testedCells,
    passedCells: summary.passedCells,
    failedCells: summary.failedCells,
    errorCells: summary.errorCells,
  })}`);
}

function slug(route) {
  return routeFilename(route).replace(/^route-|\.html$/g, '');
}

let sealed = 0;
for (const [route, filename] of routeEntries) {
  const prefix = path.join(goldenRoot, `${slug(route)}-desktop`);
  const metadataPath = `${prefix}.json`;
  const screenshotPath = `${prefix}.png`;
  const replayPath = path.join(replayRoot, filename);
  const [metadataText, screenshot, replayHtml] = await Promise.all([
    fs.readFile(metadataPath, 'utf8'),
    fs.readFile(screenshotPath),
    fs.readFile(replayPath),
  ]);
  const metadata = JSON.parse(metadataText);
  if (metadata.captureContractVersion !== CAPTURE_CONTRACT_VERSION) {
    throw new Error(`Capture contract mismatch for ${route}`);
  }
  if (metadata.route !== route || !metadata.metadata?.visualReadiness) {
    throw new Error(`Capture metadata mismatch for ${route}`);
  }
  metadata.contentHashes = {
    replaySha256: captureContentSha256(replayHtml),
    screenshotSha256: captureContentSha256(screenshot),
  };
  metadata.sealedFromAudit = {
    generatedAt: summary.generatedAt,
    minimumSimilarity: summary.minimumSimilarity,
    testedCells: summary.testedCells,
    passedCells: summary.passedCells,
  };
  await writeAtomicVerified(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  sealed += 1;
}

process.stdout.write(`${JSON.stringify({
  sealed,
  routeCount: summary.routeCount,
  selectedRoutes,
  auditGeneratedAt: summary.generatedAt,
  minimumSimilarity: summary.minimumSimilarity,
  captureContractVersion: CAPTURE_CONTRACT_VERSION,
}, null, 2)}\n`);
