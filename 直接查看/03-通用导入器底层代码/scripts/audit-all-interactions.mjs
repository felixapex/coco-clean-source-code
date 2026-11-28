import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { classifyVisibleAnchor } from './lib/visible-anchor-gate.mjs';
import { classifyPostClickNavigation, isExpectedNoChange } from './lib/interaction-click-outcome.mjs';
import { recordInteractionFailures } from './lib/interaction-audit-circuit-breaker.mjs';
import { auditedRoutePathname } from './lib/responsive-layout-gate.mjs';
import { assertSafeBrowserPath } from './lib/browser-binary-fetch.mjs';
import { generatedStaticTargetExists } from './lib/static-target-gate.mjs';
import {
  buildInteractionAuditKey,
  loadInteractionAuditCheckpoint,
  recordInteractionAuditRoute,
  writeInteractionAuditCheckpoint,
} from './lib/interaction-audit-checkpoint.mjs';

const root = process.cwd();
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assertSafeBrowserPath(chromePath);
const distRoot = path.join(root, process.env.MATBOX_DIST_DIR || 'dist');
const routes = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'routes.json'), 'utf8'));
const routeFileArgument = process.argv.find((argument) => argument.startsWith('--route-file='));
const routeFileRoutes = routeFileArgument
  ? JSON.parse(await fs.readFile(path.resolve(routeFileArgument.slice('--route-file='.length)), 'utf8'))
  : [];
const requestedRoutes = [
  ...process.argv.slice(2).filter((route) => route.startsWith('/')),
  ...routeFileRoutes,
];
const generatedRoutePaths = new Set(Object.keys(routes));
const auditedRoutePaths = new Set(requestedRoutes.length ? requestedRoutes : generatedRoutePaths);
let interactionRedirects = {};
try {
  interactionRedirects = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'interaction-routes.json'), 'utf8')).redirects || {};
} catch {}
let sourceOrigins = new Set();
try {
  const routeLinkAudit = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'full-site-audit', 'route-link-audit.json'), 'utf8'));
  sourceOrigins = new Set(routeLinkAudit.sourceOrigins || []);
} catch {}
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const outputPath = outputArgument
  ? path.resolve(outputArgument.slice('--output='.length))
  : path.join(root, 'artifacts', 'full-site-audit', requestedRoutes.length ? 'interaction-click-audit-targeted.json' : 'interaction-click-audit.json');
const checkpointArgument = process.argv.find((argument) => argument.startsWith('--checkpoint='));
const checkpointPath = checkpointArgument
  ? path.resolve(checkpointArgument.slice('--checkpoint='.length))
  : outputPath.replace(/\.json$/i, '.checkpoint.json');
const routeOrder = [...auditedRoutePaths];
const hashContent = (value) => createHash('sha256').update(value).digest('hex');
const routeContentFingerprints = {};
for (const route of routeOrder) {
  const routeFile = routes[route] || routes[route === '/' ? '/' : route.replace(/\/+$/, '')];
  if (!routeFile) continue;
  try {
    routeContentFingerprints[route] = hashContent(await fs.readFile(path.join(distRoot, 'replay', routeFile)));
  } catch {
    routeContentFingerprints[route] = 'missing';
  }
}
let sharedContentFingerprint = '';
for (const sharedFile of [
  path.join(distRoot, 'interactive', 'runtime.js'),
  path.join(distRoot, 'interactive', 'runtime.css'),
  path.join(distRoot, 'app', 'index.js'),
]) {
  try { sharedContentFingerprint += hashContent(await fs.readFile(sharedFile)); } catch {}
}
const auditKey = buildInteractionAuditKey({
  routeOrder,
  interactionRedirects,
  generatedRoutePaths,
  routeContentFingerprints,
  sharedContentFingerprint,
});

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

async function waitFor(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { return await fn(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 75));
  }
  throw lastError ?? new Error('Timed out');
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
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
    close() { socket.close(); },
  };
}

const sitePort = await freePort();
const debugPort = await freePort();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-all-clicks-'));
const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(sitePort)], { cwd: root, stdio: 'pipe' });
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--no-default-browser-check', '--edge-skip-compat-layer-relaunch', '--window-size=1920,1080',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let cdp;

async function cleanup() {
  cdp?.close();
  for (const child of [chrome, server]) if (child.exitCode === null) child.kill();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
}
process.once('SIGINT', async () => { await cleanup(); process.exit(130); });

try {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${sitePort}/`);
    if (response.status !== 200) throw new Error(`Server returned ${response.status}`);
  });
  const targets = await waitFor(async () => {
    const result = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    if (!result.find((entry) => entry.type === 'page')?.webSocketDebuggerUrl) throw new Error('Chrome target unavailable');
    return result;
  });
  async function connectPage() {
    cdp?.close();
    let pageTargets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    let target = pageTargets.find((entry) => entry.type === 'page');
    if (!target) {
      target = await (await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' })).json();
    }
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  }
  await connectPage();

  async function evaluate(expression) {
    const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  async function navigate(route) {
    const result = await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}${route}` });
    if (result.errorText) throw new Error(result.errorText);
    await waitFor(async () => {
      const ready = await evaluate(`document.readyState !== 'loading'
        && Boolean(window.MatboxInteractive?.version)
        && location.pathname.replace(/\\/$/, '') === ${JSON.stringify(auditedRoutePathname(route))}`);
      if (!ready) throw new Error(`Route not ready: ${route}`);
      return true;
    });
  }

  let checkpoint = await loadInteractionAuditCheckpoint(checkpointPath, { auditKey, routeOrder });
  let report = checkpoint.report;
  const internalTargets = new Map(checkpoint.internalTargets || []);
  const circuitThreshold = Math.max(2, Number.parseInt(process.env.MATBOX_INTERACTION_CIRCUIT_THRESHOLD || '3', 10));
  let circuitBreaker = recordInteractionFailures(undefined, report.failures, { threshold: circuitThreshold });

  for (const route of checkpoint.pendingRoutes) {
    if (circuitBreaker.tripped) break;
    let routeResult = { route, visibleControls: 0, anchors: 0, buttons: 0, clickedButtons: 0, expectedNoChange: 0, staticTargets: 0, noEffectButtons: 0 };
    const routeFailuresBefore = report.failures.length;
    const internalTargetsBefore = structuredClone([...internalTargets.entries()]);
    let completed = false;
    try {
      await navigate(route);
      const inventory = await evaluate(`(() => {
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1 || !node.getClientRects().length) return false;
        for (let current = node; current instanceof Element; current = current.parentElement) {
          const style = getComputedStyle(current);
          if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity || 1) <= 0.01) return false;
        }
        return true;
      };
      const controls = [...document.querySelectorAll('a[href],button,input[type="button"],input[type="submit"],summary,[role="button"],select')]
        .filter(visible)
        .map((node, index) => {
          const id = 'audit-' + index;
          node.setAttribute('data-matbox-click-audit-id', id);
          const rect = node.getBoundingClientRect();
          return {
            id,
            tag: node.tagName.toLowerCase(),
            type: node.getAttribute('type') || '',
            className: typeof node.className === 'string' ? node.className : '',
            ariaLabel: node.getAttribute('aria-label') || '',
            ariaPressed: node.getAttribute('aria-pressed'),
            formInvalid: Boolean((node.form || node.closest('form')) && !(node.form || node.closest('form')).checkValidity()),
            quantityAtMin: Boolean(
              node.matches('[data-action="dec"]')
              && Number(node.closest('[data-quantity-change]')?.querySelector('input')?.value || 1)
                <= Number(node.closest('[data-quantity-change]')?.querySelector('input')?.min || 1)
            ),
            text: (node.innerText || node.value || node.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 180),
            href: node.tagName === 'A' ? node.href : null,
            disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
            rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
          };
        });
      return { controls, title: document.title, bodyTextLength: document.body.innerText.trim().length };
    })()`);
      routeResult.visibleControls = inventory.controls.length;
      report.visibleControlInstances += inventory.controls.length;

    for (const control of inventory.controls) {
      if (control.tag === 'a') {
        report.anchorInstances += 1;
        routeResult.anchors += 1;
        try {
          const localOrigin = `http://127.0.0.1:${sitePort}`;
          const classification = classifyVisibleAnchor({ href: control.href, localOrigin, generatedRoutes: generatedRoutePaths, sourceOrigins, interactionRedirects });
          if (classification.kind === 'failure') {
            if (
              classification.type === 'ungenerated-internal-target'
              && await generatedStaticTargetExists(distRoot, classification.target)
            ) routeResult.staticTargets += 1;
            else report.failures.push({ type: classification.type, route, control, target: classification.target });
          } else if (classification.kind === 'local') {
            const key = classification.target;
            const entry = internalTargets.get(key) || { target: key, occurrences: 0, sources: [] };
            entry.occurrences += 1;
            if (entry.sources.length < 5) entry.sources.push({ route, text: control.text });
            internalTargets.set(key, entry);
          }
        } catch {}
        continue;
      }
      report.nonAnchorButtonInstances += 1;
      routeResult.buttons += 1;
      if (control.disabled) continue;
      // Every button is executed from a clean copy of the page. A previous
      // button may replace or rerender the DOM, so reusing the first page would
      // produce false "missing" results and state-dependent interactions.
      await navigate(route);
      await evaluate(`(() => {
        const visible = (node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1 || !node.getClientRects().length) return false;
          for (let current = node; current instanceof Element; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') return false;
            if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity || 1) <= 0.01) return false;
          }
          return true;
        };
        [...document.querySelectorAll('a[href],button,input[type="button"],input[type="submit"],summary,[role="button"],select')]
          .filter(visible)
          .forEach((node, index) => node.setAttribute('data-matbox-click-audit-id', 'audit-' + index));
      })()`);
      let outcome;
      try {
        outcome = await evaluate(`(async () => {
        const node = document.querySelector('[data-matbox-click-audit-id="${control.id}"]');
        if (!node) return { missing: true };
        const visibleState = () => ({
          url: location.href,
          expanded: node.getAttribute('aria-expanded'),
          pressed: node.getAttribute('aria-pressed'),
          checked: 'checked' in node ? Boolean(node.checked) : null,
          value: 'value' in node ? node.value : null,
          ownClass: node.className,
          bodyClass: document.body.className,
          quantityValues: [...(node.closest('form,[data-quantity-change]')?.querySelectorAll('input') || [])].map((input) => input.value),
          carouselIndex: node.closest('[id^="bc-carousel-container-"]')?.dataset.matboxCarouselIndex || null,
          slickIndex: node.closest('.slick-slider')?.dataset.matboxSlickIndex || null,
          hiddenLoadMoreItems: node.matches('.ss-load-more')
            ? node.closest('#searchspring-category')?.querySelectorAll('[data-matbox-load-more-item][hidden]').length ?? null
            : null,
          loadMoreMarked: node.matches('.ss-load-more[data-matbox-load-more="true"]'),
          localAction: document.body.dataset.matboxLastAction || null,
          localForm: document.body.dataset.matboxLastForm || null,
          cartState: localStorage.getItem('matbox-demo-cart-v1'),
          openDetails: document.querySelectorAll('details[open]').length,
          openPopovers: document.querySelectorAll(':popover-open').length,
          visibleDialogs: [...document.querySelectorAll('[role="dialog"],.navPage-subMenu,[class*="drawer"],[class*="modal"]')]
            .filter((item) => { const r = item.getBoundingClientRect(); const s = getComputedStyle(item); return r.width > 1 && r.height > 1 && s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity || 1) > 0; }).length,
        });
        const before = visibleState();
        node.scrollIntoView({ block: 'center', inline: 'center' });
        node.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const after = visibleState();
        return { before, after };
        })()`);
      } catch (error) {
        report.clickedButtonInstances += 1;
        routeResult.clickedButtons += 1;
        await connectPage();
        let postClickUrl = '';
        try {
          postClickUrl = await waitFor(async () => evaluate('document.readyState !== "loading" ? location.href : ""'));
        } catch {}
        const localOrigin = `http://127.0.0.1:${sitePort}`;
        const navigation = classifyPostClickNavigation({
          beforeUrl: `${localOrigin}${route}`,
          afterUrl: postClickUrl,
          localOrigin,
          generatedRoutes: generatedRoutePaths,
          sourceOrigins,
          interactionRedirects,
        });
        if (navigation.kind === 'local-navigation') {
          const entry = internalTargets.get(navigation.target) || { target: navigation.target, occurrences: 0, sources: [] };
          entry.occurrences += 1;
          if (entry.sources.length < 5) entry.sources.push({ route, text: control.text });
          internalTargets.set(navigation.target, entry);
        } else if (navigation.kind === 'failure') {
          report.failures.push({ type: navigation.type, route, control, target: navigation.target, error: error.message });
        } else {
          report.failures.push({ type: 'target-replaced-during-click', route, control, postClickUrl, error: error.message });
        }
        await navigate(route);
        continue;
      }
      report.clickedButtonInstances += 1;
      routeResult.clickedButtons += 1;
      if (outcome.missing) {
        report.failures.push({ type: 'missing-before-click', route, control });
        continue;
      }
      const changed = JSON.stringify(outcome.before) !== JSON.stringify(outcome.after);
      if (!changed) {
        const expectedNoChange = isExpectedNoChange({ control, outcome });
        if (expectedNoChange) {
          report.expectedNoChangeInstances += 1;
          routeResult.expectedNoChange += 1;
        }
        else {
          routeResult.noEffectButtons += 1;
          report.failures.push({ type: 'no-observable-effect', route, control, outcome });
        }
      }
      if (new URL(outcome.after.url).pathname !== route) await navigate(route);
      else await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    }
      completed = true;
    } catch (error) {
      internalTargets.clear();
      for (const [key, value] of internalTargetsBefore) internalTargets.set(key, value);
      report.failures.push({ type: 'route-audit-failure', route, error: String(error?.stack || error) });
    }
    const routeFailures = report.failures.slice(routeFailuresBefore);
    checkpoint = recordInteractionAuditRoute(checkpoint, {
      route,
      routeResult,
      failures: routeFailures,
      completed,
      internalTargets: [...internalTargets.entries()],
    });
    report = checkpoint.report;
    await writeInteractionAuditCheckpoint(checkpointPath, checkpoint);
    process.stdout.write(`AUDIT ${report.routeResults.length}/${auditedRoutePaths.size} ${route} controls=${routeResult.visibleControls} noEffect=${routeResult.noEffectButtons}\n`);
    circuitBreaker = recordInteractionFailures(circuitBreaker, routeFailures, { threshold: circuitThreshold });
    if (circuitBreaker.tripped) {
      report.circuitBreaker = circuitBreaker.trigger;
      process.stderr.write(`INTERACTION CIRCUIT OPEN ${JSON.stringify(circuitBreaker.trigger)}\n`);
    }
  }

  report.uniqueInternalTargets = internalTargets.size;
  for (const target of circuitBreaker.tripped ? [] : internalTargets.values()) {
    const url = new URL(target.target, `http://127.0.0.1:${sitePort}`);
    await navigate(`${url.pathname}${url.search}`);
    const state = await evaluate(`(() => {
      const main = document.querySelector('main');
      return {
        path: location.pathname,
        title: document.title,
        heading: main?.querySelector('h1')?.innerText.trim() || '',
        mainTextLength: main?.innerText.trim().length || 0,
        mainHeight: main?.getBoundingClientRect().height || 0,
        bodyTextLength: document.body.innerText.trim().length,
      };
    })()`);
    const pass = state.path === url.pathname && (state.mainTextLength > 50 || state.bodyTextLength > 300) && state.mainHeight > 100;
    target.validated = pass;
    target.validationState = state;
    if (pass) report.validatedInternalTargets += 1;
    else report.failures.push({ type: 'invalid-internal-target', ...target, state });
  }

  report.internalTargetDetails = [...internalTargets.values()];
  report.pass = report.failures.length === 0 && !circuitBreaker.tripped;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    pass: report.pass,
    routes: report.sourceRouteCount,
    controls: report.visibleControlInstances,
    anchors: report.anchorInstances,
    buttonsClicked: report.clickedButtonInstances,
    expectedNoChange: report.expectedNoChangeInstances,
    internalTargets: report.uniqueInternalTargets,
    validatedTargets: report.validatedInternalTargets,
    failures: report.failures.length,
    outputPath,
  }, null, 2)}\n`);
  if (circuitBreaker.tripped) process.exitCode = 3;
  else if (!report.pass) process.exitCode = 1;
} finally {
  await cleanup();
}
