import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = await fs.readFile(new URL('../scripts/capture-rendered-golden.mjs', import.meta.url), 'utf8');
const auditSource = await fs.readFile(new URL('../scripts/audit-full-site-fidelity.mjs', import.meta.url), 'utf8');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const captureCorePath = fileURLToPath(new URL('../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs', import.meta.url));

async function productionScriptSources(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...await productionScriptSources(target));
    else if (/\.(?:mjs|js|cjs|ps1)$/i.test(entry.name)) sources.push({ target, source: await fs.readFile(target, 'utf8') });
  }
  return sources;
}

test('full-site first pass uses supervised bounded persistent worker pools instead of one unbounded pool', () => {
  assert.match(source, /import \{ captureHtml, capturePageBatch, capturePagePool \}/);
  assert.match(source, /runSupervisedCaptureChunks\(remainingJobs/);
  assert.match(source, /capturePagePool\(chunkJobs,/);
  assert.doesNotMatch(source, /capturePagePool\(remainingJobs,/);
  assert.doesNotMatch(source, /partitionForWorkers/);
});

test('full-site capture never hardcodes local Microsoft Edge', () => {
  assert.doesNotMatch(source, /Microsoft\/Edge\/Application\/msedge\.exe/i);
  assert.match(source, /chromiumPath: process\.env\.MATBOX_CHROMIUM_PATH/);
});

test('fidelity audit uses the configured non-Edge browser', () => {
  assert.doesNotMatch(auditSource, /Microsoft\/Edge\/Application\/msedge\.exe/i);
  assert.match(auditSource, /chromiumPath: process\.env\.MATBOX_CHROMIUM_PATH/);
});

test('all production browser scripts and the shared capture core contain no Edge executable fallback', async () => {
  const sources = await productionScriptSources(path.join(projectRoot, 'scripts'));
  sources.push({ target: captureCorePath, source: await fs.readFile(captureCorePath, 'utf8') });
  const offenders = sources
    .filter(({ source: scriptSource }) => /(?:Microsoft[\\/]Edge[\\/]Application[\\/]msedge\.exe|\bmsedge\.exe\b)/i.test(scriptSource))
    .map(({ target }) => path.relative(projectRoot, target));
  assert.deepEqual(offenders, []);
});

test('fidelity audit uses one dynamic persistent worker pool instead of static viewport shards', () => {
  assert.match(auditSource, /import \{ capturePage, capturePageBatch, capturePagePool \}/);
  assert.match(auditSource, /await capturePagePool\(localEntries,/);
  assert.doesNotMatch(auditSource, /const batches = \[\]/);
  assert.doesNotMatch(auditSource, /viewportBatches/);
});
