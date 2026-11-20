import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
const outputRoot = path.join(import.meta.dirname, 'results', `saved-readiness-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await fs.mkdir(outputRoot, { recursive: true });

const capture = await import(pathToFileURL(sharedCapturePath));
const { afterSettleStateExpression, closeDelayedPopupExpression } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'capture-state.mjs')));
const html = await fs.readFile(sourcePath, 'utf8');

function summarize(renderedHtml) {
  return {
    bytes: Buffer.byteLength(renderedHtml),
    textCharacters: renderedHtml.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length,
    images: (renderedHtml.match(/<img\b/gi) || []).length,
    anchors: (renderedHtml.match(/<a\b/gi) || []).length,
    buttons: (renderedHtml.match(/<button\b/gi) || []).length,
  };
}

async function run(label, extraOptions) {
  const startedAt = performance.now();
  const result = await capture.captureHtml(html, {
    chromiumPath: chromePath,
    viewport: { width: 1440, height: 900, mobile: false },
    artifactProfile: 'replay',
    timeoutMs: 60000,
    allowNetwork: false,
    profileRoot: path.join(outputRoot, `${label}-profile`),
    beforeSnapshotExpression: closeDelayedPopupExpression,
    ...extraOptions,
  });
  await fs.writeFile(path.join(outputRoot, `${label}.html`), result.renderedDocument.html, 'utf8');
  await fs.writeFile(path.join(outputRoot, `${label}.png`), result.screenshot);
  return {
    elapsedMs: Math.round(performance.now() - startedAt),
    summary: summarize(result.renderedDocument.html),
    captureTimings: result.metadata.captureTimings,
    observedReadiness: result.metadata.observedReadiness || null,
  };
}

const fixed = await run('fixed-six-second', { afterSettleExpression: afterSettleStateExpression });
const observed = await run('observed-readiness', {
  observedReadiness: { quietWindowMs: 500, maxWaitMs: 10000, pollIntervalMs: 100 },
});
const parity = {
  textCharacters: fixed.summary.textCharacters === observed.summary.textCharacters,
  images: fixed.summary.images === observed.summary.images,
  anchors: fixed.summary.anchors === observed.summary.anchors,
  buttons: fixed.summary.buttons === observed.summary.buttons,
};
const report = {
  sourcePath,
  generatedAt: new Date().toISOString(),
  fixed,
  observed,
  savedMs: fixed.elapsedMs - observed.elapsedMs,
  savedPercent: Number((((fixed.elapsedMs - observed.elapsedMs) / fixed.elapsedMs) * 100).toFixed(2)),
  parity,
  pass: Object.values(parity).every(Boolean) && observed.observedReadiness?.reason === 'observed-stable',
};
await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputRoot, ...report }, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
