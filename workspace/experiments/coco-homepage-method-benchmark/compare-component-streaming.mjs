import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { runComponentStream } from './component-stream-pipeline.mjs';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
const projectRoot = path.join(workspaceRoot, '实测', 'CocoRepublic_2026-10-22', 'generated-site-v1');
const sharedCapturePath = path.join(
  workspaceRoot,
  '交付文件',
  '拆网站_V2.9_联调可执行修正版_2026-09-09',
  'PACKAGE',
  '08_POC_SOURCE_PATCHED',
  'src',
  'capture',
  'chromium-capture.mjs',
);
const defaultSourcePath = path.join(
  import.meta.dirname,
  'results',
  'A-2026-11-18T21-58-12-172Z',
  'source.html',
);
const sourcePath = path.resolve(process.argv.find((item) => item.startsWith('--source='))?.slice(9) || defaultSourcePath);
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.join(import.meta.dirname, 'results', `component-stream-${runId}`);
const streamingFirst = process.argv.includes('--streaming-first');
await fsp.mkdir(outputRoot, { recursive: true });

const capture = await import(pathToFileURL(sharedCapturePath));
const componentRegistry = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'component-registry.mjs')));
const editableContract = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'editable-component-contract.mjs')));
const html = await fsp.readFile(sourcePath, 'utf8');
const htmlBuffer = Buffer.from(html, 'utf8');

// Component discovery is shared setup, like saving the source site's standard answer.
// It is outside both timed methods so neither method receives an unfair advantage.
const discovered = componentRegistry.extractPageComponents(html, '/');
const components = discovered.components;

function locateComponentEnds(buffer, items) {
  let cursor = 0;
  return items.map((component) => {
    const needle = Buffer.from(component.sourceMarkup, 'utf8');
    const start = buffer.indexOf(needle, cursor);
    if (start < 0) throw new Error(`Unable to locate component ${component.sourceSectionId}`);
    cursor = start + needle.length;
    return cursor;
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function convertComponent(component) {
  const converted = editableContract.convertMarkupToEditableSection({
    sectionId: component.sourceSectionId,
    sectionType: component.sourceSectionType,
    markup: component.sourceMarkup,
  });
  return {
    sourceSectionId: component.sourceSectionId,
    sourceSectionType: component.sourceSectionType,
    settingCount: Object.keys(converted.instance.settings || {}).length,
    blockCount: (converted.instance.block_order || []).length,
    imageCount: (component.sourceMarkup.match(/<img\b/gi) || []).length,
    anchorCount: (component.sourceMarkup.match(/<a\b/gi) || []).length,
    buttonCount: (component.sourceMarkup.match(/<button\b/gi) || []).length,
    textCharacters: component.sourceMarkup
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim().length,
  };
}

function captureOptions(label) {
  return {
    chromiumPath: chromePath,
    viewport: { width: 1440, height: 900, mobile: false },
    artifactProfile: 'replay',
    timeoutMs: 60000,
    allowNetwork: false,
    profileRoot: path.join(outputRoot, `${label}-profile`),
    observedReadiness: { quietWindowMs: 500, maxWaitMs: 10000, pollIntervalMs: 100 },
  };
}

async function runBaseline() {
  const startedAt = performance.now();
  const captureStartedAt = performance.now();
  const captureResult = await capture.captureHtml(html, captureOptions('baseline'));
  const captureMs = Math.round(performance.now() - captureStartedAt);
  const conversionStartedAt = performance.now();
  const outputs = components.map(convertComponent);
  const conversionMs = Math.round(performance.now() - conversionStartedAt);
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    captureMs,
    captureCoreMs: captureResult.metadata.captureTimings.collectTotalMs,
    conversionMs,
    readinessMs: captureResult.metadata.observedReadiness?.waitedMs ?? null,
    outputs,
  };
}

async function runStreaming() {
  const ends = locateComponentEnds(htmlBuffer, components);
  const gates = components.map(() => deferred());
  const startedAt = performance.now();
  const captureStartedAt = performance.now();
  const capturePromise = capture.captureHtml(html, captureOptions('streaming')).then((result) => ({
    result,
    elapsedMs: Math.round(performance.now() - captureStartedAt),
  }));
  const streamPromise = runComponentStream({
    components,
    waitUntilReady: (_component, index) => gates[index].promise,
    processComponent: convertComponent,
    concurrency: 1,
  });

  const sourceStream = fs.createReadStream(sourcePath, { highWaterMark: 64 * 1024 });
  let bytesSeen = 0;
  let nextComponent = 0;
  try {
    for await (const chunk of sourceStream) {
      bytesSeen += chunk.length;
      while (nextComponent < ends.length && ends[nextComponent] <= bytesSeen) {
        gates[nextComponent].resolve({ bytesSeen, readyAtMs: Math.round(performance.now() - startedAt) });
        nextComponent += 1;
      }
    }
    while (nextComponent < gates.length) {
      gates[nextComponent].resolve({ bytesSeen, readyAtMs: Math.round(performance.now() - startedAt) });
      nextComponent += 1;
    }
  } catch (error) {
    for (const gate of gates.slice(nextComponent)) gate.reject(error);
    throw error;
  }

  const [captured, streamResult] = await Promise.all([capturePromise, streamPromise]);
  const captureResult = captured.result;
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    captureMs: captured.elapsedMs,
    captureCoreMs: captureResult.metadata.captureTimings.collectTotalMs,
    conversionMs: streamResult.elapsedMs,
    readinessMs: captureResult.metadata.observedReadiness?.waitedMs ?? null,
    firstProcessingStartedMs: streamResult.events.find((event) => event.type === 'processing-started')?.elapsedMs ?? null,
    lastComponentReadyMs: Math.max(0, ...streamResult.events.filter((event) => event.type === 'ready').map((event) => event.elapsedMs)),
    failures: streamResult.failures,
    outputs: streamResult.outputs,
  };
}

function total(items, field) {
  return items.reduce((sum, item) => sum + Number(item[field] || 0), 0);
}

function summarize(items) {
  return {
    components: items.length,
    settings: total(items, 'settingCount'),
    blocks: total(items, 'blockCount'),
    images: total(items, 'imageCount'),
    anchors: total(items, 'anchorCount'),
    buttons: total(items, 'buttonCount'),
    textCharacters: total(items, 'textCharacters'),
  };
}

let baseline;
let streaming;
if (streamingFirst) {
  streaming = await runStreaming();
  baseline = await runBaseline();
} else {
  baseline = await runBaseline();
  streaming = await runStreaming();
}
baseline.summary = summarize(baseline.outputs);
streaming.summary = summarize(streaming.outputs);
baseline.corePipelineMs = baseline.captureCoreMs + baseline.conversionMs;
streaming.corePipelineMs = Math.max(streaming.captureCoreMs, streaming.conversionMs);
delete baseline.outputs;
delete streaming.outputs;

const parity = Object.fromEntries(Object.keys(baseline.summary).map((key) => [key, baseline.summary[key] === streaming.summary[key]]));
const report = {
  generatedAt: new Date().toISOString(),
  sourcePath,
  sourceBytes: htmlBuffer.length,
  method: 'saved-coco-homepage-component-streaming-spike',
  executionOrder: streamingFirst ? ['streaming', 'baseline'] : ['baseline', 'streaming'],
  baseline,
  streaming,
  savedMs: baseline.elapsedMs - streaming.elapsedMs,
  savedPercent: Number((((baseline.elapsedMs - streaming.elapsedMs) / baseline.elapsedMs) * 100).toFixed(2)),
  coreSavedMs: baseline.corePipelineMs - streaming.corePipelineMs,
  coreSavedPercent: Number((((baseline.corePipelineMs - streaming.corePipelineMs) / baseline.corePipelineMs) * 100).toFixed(2)),
  parity,
  pass: streaming.failures.length === 0 && Object.values(parity).every(Boolean),
  limitations: [
    'Uses the saved COCO homepage standard answer because live origin access is unavailable in the current sandbox.',
    'Measures overlap between component conversion and browser readiness; it does not yet change the production importer.',
  ],
};

await fsp.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputRoot, ...report }, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
