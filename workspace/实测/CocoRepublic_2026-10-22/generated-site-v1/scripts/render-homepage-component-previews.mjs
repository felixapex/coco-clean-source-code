import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { captureHtml } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const root = process.cwd();
const chrome = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (/msedge\.exe$/i.test(chrome)) throw new Error('Microsoft Edge automation is forbidden in this workspace');

const libraryRoot = path.join(root, 'artifacts', 'homepage-component-library');
const packageRoot = path.join(libraryRoot, 'packages');
const assetRoot = path.join(libraryRoot, 'assets');
const outputRoot = path.join(libraryRoot, 'component-previews');
const registry = JSON.parse(await fs.readFile(path.join(libraryRoot, 'component-package-registry.json'), 'utf8'));
const assetBase = pathToFileURL(`${assetRoot}${path.sep}`).href;

await fs.mkdir(outputRoot, { recursive: true });

const results = [];
for (let index = 0; index < registry.length; index += 1) {
  const component = registry[index];
  const directory = path.join(packageRoot, encodeURIComponent(component.componentId));
  const implementation = (await fs.readFile(path.join(directory, 'implementation.html'), 'utf8'))
    .replaceAll('/component-library/assets/', assetBase);
  const styles = await fs.readFile(path.join(directory, 'styles.css'), 'utf8');
  const forceOverlay = ['modal', 'alert-modal'].includes(component.componentType) ? `
    [data-section-id], [role="dialog"], .modal, .modal-content, .modal-body, .reveal, .popup, .alert-modal {
      display:block!important; visibility:visible!important; opacity:1!important;
      position:relative!important; inset:auto!important; transform:none!important;
      pointer-events:auto!important;
    }
    [aria-hidden="true"] { display:block!important; visibility:visible!important; opacity:1!important; }
  ` : '';
  const spacer = component.componentType === 'spacer' ? `
    [data-section-id] { min-height:220px!important; border:3px dashed #9a836d!important; background:repeating-linear-gradient(135deg,#faf8f4,#faf8f4 12px,#f1ece4 12px,#f1ece4 24px)!important; }
  ` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html,body{margin:0;background:#f6f3ee;color:#171717;font-family:Arial,sans-serif}
    body{min-height:760px;overflow:auto}
    .matbox-preview-title{box-sizing:border-box;padding:16px 24px;background:#171717;color:#fff;font-size:20px;line-height:28px;position:relative;z-index:2147483647}
    .matbox-preview-stage{box-sizing:border-box;padding:24px;background:#fff;min-height:700px;overflow:hidden}
    .matbox-preview-stage>[data-section-id]{max-width:100%!important}
    ${styles}
    ${forceOverlay}
    ${spacer}
  </style></head><body><div class="matbox-preview-title">组件 ${index + 1}：${component.name}（${component.componentType}）</div><main class="matbox-preview-stage">${implementation}</main></body></html>`;
  const capture = await captureHtml(html, {
    chromiumPath: chrome,
    timeoutMs: 60000,
    viewport: { width: 1400, height: 900, mobile: false },
  });
  const name = `component-${String(index + 1).padStart(2, '0')}-${component.componentType}.png`;
  const output = path.join(outputRoot, name);
  await fs.writeFile(output, capture.screenshot);
  results.push({ index: index + 1, name: component.name, type: component.componentType, output });
}

await fs.writeFile(path.join(outputRoot, 'index.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(results, null, 2));
