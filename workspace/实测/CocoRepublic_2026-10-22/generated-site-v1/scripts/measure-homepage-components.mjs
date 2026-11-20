import fs from 'node:fs/promises';
import path from 'node:path';

import { captureHtml } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { buildComponentRegistry } from './lib/component-registry.mjs';

const root = process.cwd();
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (/msedge\.exe$/i.test(chromiumPath)) throw new Error('Microsoft Edge automation is forbidden in this workspace');

const outputRoot = path.join(root, 'artifacts', 'homepage-component-probe');
const sourcePath = path.join(root, 'src', 'replay', 'route-home.html');
const startedAt = Date.now();
const source = await fs.readFile(sourcePath, 'utf8');
const captureStartedAt = Date.now();
const capture = await captureHtml(source, {
  chromiumPath,
  timeoutMs: 60000,
  viewport: { width: 1908, height: 1000, mobile: false },
});
const captureElapsedMs = Date.now() - captureStartedAt;
const measuredHtml = capture.renderedDocument.html;
await fs.mkdir(outputRoot, { recursive: true });
await fs.writeFile(path.join(outputRoot, 'measured-homepage.html'), measuredHtml, 'utf8');

const extractionStartedAt = Date.now();
const artifacts = buildComponentRegistry([{ route: '/', html: measuredHtml }], { requireGeometryEvidence: true });
const extractionElapsedMs = Date.now() - extractionStartedAt;
const components = artifacts.registry.components.map((component) => ({
  componentId: component.matboxComponentId,
  sourceSectionId: component.sourceSectionId,
  type: component.sourceSectionType,
  geometry: component.sourceGeometry,
  variants: component.variants.length,
}));
const report = {
  generatedAt: new Date().toISOString(),
  route: '/',
  viewport: { width: 1908, height: 1000, mobile: false },
  timings: {
    captureElapsedMs,
    extractionElapsedMs,
    totalElapsedMs: Date.now() - startedAt,
  },
  componentCount: components.length,
  report: artifacts.report,
  components,
};
await fs.writeFile(path.join(outputRoot, 'component-probe-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
