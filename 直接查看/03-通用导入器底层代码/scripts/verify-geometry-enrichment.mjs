import fs from 'node:fs/promises';
import path from 'node:path';

import { captureHtml } from '../src/import-core/capture/chromium-capture.mjs';
import pngjs from 'pngjs';

const { PNG } = pngjs;
const root = path.resolve(import.meta.dirname, '..');
const route = process.argv.find((value) => value.startsWith('--route='))?.slice('--route='.length);
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!route?.startsWith('/')) throw new Error('One --route=/path argument is required');
if (/msedge\.exe$/i.test(chromiumPath)) throw new Error('Microsoft Edge automation is forbidden in this workspace');

const routes = JSON.parse(await fs.readFile(path.join(root, 'src', 'replay', 'routes.json'), 'utf8'));
const replayFile = routes[route];
if (!replayFile) throw new Error(`Unknown desktop replay route: ${route}`);

const sourcePath = path.join(root, 'src', 'replay', replayFile);
const candidatePath = path.join(root, 'artifacts', 'component-geometry-migration', replayFile);
const reportPath = path.join(root, 'artifacts', 'component-geometry-migration', `${path.basename(replayFile, '.html')}-parity.json`);
const [source, candidate] = await Promise.all([
  fs.readFile(sourcePath, 'utf8'),
  fs.readFile(candidatePath, 'utf8'),
]);

function occurrenceCount(value, pattern) {
  return (String(value).match(pattern) || []).length;
}

function baseHref(value) {
  return String(value).match(/<base\b[^>]*href=["']([^"']+)/i)?.[1] || null;
}

function screenshotSimilarity(leftBuffer, rightBuffer) {
  const left = PNG.sync.read(leftBuffer);
  const right = PNG.sync.read(rightBuffer);
  if (left.width !== right.width || left.height !== right.height) {
    return { similarity: 0, left: [left.width, left.height], right: [right.width, right.height] };
  }
  let difference = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    difference += Math.abs(left.data[index] - right.data[index]);
    difference += Math.abs(left.data[index + 1] - right.data[index + 1]);
    difference += Math.abs(left.data[index + 2] - right.data[index + 2]);
  }
  return {
    similarity: Math.max(0, 1 - (difference / (left.width * left.height * 3 * 255))),
    left: [left.width, left.height],
    right: [right.width, right.height],
  };
}

const captureOptions = {
  chromiumPath,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  viewport: { width: 1908, height: 1000, mobile: false },
};
const startedAt = Date.now();
const sourceCapture = await captureHtml(source, captureOptions);
const candidateCapture = await captureHtml(candidate, captureOptions);
const visual = screenshotSimilarity(sourceCapture.screenshot, candidateCapture.screenshot);
const sourceInventory = {
  base: baseHref(source),
  anchors: occurrenceCount(source, /<a\b/gi),
  buttons: occurrenceCount(source, /<button\b/gi),
  images: occurrenceCount(source, /<img\b/gi),
  forms: occurrenceCount(source, /<form\b/gi),
};
const candidateInventory = {
  base: baseHref(candidate),
  anchors: occurrenceCount(candidate, /<a\b/gi),
  buttons: occurrenceCount(candidate, /<button\b/gi),
  images: occurrenceCount(candidate, /<img\b/gi),
  forms: occurrenceCount(candidate, /<form\b/gi),
  geometryRecords: occurrenceCount(candidate, /data-matbox-component-width=/g),
};
const inventoriesMatch = Object.entries(sourceInventory).every(([key, value]) => candidateInventory[key] === value);
const report = {
  generatedAt: new Date().toISOString(),
  route,
  replayFile,
  pass: visual.similarity >= 0.995 && inventoriesMatch && candidateInventory.geometryRecords > 0,
  threshold: 0.995,
  elapsedMs: Date.now() - startedAt,
  visual,
  inventoriesMatch,
  source: sourceInventory,
  candidate: candidateInventory,
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
