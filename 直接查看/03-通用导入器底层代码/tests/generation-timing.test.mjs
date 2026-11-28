import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('build persists separate generation phase timings', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');

  assert.match(source, /generation-timing\.json/);
  assert.match(source, /generation-timing-history\.jsonl/);
  assert.match(source, /fs\.appendFile\(generationTimingHistoryPath/);
  assert.match(source, /source-preparation/);
  assert.match(source, /page-analysis/);
  assert.match(source, /component-conversion/);
  assert.match(source, /site-generation/);
  assert.match(source, /elapsedMs/);
});

test('build streams replay HTML into staging instead of copying the 15GB source tree', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /fs\.cp\(sourceReplayDir,[\s\S]*?recursive:\s*true/);
  assert.match(source, /fs\.readFile\(path\.join\(sourceReplayDir, replayFile\)/);
  assert.match(source, /for \(const manifestName of \['routes\.json', 'routes-mobile\.json', 'interaction-routes\.json'\]\)/);
});

test('build transforms and externalizes each replay in one pass', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /async function prepareComponentPage/);
  const sourceRead = source.indexOf("fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8')");
  const externalize = source.indexOf('externalizePageAssetBundle', sourceRead);
  const pageAnalysisDone = source.indexOf("recordGenerationPhase('page-analysis')");
  assert.ok(sourceRead >= 0);
  assert.ok(externalize > sourceRead);
  assert.ok(pageAnalysisDone > externalize);
});

test('build preflights fonts and documents from one shared source scan', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');

  assert.match(source, /teeAsyncIterable\(sourceReplayHtml\(\), 2\)/);
  assert.match(source, /Promise\.all\(\[\s*preflightRemoteFontAssets/);
});
