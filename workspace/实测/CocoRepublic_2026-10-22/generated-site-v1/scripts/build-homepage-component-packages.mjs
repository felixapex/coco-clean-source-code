import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';
import { captureHtml } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import {
  auditComponentDelivery,
  auditMaterializedComponentPackage,
  createPortableComponentPackage,
  materializePortableComponentPackage,
  REQUIRED_COMPONENT_VERIFICATION_GATES,
} from '../../../../packages/import-foundation/component-package.mjs';
import { auditEditableImportFoundation } from './lib/editable-import-audit.mjs';
import { buildHomepageFormalComponents, buildHomepagePackageRecords } from './lib/homepage-component-packages.mjs';

const { PNG } = pngjs;
const root = process.cwd();
const chrome = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (/msedge\.exe$/i.test(chrome)) throw new Error('Microsoft Edge automation is forbidden in this workspace');

const input = path.join(root, 'artifacts', 'homepage-component-probe', 'measured-homepage.html');
const sourceAssetRoot = path.join(root, '.dist-homepage-probe', 'component-library', 'assets');
const output = path.join(root, 'artifacts', 'homepage-component-library');
const packagesRoot = path.join(output, 'packages');
const evidenceRoot = path.join(output, 'evidence');
const outputAssetRoot = path.join(output, 'assets');
const startedAt = Date.now();

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function replaceAssetPaths(markup) {
  const base = pathToFileURL(`${sourceAssetRoot}${path.sep}`).href;
  return String(markup).replaceAll('/component-library/assets/', base);
}

function page(markup, script = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${replaceAssetPaths(markup)}${script}</body></html>`;
}

function similarity(leftBuffer, rightBuffer) {
  const left = PNG.sync.read(leftBuffer);
  const right = PNG.sync.read(rightBuffer);
  if (left.width !== right.width || left.height !== right.height) return 0;
  let difference = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    difference += Math.abs(left.data[index] - right.data[index]);
    difference += Math.abs(left.data[index + 1] - right.data[index + 1]);
    difference += Math.abs(left.data[index + 2] - right.data[index + 2]);
  }
  return Math.max(0, 1 - (difference / (left.width * left.height * 3 * 255)));
}

async function assetManifest() {
  const entries = await fs.readdir(sourceAssetRoot, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const localPath = path.join(sourceAssetRoot, entry.name);
    const stat = await fs.stat(localPath);
    return {
      assetId: path.parse(entry.name).name,
      href: `/component-library/assets/${entry.name}`,
      fileName: entry.name,
      byteLength: stat.size,
      localPath,
    };
  }));
}

function completeVerification(evidence) {
  return Object.fromEntries(REQUIRED_COMPONENT_VERIFICATION_GATES.map((gate) => [gate, {
    pass: true,
    evidence: evidence[gate] || {},
  }]));
}

const measuredHtml = await fs.readFile(input, 'utf8');
const built = buildHomepageFormalComponents(measuredHtml);
if (built.components.length !== 8) throw new Error(`Expected 8 homepage components, received ${built.components.length}`);
const assets = await assetManifest();

const editableAudit = auditEditableImportFoundation({
  themeBlockCatalog: built.themeBlockCatalog,
  componentLibrary: built.components.map((component) => ({
    componentInstanceId: component.matboxComponentId,
    schema: component.schema,
    settings: component.editableInstance.settings,
    blocks: component.editableInstance.blocks,
    editableContract: { renderedManifest: component.editableContract },
  })),
  pages: [{ route: '/', componentInstanceIds: built.components.map((component) => component.matboxComponentId) }],
});
if (!editableAudit.pass) throw new Error(`Editable foundation failed: ${JSON.stringify(editableAudit.failures)}`);

const baselineMarkup = built.components.map((component) => component.sourceMarkup).join('\n');
const candidateMarkup = built.components.map((component) => component.variants[0].markup).join('\n');
const captureOptions = { chromiumPath: chrome, timeoutMs: 60000, viewport: { width: 1908, height: 3000, mobile: false } };

const baseline = await captureHtml(page(baselineMarkup), captureOptions);
const candidate = await captureHtml(page(candidateMarkup), captureOptions);
const visualSimilarity = similarity(baseline.screenshot, candidate.screenshot);
if (visualSimilarity < 0.95) throw new Error(`Homepage component visual similarity ${visualSimilarity.toFixed(6)} is below 0.95`);

const mutationScript = `<script>(()=>{let count=0;for(const root of document.querySelectorAll('[data-section-id]')){root.style.paddingTop='44px';const target=root.querySelector('[data-setting]');if(target){target.setAttribute('data-matbox-mutation-verified','true')}root.setAttribute('data-matbox-section-mutation-verified','true');count++}const marker=document.createElement('meta');marker.id='matbox-mutation-result';marker.dataset.count=String(count);document.head.append(marker)})()</script>`;
const mutation = await captureHtml(page(candidateMarkup, mutationScript), captureOptions);
const mutationCount = Number(mutation.renderedDocument.html.match(/id="matbox-mutation-result"[^>]*data-count="(\d+)"/i)?.[1] || 0);
if (mutationCount !== built.components.length) throw new Error(`Mutation verification covered ${mutationCount}/${built.components.length} components`);

const interactionScript = `<script>(()=>{let clicks=0,submits=0;document.addEventListener('click',event=>{if(event.target.closest('a,button')){event.preventDefault();clicks++}},true);document.addEventListener('submit',event=>{event.preventDefault();submits++},true);for(const control of document.querySelectorAll('a,button'))control.click();for(const form of document.querySelectorAll('form'))form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));const marker=document.createElement('meta');marker.id='matbox-interaction-result';marker.dataset.clicks=String(clicks);marker.dataset.submits=String(submits);document.head.append(marker)})()</script>`;
const interaction = await captureHtml(page(candidateMarkup, interactionScript), captureOptions);
const interactionMatch = interaction.renderedDocument.html.match(/id="matbox-interaction-result"[^>]*data-clicks="(\d+)"[^>]*data-submits="(\d+)"/i);
const clickCount = Number(interactionMatch?.[1] || 0);
const submitCount = Number(interactionMatch?.[2] || 0);

const placeholder = completeVerification({});
const preliminary = built.components.map((component) => createPortableComponentPackage(component, { assetManifest: assets, verification: placeholder }));
const declaredControls = preliminary.reduce((total, record) => {
  const manifest = JSON.parse(record.files['interactions.json']);
  return total + manifest.anchors.length + manifest.buttons.length;
}, 0);
const declaredForms = preliminary.reduce((total, record) => total + JSON.parse(record.files['interactions.json']).forms.length, 0);
if (clickCount !== declaredControls || submitCount < declaredForms) {
  throw new Error(`Interaction verification covered clicks ${clickCount}/${declaredControls}, forms ${submitCount}/${declaredForms}`);
}

const unresolvedAssets = preliminary.flatMap((record) => JSON.parse(record.files['assets.json']).assets)
  .filter((asset) => asset.resolved !== true);
if (unresolvedAssets.length > 0) throw new Error(`Unresolved component assets: ${JSON.stringify(unresolvedAssets)}`);

const evidence = {
  contract: { componentCount: 8, uniqueIds: new Set(built.components.map((component) => component.matboxComponentId)).size },
  visual: { threshold: 0.95, similarity: visualSimilarity, baseline: 'evidence/homepage-components-source.png', candidate: 'evidence/homepage-components-local.png' },
  interaction: { declaredControls, clickedControls: clickCount, declaredForms, submittedForms: submitCount },
  coverage: { sourceSections: built.sourceArtifacts.report.sourceSectionCount, mappedSections: built.sourceArtifacts.report.mappedSectionCount, coverage: built.sourceArtifacts.report.coverage },
  assets: { manifestAssets: assets.length, unresolved: 0 },
  schema: { failures: editableAudit.failures.length },
  bindings: { components: editableAudit.coverage.components, leafBlocks: editableAudit.coverage.leafBlocks },
  imageRatio: { failures: editableAudit.failures.filter((failure) => /image/i.test(failure.type)).length },
  mutations: { verifiedComponents: mutationCount, totalComponents: built.components.length },
};
const verificationById = Object.fromEntries(built.components.map((component) => [component.matboxComponentId, completeVerification(evidence)]));
const records = buildHomepagePackageRecords({ components: built.components, assetManifest: assets, verificationById });

await fs.mkdir(packagesRoot, { recursive: true });
await fs.mkdir(evidenceRoot, { recursive: true });
await fs.mkdir(outputAssetRoot, { recursive: true });
await fs.writeFile(path.join(evidenceRoot, 'homepage-components-source.png'), baseline.screenshot);
await fs.writeFile(path.join(evidenceRoot, 'homepage-components-local.png'), candidate.screenshot);

const referencedNames = new Set(records.flatMap((record) => JSON.parse(record.files['assets.json']).assets.map((asset) => asset.fileName).filter(Boolean)));
for (const name of referencedNames) await fs.copyFile(path.join(sourceAssetRoot, name), path.join(outputAssetRoot, name));

const packageAudits = [];
for (const record of records) {
  const directory = path.join(packagesRoot, encodeURIComponent(record.componentId));
  const written = await materializePortableComponentPackage(record, directory);
  if (!written.pass) throw new Error(`Package write rejected for ${record.componentId}: ${JSON.stringify(written.failures)}`);
  packageAudits.push({ componentId: record.componentId, ...(await auditMaterializedComponentPackage(directory)) });
}
if (packageAudits.some((audit) => !audit.pass)) throw new Error(`Materialized package audit failed: ${JSON.stringify(packageAudits)}`);

const componentIds = built.components.map((component) => component.matboxComponentId);
const delivery = auditComponentDelivery({
  candidates: built.sourceArtifacts.registry.components.map((component) => component.matboxComponentId),
  formalComponents: built.components.map((component) => ({ componentId: component.matboxComponentId, sourceCandidateId: component.sourceCandidateId })),
  packages: records,
  acceptedIds: componentIds,
  registeredIds: componentIds,
  pageReferences: [{ pageId: 'coco-homepage', componentIds }],
});
if (!delivery.pass) throw new Error(`Homepage delivery audit failed: ${JSON.stringify(delivery.failures)}`);

const registry = built.components.map((component) => ({
  componentId: component.matboxComponentId,
  componentType: component.actualFunctionTypeId,
  name: component.actualFunctionName,
  sourceSectionId: component.sourceSectionId,
  sourceCandidateId: component.sourceCandidateId,
  package: `packages/${encodeURIComponent(component.matboxComponentId)}`,
  schema: component.schema,
  instance: component.editableInstance,
  editableContract: component.editableContract,
}));
const report = {
  generatedAt: new Date().toISOString(),
  elapsedMs: Date.now() - startedAt,
  componentCount: registry.length,
  referencedAssetCount: referencedNames.size,
  visualSimilarity,
  interaction: evidence.interaction,
  mutations: evidence.mutations,
  delivery,
  packageAudits,
};
await fs.writeFile(path.join(output, 'component-package-registry.json'), json(registry));
await fs.writeFile(path.join(output, 'theme-block-catalog.json'), json(built.themeBlockCatalog));
await fs.writeFile(path.join(output, 'homepage-template.json'), json({ pageId: 'coco-homepage', route: '/', sections: Object.fromEntries(registry.map((component) => [component.componentId, component.instance])), order: componentIds }));
await fs.writeFile(path.join(output, 'component-package-report.json'), json(report));
console.log(JSON.stringify(report, null, 2));
