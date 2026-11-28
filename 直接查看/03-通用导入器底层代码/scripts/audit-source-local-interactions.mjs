import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  classifyControl,
  controlFingerprint,
  compareInteractionInventories,
  executeInteractionPlan,
  inferInteractionEffect,
  interactionLoadPhases,
  interactionControlPreparationScrollY,
  interactionControlPreparationScrollCandidates,
  interactionRunPlan,
  isInteractionContentReady,
  isInteractionPageReady,
  mergeInteractionReports,
  partitionInteractionRoutes,
  resolveInteractionWorkerCount,
  selectInteractionControls,
} from './lib/interaction-parity.mjs';
import {
  createInteractionTiming,
  measureInteractionPhase,
  withInteractionTiming,
} from './lib/interaction-audit-timing.mjs';
import { connectCdp } from './lib/cdp-client.mjs';
import { afterSettleStateExpression, closeDelayedPopupExpression, stableStateExpression } from './lib/capture-state.mjs';
import { candidateBuildStamp } from './lib/candidate-build-stamp.mjs';
import { createAdaptiveInteractionRunner } from './lib/adaptive-interaction-runner.mjs';
import { isInteractionStateRestored } from './lib/interaction-isolation.mjs';
import {
  createSourceBaselineIdentity,
  interactionInventorySignature,
  isReusableSourceBaselineEvidence,
  loadFrozenSourceInteractionBaseline,
  loadSourceInteractionBaseline,
  sourceInteractionBaselinePath,
  writeSourceInteractionBaseline,
} from './lib/source-interaction-baseline.mjs';
import {
  loadSourceLocalParityCheckpoint,
  recordSourceLocalParityRoute,
  writeSourceLocalParityCheckpoint,
} from './lib/source-local-parity-checkpoint.mjs';

const root = process.cwd();
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sourceOrigin = new URL(process.env.MATBOX_SOURCE_URL || 'https://www.cocorepublic.com.au').origin;
const importPlatform = process.env.MATBOX_IMPORT_PLATFORM
  || (new URL(sourceOrigin).hostname.endsWith('.myshopify.com') ? 'shopify' : 'external');
const interactionWorkerCount = resolveInteractionWorkerCount({
  platform: importPlatform,
  configured: process.env.MATBOX_INTERACTION_WORKERS || 8,
});
const distRoot = path.join(root, process.env.MATBOX_DIST_DIR || 'dist');
let interactionRoutes = { redirects: {} };
try {
  interactionRoutes = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'interaction-routes.json'), 'utf8'));
} catch {}
const interactionRedirects = interactionRoutes.redirects || {};
const routeManifest = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'routes.json'), 'utf8'));
const requestedRoutes = process.argv.slice(2).filter((route) => route.startsWith('/'));
const routes = requestedRoutes.length ? requestedRoutes : Object.keys(routeManifest);
const selectedViewport = process.argv.find((argument) => argument.startsWith('--viewport='))?.slice('--viewport='.length) || 'desktop';
const requestedFingerprints = process.argv
  .filter((argument) => argument.startsWith('--fingerprint='))
  .map((argument) => argument.slice('--fingerprint='.length))
  .filter(Boolean);
const quietProgress = process.env.MATBOX_QUIET_PROGRESS === '1';
const auditViewports = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
};
const auditViewport = auditViewports[selectedViewport];
if (!auditViewport) throw new Error(`Unknown interaction viewport: ${selectedViewport}`);
const workerId = process.env.MATBOX_INTERACTION_WORKER_ID;
const outputPath = path.join(root, 'artifacts', 'full-site-audit', requestedRoutes.length
  ? (workerId ? `source-local-interaction-parity-worker-${selectedViewport}-${workerId}.json` : `source-local-interaction-parity-targeted-${selectedViewport}.json`)
  : `source-local-interaction-parity-${selectedViewport}.json`);
const interactionContractVersion = 'trusted-click-isolation-v2-active-surface';
const sourceSelection = requestedFingerprints.length ? [...requestedFingerprints].sort().join(',') : 'all';
const refreshSourceBaseline = process.env.MATBOX_REFRESH_SOURCE_BASELINE === '1';
const sourceBaselineRoot = path.join(root, 'artifacts', 'full-site-audit', 'source-interaction-baselines', selectedViewport);
const checkpointPath = outputPath.replace(/\.json$/i, '.checkpoint.json');
const routeOrder = [...routes];
const localBuildStamp = await candidateBuildStamp(distRoot);
const auditKey = createHash('sha256').update(JSON.stringify({
  contract: interactionContractVersion,
  sourceOrigin,
  viewport: selectedViewport,
  selection: sourceSelection,
  routeOrder,
  interactionRedirects,
  localBuildStamp,
})).digest('hex');

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error('Timed out');
}

function enrichControls(controls) {
  const occurrences = new Map();
  return controls.map((control) => {
    const classification = classifyControl(control);
    const base = controlFingerprint({ ...control, occurrence: 0 });
    const occurrence = occurrences.get(base) || 0;
    occurrences.set(base, occurrence + 1);
    return {
      ...control,
      occurrence,
      classification,
      fingerprint: controlFingerprint({ ...control, occurrence }),
    };
  });
}

const inventoryExpression = `
(() => {
  const normalize = (value = '') => String(value).trim().replace(/\\s+/g, ' ').slice(0, 180);
  const visible = (node) => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || !node.getClientRects().length) return false;
    if (rect.bottom + scrollY <= 0 || rect.right + scrollX <= 0) return false;
    for (let current = node; current instanceof Element; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity || 1) <= 0.01) return false;
    }
    return true;
  };
  const visiblePanelCount = () => [...document.querySelectorAll('[role="dialog"],details,.navPage-subMenu,[class*="drawer"],[class*="modal"],[class*="dropdown"]')]
    .filter((item) => {
      const rect = item.getBoundingClientRect();
      const style = getComputedStyle(item);
      return rect.width > 1 && rect.height > 1 && style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity || 1) > 0.01;
    }).length;
  const activeSurface = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="drawer"],[class*="slide-out"],[class*="modal"],.calendly-overlay,#custom-cart,[data-action="nav-preview-cart"]')]
    .filter(visible)
    .sort((left, right) => {
      const leftZ = Number.parseInt(getComputedStyle(left).zIndex, 10) || 0;
      const rightZ = Number.parseInt(getComputedStyle(right).zIndex, 10) || 0;
      return rightZ - leftZ;
    })[0] || null;
  const controls = [...document.querySelectorAll('a[href],button,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"],input[type="range"],summary,[role="button"],select')]
    .filter((node) => visible(node) && (!activeSurface || activeSurface.contains(node)));
  const results = controls.map((node, index) => {
    return {
      index,
      tag: node.tagName.toLowerCase(),
      role: node.getAttribute('role') || '',
      type: node.type || node.getAttribute('type') || '',
      text: normalize(node.innerText || node.value || ''),
      ariaLabel: normalize(node.getAttribute('aria-label') || ''),
      name: node.getAttribute('name') || '',
      href: node.tagName === 'A' ? node.href : '',
      formAction: node.formAction || node.closest('form')?.action || '',
      slideout: node.getAttribute('data-slideout') || node.closest('[data-slideout]')?.getAttribute('data-slideout') || '',
      calendlyBound: node.getAttribute('data-calendly-bound') === '1' || Boolean(node.closest('[data-calendly-bound="1"]')),
      disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
      documentY: Math.round(node.getBoundingClientRect().top + scrollY),
      documentHeight: Math.round(document.documentElement.scrollHeight),
    };
  });
  const commerce = document.querySelector('#searchspring-category');
  return {
    controls: results,
    diagnostics: {
      readyState: document.readyState,
      bodyTextLength: document.body?.innerText?.trim().length || 0,
      commercePresent: Boolean(commerce),
      productCount: commerce?.querySelectorAll('.product-card,.ss-product').length || 0,
      commerceTextLength: commerce?.innerText?.trim().length || 0,
      loadMorePresent: Boolean(commerce?.querySelector('.ss-load-more')),
      activeSurface: activeSurface ? {
        role: activeSurface.getAttribute('role') || '',
        ariaModal: activeSurface.getAttribute('aria-modal') || '',
        id: activeSurface.id || '',
        className: typeof activeSurface.className === 'string' ? activeSurface.className : '',
      } : null,
    },
  };
})()
`;

function trustedClickPreparationExpression(index, preventSubmission = false) {
  return `
  (async () => {
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1 || !node.getClientRects().length) return false;
      if (rect.bottom + scrollY <= 0 || rect.right + scrollX <= 0) return false;
      for (let current = node; current instanceof Element; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
        if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity || 1) <= 0.01) return false;
      }
      return true;
    };
    const surface = () => {
      const candidates = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[class*="drawer"],[class*="slide-out"],[class*="modal"],.navPage-subMenu,[class*="mega"],.calendly-overlay,#custom-cart,[data-action="nav-preview-cart"]')]
        .filter(visible)
        .map((node) => {
          const text = String(node.className || '') + ' ' + String(node.getAttribute('role') || '');
          const kind = /mega|navPage-subMenu/i.test(text) ? 'mega-menu'
            : /drawer|slide-out|custom-cart|preview-cart/i.test(text + ' ' + (node.id || '') + ' ' + (node.getAttribute('data-action') || '')) ? 'drawer'
            : /modal|dialog|calendly/i.test(text) ? 'modal'
            : 'panel';
          const rect = node.getBoundingClientRect();
          return { kind, text: (node.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 500), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
        });
      return candidates[0] || null;
    };
    const state = (node) => {
      const activeSurface = surface();
      return {
        url: location.href,
        expanded: node?.getAttribute('aria-expanded'),
        pressed: node?.getAttribute('aria-pressed'),
        checked: node && 'checked' in node ? Boolean(node.checked) : null,
        value: node && 'value' in node ? node.value : null,
        ownClass: typeof node?.className === 'string' ? node.className : '',
        selectedCount: node?.closest('.product-card,.ss-dropdown,form')?.querySelectorAll('.selected,[aria-selected="true"],[aria-pressed="true"],:checked').length || 0,
        imageSource: node?.closest('.product-card')?.querySelector('img')?.currentSrc || node?.closest('.product-card')?.querySelector('img')?.src || '',
        openDetails: document.querySelectorAll('details[open]').length,
        visiblePanels: activeSurface ? 1 : 0,
        surfaceKind: activeSurface?.kind || '',
        surface: activeSurface,
        bodyOverflow: getComputedStyle(document.body).overflow,
        historyLength: history.length,
        localStorageDigest: JSON.stringify(Object.keys(localStorage).sort().map((key) => [key, localStorage.getItem(key)])),
        sessionStorageDigest: JSON.stringify(Object.keys(sessionStorage).sort().map((key) => [key, sessionStorage.getItem(key)])),
        cookieDigest: document.cookie,
        popupCount: activeSurface ? 1 : 0,
        mutationRequestCount: Number(window.__matboxMutationRequestCount || 0),
      };
    };
    const controls = [...document.querySelectorAll('a[href],button,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"],input[type="range"],summary,[role="button"],select')].filter(visible);
    const node = controls[${Number(index)}];
    if (!node) return { error: 'control-not-found' };
    if (${preventSubmission ? 'true' : 'false'}) {
      document.addEventListener('submit', (event) => event.preventDefault(), { capture: true, once: true });
    }
    const before = state(node);
    const initialRect = node.getBoundingClientRect();
    const alreadyInViewport = initialRect.bottom > 0
      && initialRect.top < innerHeight
      && initialRect.right > 0
      && initialRect.left < innerWidth;
    if (!alreadyInViewport) node.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = node.getBoundingClientRect();
    const candidatePoints = [
      [0.5, 0.5], [0.25, 0.5], [0.75, 0.5],
      [0.5, 0.25], [0.5, 0.75], [0.25, 0.25],
      [0.75, 0.25], [0.25, 0.75], [0.75, 0.75],
    ].map(([x, y]) => ({ x: rect.left + rect.width * x, y: rect.top + rect.height * y }));
    const clickable = candidatePoints
      .map((point) => ({ point, hit: document.elementFromPoint(point.x, point.y) }))
      .find(({ hit }) => hit && (hit === node || node.contains(hit)));
    const point = clickable?.point || candidatePoints[0];
    const hit = clickable?.hit || document.elementFromPoint(point.x, point.y);
    if (!clickable) {
      const blockerRect = hit?.getBoundingClientRect?.();
      return {
        error: 'control-obstructed',
        target: {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          documentY: rect.y + scrollY,
          text: (node.innerText || node.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 180),
          href: node instanceof HTMLAnchorElement ? node.href : '',
        },
        blocker: hit ? {
          tag: hit.tagName?.toLowerCase() || '',
          id: hit.id || '',
          className: typeof hit.className === 'string' ? hit.className : '',
          text: (hit.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 180),
          rect: blockerRect ? { x: blockerRect.x, y: blockerRect.y, width: blockerRect.width, height: blockerRect.height, documentY: blockerRect.y + scrollY } : null,
        } : null,
      };
    }
    window.__matboxAuditInteraction = { node, before, state };
    return { before, point };
  })()`;
}

function trustedClickResultExpression() {
  return `(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const audit = window.__matboxAuditInteraction;
    if (!audit) return { error: 'trusted-click-state-missing' };
    const after = audit.state(audit.node?.isConnected ? audit.node : null);
    const before = audit.before;
    return { before, after };
  })()`;
}

function trustedRestoredStateExpression() {
  return `(() => {
    const audit = window.__matboxAuditInteraction;
    if (!audit) return { error: 'trusted-click-state-missing' };
    const state = audit.state(audit.node?.isConnected ? audit.node : null);
    delete window.__matboxAuditInteraction;
    return state;
  })()`;
}

if (!requestedRoutes.length && process.env.MATBOX_INTERACTION_WORKER !== '1') {
  const shards = partitionInteractionRoutes(routes, interactionWorkerCount);
  const workerReports = await Promise.all(shards.map(async (shard, index) => {
    const id = String(index + 1);
    const reportPath = path.join(root, 'artifacts', 'full-site-audit', `source-local-interaction-parity-worker-${selectedViewport}-${id}.json`);
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), `--viewport=${selectedViewport}`, ...shard], {
        cwd: root,
        stdio: 'inherit',
        env: {
          ...process.env,
          MATBOX_INTERACTION_WORKER: '1',
          MATBOX_INTERACTION_WORKER_ID: id,
        },
      });
      child.once('error', reject);
      child.once('exit', () => resolve());
    });
    return JSON.parse(await fs.readFile(reportPath, 'utf8'));
  }));
  const merged = {
    ...mergeInteractionReports(workerReports, routes),
    generatedAt: new Date().toISOString(),
    sourceOrigin,
    localOrigin: process.env.MATBOX_LOCAL_ORIGIN || null,
    viewport: selectedViewport,
    workerCount: shards.length,
    importPlatform,
    timing: shards.length === 1 ? workerReports[0]?.timing : undefined,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    pass: merged.pass,
    routes: merged.routeCount,
    workers: merged.workerCount,
    sourceControls: merged.sourceControlCount,
    localControls: merged.localControlCount,
    comparedControls: merged.comparedControlCount,
    failures: merged.failures.length,
    outputPath,
  }, null, 2)}\n`);
  process.exit(merged.pass ? 0 : 1);
}

const localPort = process.env.MATBOX_LOCAL_ORIGIN ? null : await freePort();
const localOrigin = process.env.MATBOX_LOCAL_ORIGIN || `http://127.0.0.1:${localPort}`;
const debugPort = await freePort();
let profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-source-local-clicks-'));
const server = localPort ? spawn(process.execPath, ['scripts/serve.mjs', '--port', String(localPort)], { cwd: root, stdio: 'pipe' }) : null;
function spawnIsolatedChrome(profilePath) {
  return spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--window-size=1920,1080',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profilePath}`, 'about:blank',
  ], { stdio: 'ignore' });
}
let chrome = spawnIsolatedChrome(profile);
let cdp;
let currentTarget;
let interactionEpoch = 0;
let controlsExecutedInBrowser = 0;
const controlsPerBrowser = Math.max(1, Number(process.env.MATBOX_CONTROLS_PER_BROWSER || 12));
const interactionTiming = createInteractionTiming();

async function configureCdp(client) {
  await client.ready;
  await client.call('Page.enable');
  await client.call('Runtime.enable');
  await client.call('Emulation.setDeviceMetricsOverride', auditViewport);
}

async function replacePageTarget() {
  interactionEpoch += 1;
  const previousCdp = cdp;
  const previousTarget = currentTarget;
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?about%3Ablank`, { method: 'PUT' });
  if (!response.ok) throw new Error(`Failed to create clean Chrome target: ${response.status}`);
  const nextTarget = await response.json();
  if (!nextTarget?.webSocketDebuggerUrl) throw new Error('Clean Chrome target has no debugger URL');
  const nextCdp = connectCdp(nextTarget.webSocketDebuggerUrl);
  await configureCdp(nextCdp);
  cdp = nextCdp;
  currentTarget = nextTarget;
  previousCdp?.close();
  if (previousTarget?.id) {
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(previousTarget.id)}`).catch(() => {});
  }
}

function isInfrastructureFailure(error = '') {
  return /ERR_PROXY_CONNECTION_FAILED|ERR_(?:NETWORK|CONNECTION|TIMED_OUT|FAILED)|Chrome target unavailable|WebSocket/i.test(String(error));
}

async function stopChromeProcess() {
  if (!chrome || chrome.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    chrome.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    chrome.kill();
  });
}

async function restartChromeSession() {
  interactionEpoch += 1;
  cdp?.close();
  cdp = undefined;
  currentTarget = undefined;
  await stopChromeProcess();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
  profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-source-local-clicks-'));
  chrome = spawnIsolatedChrome(profile);
  currentTarget = await waitFor(async () => {
    const result = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = result.find((entry) => entry.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('Chrome target unavailable after restart');
    return target;
  });
  cdp = connectCdp(currentTarget.webSocketDebuggerUrl);
  await configureCdp(cdp);
  controlsExecutedInBrowser = 0;
}

async function cleanup() {
  cdp?.close();
  for (const child of [chrome, server].filter(Boolean)) if (child.exitCode === null) child.kill();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
}

try {
  await waitFor(async () => {
    const response = await fetch(`${localOrigin}/`);
    if (!response.ok) throw new Error(`Local server returned ${response.status}`);
  });
  currentTarget = await waitFor(async () => {
    const result = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const target = result.find((entry) => entry.type === 'page');
    if (!target?.webSocketDebuggerUrl) throw new Error('Chrome target unavailable');
    return target;
  });
  cdp = connectCdp(currentTarget.webSocketDebuggerUrl);
  await configureCdp(cdp);

  function assertInteractionEpoch(epoch) {
    if (epoch !== undefined && epoch !== interactionEpoch) throw new Error('stale-interaction-run');
  }

  async function evaluate(expression, epoch) {
    assertInteractionEpoch(epoch);
    const client = cdp;
    const result = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assertInteractionEpoch(epoch);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async function loadUrl(url, epoch, context = {}, purpose = 'inventory') {
    assertInteractionEpoch(epoch);
    const client = cdp;
    const phases = new Set(interactionLoadPhases(purpose));
    await measureInteractionPhase(interactionTiming, { phase: 'page-load', ...context }, async () => {
      const navigation = await client.call('Page.navigate', { url });
      assertInteractionEpoch(epoch);
      if (navigation.errorText) throw new Error(navigation.errorText);
      await waitFor(async () => {
        const pageState = await evaluate('({ readyState: document.readyState, bodyTextLength: document.body?.innerText?.trim().length || 0 })', epoch);
        if (!isInteractionPageReady(pageState)) throw new Error(`Page not ready: ${url} state=${JSON.stringify(pageState)}`);
        return true;
      });
      assertInteractionEpoch(epoch);
    });
    if (phases.has('page-stabilize')) {
      await measureInteractionPhase(interactionTiming, { phase: 'page-stabilize', ...context }, async () => {
        await evaluate('window.__matboxInteractionAudit = true; window.__matboxUseTrustedClick = true; true', epoch);
        await evaluate(stableStateExpression, epoch);
        await evaluate(afterSettleStateExpression, epoch);
      });
    } else {
      await evaluate('window.__matboxInteractionAudit = true; window.__matboxUseTrustedClick = true; true', epoch);
    }
    await measureInteractionPhase(interactionTiming, { phase: 'content-ready', ...context }, async () => {
      await waitFor(async () => {
        const contentState = await evaluate(`(() => {
        const selector = 'a[href],button,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"],input[type="range"],summary,[role="button"],select';
        const commerce = document.querySelector('#searchspring-category');
        return {
          bodyTextLength: document.body?.innerText?.trim().length || 0,
          controlCount: document.querySelectorAll(selector).length,
          commercePresent: Boolean(commerce),
          productCount: commerce?.querySelectorAll('.product-card,.ss-product').length || 0,
        };
        })()`, epoch);
        if (!isInteractionContentReady(contentState)) throw new Error(`Content not ready: ${url} state=${JSON.stringify(contentState)}`);
        return true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
  }

  function effectFromStates(before, after, control) {
    const selectionChanged = (
      before.pressed !== after.pressed
      || before.checked !== after.checked
      || before.ownClass !== after.ownClass
      || before.selectedCount !== after.selectedCount
      || before.imageSource !== after.imageSource
    );
    const valueChanged = before.value !== after.value;
    const effectType = inferInteractionEffect({
        before,
        after: { ...after, selectionChanged, valueChanged },
      });
    if (control?.calendlyBound && effectType === 'no-op') {
      return {
        effectType: 'modal',
        urlBefore: before.url,
        urlAfter: after.url,
        visiblePanelsDelta: 1,
        openDetailsDelta: 0,
        surfaceKind: 'modal',
        syntheticInteractionContract: 'calendly-modal',
      };
    }
    return {
      effectType,
      urlBefore: before.url,
      urlAfter: after.url,
      expanded: after.expanded,
      pressed: after.pressed,
      checked: after.checked,
      selectionChanged,
      valueChanged,
      openDetailsDelta: Number(after.openDetails || 0) - Number(before.openDetails || 0),
      visiblePanelsDelta: Number(after.visiblePanels || 0) - Number(before.visiblePanels || 0),
      surfaceKind: after.surfaceKind || '',
      surface: after.surface || null,
      bodyOverflow: after.bodyOverflow || '',
      storageChanged: before.localStorageDigest !== after.localStorageDigest,
      sessionChanged: before.sessionStorageDigest !== after.sessionStorageDigest,
      cookieChanged: before.cookieDigest !== after.cookieDigest,
    };
  }

  function comparableInteractionState(state = {}) {
    return {
      url: state.url || '',
      historyLength: state.historyLength || 0,
      visiblePanels: state.visiblePanels || 0,
      openDetails: state.openDetails || 0,
      selectedState: JSON.stringify({
        expanded: state.expanded ?? null,
        pressed: state.pressed ?? null,
        checked: state.checked ?? null,
        value: state.value ?? null,
        ownClass: state.ownClass || '',
        selectedCount: state.selectedCount || 0,
        imageSource: state.imageSource || '',
        bodyOverflow: state.bodyOverflow || '',
      }),
      localStorageDigest: state.localStorageDigest || '',
      sessionStorageDigest: state.sessionStorageDigest || '',
      cookieDigest: state.cookieDigest || '',
      popupCount: state.popupCount || 0,
      mutationRequestCount: state.mutationRequestCount || 0,
    };
  }

  function isTrivialHashNavigation(beforeUrl = '', afterUrl = '') {
    return String(beforeUrl).replace(/#$/, '') === String(afterUrl).replace(/#$/, '');
  }

  async function dispatchTrustedClick(point, epoch) {
    assertInteractionEpoch(epoch);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('control-point-missing');
    const client = cdp;
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
    assertInteractionEpoch(epoch);
  }

  function waitForNavigationSignal(timeoutMs = 1500, epoch) {
    assertInteractionEpoch(epoch);
    const client = cdp;
    return new Promise((resolve) => {
      let settled = false;
      let timer;
      const removers = [];
      const finish = (url = '') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        for (const remove of removers) remove();
        resolve(url);
      };
      removers.push(client.on('Page.frameNavigated', ({ frame }) => {
        if (frame && !frame.parentId) finish(frame.url || '');
      }));
      removers.push(client.on('Page.navigatedWithinDocument', ({ url }) => finish(url || '')));
      timer = setTimeout(() => finish(''), timeoutMs);
    });
  }

  async function listPageTargets() {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    if (!response.ok) throw new Error(`Chrome target list returned ${response.status}`);
    return (await response.json()).filter((target) => target.type === 'page');
  }

  async function waitForNewPageTarget(existingIds, timeoutMs = 1500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const target = (await listPageTargets()).find((candidate) => (
        !existingIds.has(candidate.id)
        && candidate.url
        && candidate.url !== 'about:blank'
      ));
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return null;
  }

  let lastInteractionStates = null;

  async function executeControl(url, control, context, { resetBefore = true } = {}) {
    const epoch = interactionEpoch;
    if (resetBefore) await loadUrl(url, epoch, context, 'control-reset');
    lastInteractionStates = null;
    if (control.disabled) return { disabled: true, effectType: 'disabled' };
    const prepared = await measureInteractionPhase(interactionTiming, { phase: 'control-prepare', ...context }, async () => {
      await evaluate(closeDelayedPopupExpression, epoch);
      const currentDocumentHeight = await evaluate('document.documentElement.scrollHeight', epoch);
      const preparationScrollPositions = interactionControlPreparationScrollCandidates(
        control,
        auditViewport.height,
        currentDocumentHeight,
      );
      let liveControls = [];
      let liveControl;
      for (const preparationScrollY of preparationScrollPositions) {
        await evaluate(`(async () => {
          scrollTo(0, ${Number(preparationScrollY)});
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return true;
        })()`, epoch);
        const identityDeadline = Date.now() + Number(process.env.MATBOX_CONTROL_IDENTITY_WAIT_MS || 1500);
        do {
          const liveInventory = await evaluate(inventoryExpression, epoch);
          liveControls = enrichControls(liveInventory.controls);
          liveControl = liveControls.find((candidate) => (
            candidate.fingerprint === control.fingerprint
            && candidate.occurrence === control.occurrence
          ));
          if (liveControl) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } while (Date.now() < identityDeadline);
        if (liveControl) break;
      }
      if (!liveControl) {
        const nearby = liveControls
          .filter((candidate) => Math.abs(Number(candidate.documentY || 0) - Number(control.documentY || 0)) < auditViewport.height)
          .slice(0, 8)
          .map(({ fingerprint, occurrence, text, ariaLabel, href, documentY }) => ({ fingerprint, occurrence, text, ariaLabel, href, documentY }));
        throw new Error(`control-missing-after-reset:${control.fingerprint}:${control.occurrence}:${JSON.stringify({
          expected: {
            text: control.text,
            ariaLabel: control.ariaLabel,
            href: control.href,
            documentY: control.documentY,
          },
          liveControlCount: liveControls.length,
          attemptedScrollPositions: preparationScrollPositions,
          nearby,
        })}`);
      }
      return evaluate(trustedClickPreparationExpression(liveControl.index, control.classification === 'boundary-only'), epoch);
    });
    if (prepared?.error) throw new Error(`${prepared.error}:${JSON.stringify({ target: prepared.target || null, blocker: prepared.blocker || null })}`);
    if (control.classification === 'navigation') {
      const beforeUrl = prepared.before?.url || await evaluate('location.href', epoch);
      lastInteractionStates = { before: prepared.before, after: null };
      const existingTargetIds = new Set((await listPageTargets()).map((target) => target.id));
      const navigationSignal = waitForNavigationSignal(1500, epoch);
      await measureInteractionPhase(interactionTiming, { phase: 'click-dispatch', ...context }, () => dispatchTrustedClick(prepared.point, epoch));
      const navigatedUrl = await measureInteractionPhase(interactionTiming, { phase: 'click-settle', ...context }, () => navigationSignal);
      assertInteractionEpoch(epoch);
      if (navigatedUrl && navigatedUrl !== beforeUrl && !isTrivialHashNavigation(beforeUrl, navigatedUrl)) {
        return { effectType: 'navigation', urlBefore: beforeUrl, urlAfter: navigatedUrl, path: navigatedUrl };
      }
        const newPageTarget = await measureInteractionPhase(interactionTiming, { phase: 'new-tab-settle', ...context }, () => waitForNewPageTarget(existingTargetIds, 1500));
      if (newPageTarget) {
        await fetch(`http://127.0.0.1:${debugPort}/json/close/${encodeURIComponent(newPageTarget.id)}`).catch(() => {});
        const result = await measureInteractionPhase(interactionTiming, { phase: 'state-read', ...context }, () => evaluate(trustedClickResultExpression(), epoch));
        if (!result?.error) lastInteractionStates = { before: result.before, after: result.after };
        return { effectType: 'navigation', urlBefore: beforeUrl, urlAfter: newPageTarget.url, path: newPageTarget.url, target: 'new-tab' };
      }
      const result = await measureInteractionPhase(interactionTiming, { phase: 'state-read', ...context }, () => evaluate(trustedClickResultExpression(), epoch));
      if (result?.error === 'trusted-click-state-missing') {
        const currentUrl = await evaluate('location.href', epoch);
        if (currentUrl !== beforeUrl && !isTrivialHashNavigation(beforeUrl, currentUrl)) {
          return { effectType: 'navigation', urlBefore: beforeUrl, urlAfter: currentUrl, path: currentUrl };
        }
        if (isTrivialHashNavigation(beforeUrl, currentUrl)) {
          return {
            effectType: 'no-op', urlBefore: beforeUrl, urlAfter: beforeUrl,
            expanded: null, pressed: null, checked: null,
            selectionChanged: false, valueChanged: false,
            openDetailsDelta: 0, visiblePanelsDelta: 0,
            surfaceKind: '', surface: null,
          };
        }
      }
      if (result?.error) throw new Error(result.error);
      lastInteractionStates = { before: result.before, after: result.after };
      return effectFromStates(result.before, result.after, control);
    }
    await measureInteractionPhase(interactionTiming, { phase: 'click-dispatch', ...context }, () => dispatchTrustedClick(prepared.point, epoch));
    const result = await measureInteractionPhase(interactionTiming, { phase: 'click-settle', ...context }, () => evaluate(trustedClickResultExpression(), epoch));
    if (result?.error) throw new Error(result.error);
    lastInteractionStates = { before: result.before, after: result.after };
    return effectFromStates(result.before, result.after, control);
  }

  async function restoreControlState(effect, context) {
    const states = lastInteractionStates;
    if (!states?.before) return false;
    if (effect.effectType === 'navigation' && effect.target !== 'new-tab') {
      const navigationSignal = waitForNavigationSignal(3000, interactionEpoch);
      await evaluate('history.back(); true', interactionEpoch);
      await navigationSignal;
      await waitFor(async () => {
        const readyState = await evaluate('document.readyState', interactionEpoch);
        if (readyState === 'loading') throw new Error('history-restore-loading');
        return true;
      }, 5000);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } else if (effect.effectType !== 'no-op' && effect.target !== 'new-tab') {
      await measureInteractionPhase(interactionTiming, { phase: 'control-restore', ...context }, async () => {
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await new Promise((resolve) => setTimeout(resolve, 150));
      });
    }
    const restored = await evaluate(trustedRestoredStateExpression(), interactionEpoch);
    if (restored?.error) return false;
    return isInteractionStateRestored(
      comparableInteractionState(states.before),
      comparableInteractionState(restored),
    );
  }

  async function auditUrl(url, side, routeKey = new URL(url).pathname) {
    const route = routeKey;
    const context = { route, side };
    let baselineIdentity;
    let baselinePath;
    if (side === 'source') {
      baselinePath = sourceInteractionBaselinePath(sourceBaselineRoot, {
        sourceOrigin,
        route,
        viewport: selectedViewport,
        selection: sourceSelection,
      });
      if (!refreshSourceBaseline) {
        const frozen = await loadFrozenSourceInteractionBaseline(baselinePath, {
          sourceOrigin,
          route,
          viewport: selectedViewport,
          contractVersion: interactionContractVersion,
          selection: sourceSelection,
        });
        if (frozen) {
          process.stdout.write(`SOURCE_BASELINE FROZEN_HIT ${selectedViewport} ${route} controls=${frozen.controls.length}\n`);
          return { controls: frozen.controls, diagnostics: frozen.diagnostics, baselineStatus: 'frozen-hit' };
        }
      }
    }
    await loadUrl(url, undefined, context);
    const inventory = await measureInteractionPhase(interactionTiming, { phase: 'inventory', ...context }, async () => {
      await evaluate(closeDelayedPopupExpression);
      return evaluate(inventoryExpression);
    });
    const controls = selectInteractionControls(enrichControls(inventory.controls), requestedFingerprints);
    if (side === 'source') {
      baselineIdentity = createSourceBaselineIdentity({
        sourceOrigin,
        route,
        viewport: selectedViewport,
        contractVersion: interactionContractVersion,
        selection: sourceSelection,
        inventorySignature: interactionInventorySignature(controls),
      });
      const cached = await loadSourceInteractionBaseline(baselinePath, baselineIdentity);
      if (cached) {
        process.stdout.write(`SOURCE_BASELINE HIT ${selectedViewport} ${route} controls=${cached.controls.length}\n`);
        return { controls: cached.controls, diagnostics: inventory.diagnostics, baselineStatus: 'hit' };
      }
    }
    const plan = interactionRunPlan({ route: new URL(url).pathname, controls });
    const adaptiveRunner = createAdaptiveInteractionRunner({
      pageReady: true,
      reset: async (kind) => {
        if (kind === 'new-context' || kind === 'server-fixture') await restartChromeSession();
        else if (kind === 'new-page') await replacePageTarget();
        await loadUrl(url, interactionEpoch, context, 'control-reset');
      },
      execute: (control) => executeControl(url, control, context, { resetBefore: false }),
      restore: ({ effect }) => restoreControlState(effect, context),
    });
    const attempts = await executeInteractionPlan({
      runs: plan,
      timeoutMs: Number(process.env.MATBOX_CONTROL_TIMEOUT_MS || 15000),
      maxAttempts: 2,
      shouldRetry: (error) => /control-timeout|trusted-click-state-missing|control-missing-after-reset|ERR_(?:NETWORK|CONNECTION|TIMED_OUT|FAILED)/i.test(error),
      onAttemptFailure: async ({ error }) => {
        adaptiveRunner.resetSession();
        if (isInfrastructureFailure(error)) await restartChromeSession();
        else await replacePageTarget();
      },
      onTimeout: async ({ error }) => {
        adaptiveRunner.resetSession();
        if (isInfrastructureFailure(error)) await restartChromeSession();
        else await replacePageTarget();
      },
      executeRun: async (run) => {
        if (controlsExecutedInBrowser >= controlsPerBrowser) await restartChromeSession();
        controlsExecutedInBrowser += 1;
        const control = controls.find((candidate) => (
          candidate.fingerprint === run.fingerprint
          && candidate.occurrence === run.occurrence
        ));
        if (!control) throw new Error(`control-plan-mismatch ${run.fingerprint} occurrence=${run.occurrence}`);
        const execution = await adaptiveRunner.run(control);
        return {
          ...control,
          effect: execution.effect,
          isolation: execution.isolation,
          restored: execution.restored,
          resetApplied: execution.resetApplied,
        };
      },
      onProgress({ completed, total, ok, run, error }) {
        const checkpoint = completed === 1 || completed === total || completed % 10 === 0;
        if (!quietProgress || !ok || checkpoint) {
          process.stdout.write(`CONTROL ${selectedViewport} ${side} ${completed}/${total} ${ok ? 'PASS' : 'ERROR'} ${run.fingerprint}${error ? ` ${error}` : ''}\n`);
        }
      },
      async onResult({ ok, error, timedOut }) {
        if (!ok && !timedOut && isInfrastructureFailure(error)) {
          adaptiveRunner.resetSession();
          await restartChromeSession();
        } else if (!ok && !timedOut) {
          adaptiveRunner.resetSession();
          await replacePageTarget();
        }
      },
    });
    const executed = attempts.map((attempt) => {
      if (attempt.ok) return attempt.value;
      const control = controls.find((candidate) => candidate.fingerprint === attempt.run.fingerprint && candidate.occurrence === attempt.run.occurrence);
      return { ...control, effect: { effectType: 'error', error: attempt.error } };
    });
    let baselineStatus = 'not-applicable';
    if (side === 'source') {
      baselineStatus = 'rejected';
      if (isReusableSourceBaselineEvidence(executed)) {
        await writeSourceInteractionBaseline(baselinePath, {
          identity: baselineIdentity,
          controls: executed,
          diagnostics: inventory.diagnostics,
        });
        baselineStatus = 'captured';
        process.stdout.write(`SOURCE_BASELINE CAPTURED ${selectedViewport} ${route} controls=${executed.length}\n`);
      }
    }
    return { controls: executed, diagnostics: inventory.diagnostics, baselineStatus };
  }

  let checkpoint = await loadSourceLocalParityCheckpoint(checkpointPath, { auditKey, routeOrder });
  let report = {
    ...checkpoint.report,
    generatedAt: new Date().toISOString(),
    sourceOrigin,
    localOrigin,
    viewport: selectedViewport,
    routeCount: routeOrder.length,
    auditKey,
    localBuildStamp,
  };

  for (const route of checkpoint.pendingRoutes) {
    try {
      const sourceAudit = await auditUrl(`${sourceOrigin}${route}`, 'source', route);
      // A source control may open an external tab and background the audited
      // target. Recreate the isolated browser before local parity so request
      // animation frames and target ownership are deterministic.
      await restartChromeSession();
      const localUrl = new URL(route, localOrigin);
      if (selectedViewport === 'mobile') localUrl.searchParams.set('matbox-viewport', 'mobile');
      const localAudit = await auditUrl(localUrl.href, 'local', route);
      const source = sourceAudit.controls;
      const local = localAudit.controls;
      const comparison = compareInteractionInventories({ source, local, sourceOrigin, interactionRedirects });
      const routeResult = {
        route,
        sourceCount: source.length,
        localCount: local.length,
        comparedCount: comparison.comparedCount,
        sourceDiagnostics: sourceAudit.diagnostics,
        localDiagnostics: localAudit.diagnostics,
        sourceBaselineStatus: sourceAudit.baselineStatus,
        pass: comparison.pass,
      };
      const routeFailures = comparison.failures.map((failure) => ({ route, ...failure }));
      checkpoint = recordSourceLocalParityRoute(checkpoint, {
        route,
        routeResult,
        failures: routeFailures,
        completed: true,
      });
      await writeSourceLocalParityCheckpoint(checkpointPath, checkpoint);
      report = { ...report, ...checkpoint.report };
      process.stdout.write(`PARITY ${checkpoint.completedRoutes.length}/${routes.length} ${route} source=${source.length} local=${local.length} failures=${comparison.failures.length}\n`);
    } catch (error) {
      const routeError = { route, type: 'route-audit-error', error: String(error?.stack || error) };
      checkpoint = recordSourceLocalParityRoute(checkpoint, {
        route,
        routeResult: { route, pass: false, error: String(error?.message || error) },
        failures: [routeError],
        completed: false,
      });
      await writeSourceLocalParityCheckpoint(checkpointPath, checkpoint);
      report = { ...report, ...checkpoint.report };
      process.stdout.write(`PARITY_ERROR ${checkpoint.completedRoutes.length}/${routes.length} ${route} ${String(error?.message || error)}\n`);
    }
  }

  report.pass = report.failures.length === 0 && checkpoint.completedRoutes.length === routes.length;
  report.completedRouteCount = checkpoint.completedRoutes.length;
  report.pendingRouteCount = checkpoint.pendingRoutes.length;
  const finalReport = withInteractionTiming(report, interactionTiming);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(finalReport, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    pass: finalReport.pass,
    routes: finalReport.routeCount,
    sourceControls: finalReport.sourceControlCount,
    localControls: finalReport.localControlCount,
    comparedControls: finalReport.comparedControlCount,
    failures: finalReport.failures.length,
    timing: finalReport.timing,
    outputPath,
  }, null, 2)}\n`);
  if (!finalReport.pass) process.exitCode = 1;
} finally {
  await cleanup();
}
