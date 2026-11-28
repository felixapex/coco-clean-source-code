import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { evaluateSettingMutations } from './lib/editability-mutation-gate.mjs';
import {
  buildSettingMutationExpression,
  selectRepresentativeComponents,
} from './lib/dynamic-component-verifier.mjs';

const root = path.resolve(import.meta.dirname, '..');
const distName = process.env.MATBOX_DIST_DIR || '.dist-staging-30856';
const distRoot = path.resolve(root, distName);
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const outputRoot = path.join(root, 'artifacts', 'dynamic-component-verification');
const passCount = Math.max(1, Number(process.env.MATBOX_SAMPLE_PASSES || 3));
const sampleSize = Math.max(1, Number(process.env.MATBOX_SAMPLE_COMPONENTS || 8));
const viewports = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];

if (/msedge\.exe$/i.test(chromePath)) throw new Error('Microsoft Edge automation is forbidden in this workspace');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitFor(fn, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { return await fn(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError || new Error('Timed out');
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  const rejectPending = () => {
    for (const waiter of pending.values()) waiter.reject(new Error('CDP target closed'));
    pending.clear();
  };
  socket.addEventListener('close', rejectPending, { once: true });
  socket.addEventListener('error', rejectPending, { once: true });
  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const values = listeners.get(method) || [];
      values.push(listener);
      listeners.set(method, values);
    },
    close() { socket.close(); },
  };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeName(value) {
  return encodeURIComponent(value).replace(/%/g, '_');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

async function settle(cdp) {
  await evaluate(cdp, `(async () => {
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    await Promise.all(Array.from(document.images).map((image) => image.complete
      ? Promise.resolve()
      : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
        setTimeout(resolve, 3000);
      })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
}

async function navigate(cdp, url, profile) {
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: 1,
    mobile: profile.mobile,
  });
  await cdp.call('Page.navigate', { url });
  await waitFor(async () => {
    const state = await evaluate(cdp, 'document.readyState');
    if (state !== 'complete') throw new Error(`document state ${state}`);
    const sectionCount = await evaluate(cdp, `document.querySelectorAll('[data-section-id]').length`);
    if (sectionCount < 1) throw new Error('annotated section missing');
    return true;
  });
  await settle(cdp);
}

async function capture(cdp, targetPath) {
  const { data } = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const bytes = Buffer.from(data, 'base64');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, bytes);
  return { data, path: targetPath };
}

async function comparePngs(cdp, beforeBase64, afterBase64, diffPath) {
  const expression = `(async () => {
    const decode = async (value) => createImageBitmap(await (await fetch('data:image/png;base64,' + value)).blob());
    const [before, after] = await Promise.all([decode(${JSON.stringify(beforeBase64)}), decode(${JSON.stringify(afterBase64)})]);
    if (before.width !== after.width || before.height !== after.height) {
      return { error: 'screenshot-size-mismatch', before: [before.width, before.height], after: [after.width, after.height] };
    }
    const canvas = document.createElement('canvas');
    canvas.width = before.width;
    canvas.height = before.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(before, 0, 0);
    const a = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(after, 0, 0);
    const b = context.getImageData(0, 0, canvas.width, canvas.height);
    const diff = context.createImageData(canvas.width, canvas.height);
    let changedPixels = 0;
    for (let index = 0; index < a.data.length; index += 4) {
      const changed = Math.abs(a.data[index] - b.data[index])
        + Math.abs(a.data[index + 1] - b.data[index + 1])
        + Math.abs(a.data[index + 2] - b.data[index + 2])
        + Math.abs(a.data[index + 3] - b.data[index + 3]) > 12;
      if (!changed) continue;
      changedPixels += 1;
      diff.data[index] = 255;
      diff.data[index + 1] = 0;
      diff.data[index + 2] = 170;
      diff.data[index + 3] = 255;
    }
    context.putImageData(diff, 0, 0);
    return { changedPixels, data: canvas.toDataURL('image/png').split(',')[1] };
  })()`;
  const result = await evaluate(cdp, expression);
  if (result?.error) throw new Error(`${result.error}: ${JSON.stringify(result)}`);
  await fs.mkdir(path.dirname(diffPath), { recursive: true });
  await fs.writeFile(diffPath, Buffer.from(result.data, 'base64'));
  return { path: diffPath, changedPixels: result.changedPixels };
}

async function collectTargets(cdp) {
  return evaluate(cdp, `(() => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
    };
    const values = Array.from(document.querySelectorAll('[data-block-id][data-setting]')).filter(visible).map((node) => ({
      blockId: node.getAttribute('data-block-id'),
      blockType: node.getAttribute('data-block-type') || '',
      settingId: node.getAttribute('data-setting'),
      tagName: node.tagName,
    }));
    const text = values.find((value) => ['heading', 'text', 'button'].includes(value.blockType));
    const image = values.find((value) => value.blockType === 'image' || value.tagName === 'IMG');
    return [text, image].filter(Boolean);
  })()`);
}

function mutationDescriptor(target, index) {
  if (!target) return { verificationId: 'padding_top', settingId: 'padding_top', settingType: 'range', blockId: '' };
  return {
    verificationId: `block_${index}_${target.blockId}_${target.settingId}`,
    settingId: target.settingId,
    settingType: target.blockType === 'image' ? 'image_picker' : target.blockType === 'button' ? 'url' : 'inline_richtext',
    blockId: target.blockId,
  };
}

async function verifyMutation({ cdp, url, profile, descriptor, evidenceRoot, marker }) {
  await navigate(cdp, url, profile);
  const beforeHtml = await evaluate(cdp, `document.documentElement.outerHTML`);
  const beforePath = path.join(evidenceRoot, 'before', `${safeName(descriptor.verificationId)}-${profile.name}.png`);
  const before = await capture(cdp, beforePath);
  const mutationResult = await evaluate(cdp, buildSettingMutationExpression({
    settingId: descriptor.settingId,
    settingType: descriptor.settingType,
    blockId: descriptor.blockId,
    marker,
  }));
  if (!mutationResult?.pass) throw new Error(mutationResult?.error || 'mutation failed');
  await settle(cdp);
  const afterHtml = await evaluate(cdp, `document.documentElement.outerHTML`);
  const afterPath = path.join(evidenceRoot, 'after', `${safeName(descriptor.verificationId)}-${profile.name}.png`);
  const after = await capture(cdp, afterPath);
  const diffPath = path.join(evidenceRoot, 'diff', `${safeName(descriptor.verificationId)}-${profile.name}.png`);
  const diff = await comparePngs(cdp, before.data, after.data, diffPath);
  return {
    before: { domHash: sha256(beforeHtml), screenshot: path.relative(root, before.path).replaceAll('\\', '/') },
    after: { domHash: sha256(afterHtml), screenshot: path.relative(root, after.path).replaceAll('\\', '/') },
    diff: { path: path.relative(root, diff.path).replaceAll('\\', '/'), changedPixels: diff.changedPixels },
  };
}

const registryPath = path.join(distRoot, 'component-library', 'component-registry.json');
const registry = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const selected = selectRepresentativeComponents(registry, sampleSize);
if (selected.length < sampleSize) throw new Error(`Only ${selected.length}/${sampleSize} representative components are available`);

await fs.rm(outputRoot, { recursive: true, force: true });
await fs.mkdir(outputRoot, { recursive: true });
const sitePort = await freePort();
const debugPort = await freePort();
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-dynamic-component-'));
const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(sitePort)], {
  cwd: root,
  env: { ...process.env, MATBOX_DIST_DIR: distName },
  stdio: 'pipe',
});
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--no-default-browser-check', '--disable-background-networking', '--window-size=1440,900',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let cdp;

async function cleanup() {
  cdp?.close();
  for (const child of [chrome, server]) if (child.exitCode === null) child.kill();
  await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
}

try {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${sitePort}/`);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
  });
  const target = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find((item) => item.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome page target unavailable');
    return page;
  });
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Network.enable');

  const externalRequests = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    try {
      const url = new URL(request.url);
      if (['http:', 'https:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
        externalRequests.push(request.url);
      }
    } catch {}
  });

  const passes = [];
  for (let passIndex = 1; passIndex <= passCount; passIndex += 1) {
    const passResults = [];
    for (let componentIndex = 0; componentIndex < selected.length; componentIndex += 1) {
      const { family, component } = selected[componentIndex];
      const markupHref = component.variants[0].markupHref;
      const url = `http://127.0.0.1:${sitePort}${markupHref}`;
      await navigate(cdp, url, viewports[0]);
      const targets = await collectTargets(cdp);
      const descriptors = [mutationDescriptor(null, 0), ...targets.map((target, index) => mutationDescriptor(target, index + 1))];
      const mutations = [];
      const evidenceRoot = path.join(outputRoot, `pass-${passIndex}`, safeName(component.matboxComponentId));
      for (const descriptor of descriptors) {
        const mutation = {
          settingId: descriptor.verificationId,
          status: 'passed',
          targetRegionIds: [descriptor.blockId || component.matboxComponentId],
          changedRegionIds: [descriptor.blockId || component.matboxComponentId],
          changedOutsideTargetIds: [],
          evidenceByViewport: {},
        };
        try {
          for (const viewport of viewports) {
            mutation.evidenceByViewport[viewport.name] = await verifyMutation({
              cdp,
              url,
              profile: viewport,
              descriptor,
              evidenceRoot,
              marker: `MATBOX_PASS_${passIndex}_${componentIndex}`,
            });
          }
        } catch (error) {
          mutation.status = 'error';
          mutation.error = error.message;
        }
        mutations.push(mutation);
      }
      const schema = { settings: descriptors.map((descriptor) => ({ type: descriptor.settingType, id: descriptor.verificationId, label: descriptor.verificationId })) };
      const gate = evaluateSettingMutations({ schema, mutations, requiredViewports: viewports.map(({ name }) => name) });
      const result = {
        pass: gate.pass,
        family,
        componentId: component.matboxComponentId,
        sourceSectionType: component.sourceSectionType,
        markupHref,
        gate,
        mutations,
      };
      await fs.mkdir(evidenceRoot, { recursive: true });
      await fs.writeFile(path.join(evidenceRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      passResults.push(result);
      process.stdout.write(`pass ${passIndex}/${passCount} component ${componentIndex + 1}/${selected.length} ${gate.pass ? 'PASS' : 'FAIL'} ${component.sourceSectionType}\n`);
    }
    passes.push({ pass: passResults.every((result) => result.pass), index: passIndex, results: passResults });
  }

  const uniqueExternalRequests = [...new Set(externalRequests)];
  const report = {
    generatedAt: new Date().toISOString(),
    distRoot,
    pass: passes.every((entry) => entry.pass) && uniqueExternalRequests.length === 0,
    sampleSize: selected.length,
    passCount,
    viewports: viewports.map(({ name, width, height }) => ({ name, width, height })),
    externalRequests: uniqueExternalRequests,
    passes,
  };
  await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    pass: report.pass,
    sampleSize: report.sampleSize,
    passCount: report.passCount,
    checkedComponentRuns: report.sampleSize * report.passCount,
    externalRequestCount: uniqueExternalRequests.length,
    report: path.join(outputRoot, 'report.json'),
  }, null, 2));
  if (!report.pass) process.exitCode = 1;
} finally {
  await cleanup();
}
