import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { auditedRoutePathname, classifyResponsiveFailures, findDuplicateTextOverlaps, findSectionRightGaps } from './lib/responsive-layout-gate.mjs';
import { assertSafeBrowserPath } from './lib/browser-binary-fetch.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
assertSafeBrowserPath(chromePath);
const duplicateOverlapDetectorSource = findDuplicateTextOverlaps.toString();
const sectionRightGapDetectorSource = findSectionRightGaps.toString();
const distRoot = path.join(root, process.env.MATBOX_DIST_DIR || 'dist');
const traceEnabled = process.env.MATBOX_AUDIT_TRACE === '1';
const trace = (event) => {
  if (traceEnabled) process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
};
const routeManifest = JSON.parse(await fs.readFile(path.join(distRoot, 'replay', 'routes.json'), 'utf8'));
const requestedRoutes = process.argv.filter((arg) => arg.startsWith('--route=')).map((arg) => arg.slice(8));
const routes = requestedRoutes.length ? [...new Set(requestedRoutes)] : Object.keys(routeManifest).sort();
const profiles = [
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'desktop', width: 1366, height: 900, mobile: false },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'desktop', width: 1920, height: 900, mobile: false },
  { name: 'desktop', width: 2560, height: 900, mobile: false },
];
const outputPath = path.join(root, 'artifacts', 'full-site-audit', 'responsive-layout.json');

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
    await new Promise((resolve) => setTimeout(resolve, 50));
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
const browserProfilesRoot = path.join(root, 'artifacts', 'browser-profiles');
await fs.mkdir(browserProfilesRoot, { recursive: true });
const profile = await fs.mkdtemp(path.join(browserProfilesRoot, 'responsive-audit-'));
const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(sitePort)], { cwd: root, stdio: 'pipe' });
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--no-default-browser-check', '--window-size=1920,1080', `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
let cdp;

async function cleanup() {
  cdp?.close();
  for (const child of [chrome, server]) if (child.exitCode === null) child.kill();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
}

try {
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${sitePort}/`);
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
  });
  const target = await waitFor(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = targets.find((entry) => entry.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('Chrome target unavailable');
    return page;
  });
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');

  async function evaluate(expression) {
    const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }

  const report = { generatedAt: new Date().toISOString(), routeCount: routes.length, profiles, cells: [], failures: [] };
  let completed = 0;
  for (const profile of profiles) {
    const { width } = profile;
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: profile.height, deviceScaleFactor: 1, mobile: profile.mobile });
    for (const route of routes) {
      try {
        const cellStartedAt = Date.now();
        const target = new URL(route, `http://127.0.0.1:${sitePort}`);
        target.searchParams.set('responsive-audit', String(width));
        if (profile.mobile) target.searchParams.set('matbox-viewport', 'mobile');
        trace({ route, width, stage: 'navigate', state: 'start' });
        const navigation = await cdp.call('Page.navigate', { url: target.href });
        if (navigation.errorText) throw new Error(navigation.errorText);
        trace({ route, width, stage: 'navigate', state: 'done', elapsedMs: Date.now() - cellStartedAt });
        trace({ route, width, stage: 'ready', state: 'start' });
        await waitFor(async () => {
          const ready = await evaluate(`document.readyState !== 'loading' && document.body?.childElementCount > 0 && location.pathname.replace(/\\/$/, '') === ${JSON.stringify(auditedRoutePathname(route))}`);
          if (!ready) throw new Error(`Route not ready: ${route}`);
          return true;
        });
        trace({ route, width, stage: 'ready', state: 'done', elapsedMs: Date.now() - cellStartedAt });
        trace({ route, width, stage: 'metrics', state: 'start' });
        const metrics = await evaluate(`(async () => {
          await Promise.race([document.fonts?.ready || Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 1500))]);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const viewportWidth = document.documentElement.clientWidth;
          const visible = (node) => {
            const style = getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            if (rect.width <= 1 || rect.height <= 1 || rect.bottom <= 0 || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) return false;
            for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              const parentStyle = getComputedStyle(parent);
              if (!/(?:hidden|clip)/.test(parentStyle.overflow + ' ' + parentStyle.overflowX + ' ' + parentStyle.overflowY)) continue;
              const parentRect = parent.getBoundingClientRect();
              const intersectionWidth = Math.max(0, Math.min(rect.right, parentRect.right) - Math.max(rect.left, parentRect.left));
              const intersectionHeight = Math.max(0, Math.min(rect.bottom, parentRect.bottom) - Math.max(rect.top, parentRect.top));
              if (intersectionWidth <= 1 || intersectionHeight <= 1) return false;
            }
            return true;
          };
          const intentionalScroller = (node) => {
            for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              const overflow = getComputedStyle(parent).overflowX;
              if (overflow === 'auto' || overflow === 'scroll') return true;
            }
            return false;
          };
          const overflowElements = Array.from(document.body.querySelectorAll('*')).filter(visible).map((node) => {
            const rect = node.getBoundingClientRect();
            return { node, rect };
          }).filter(({ node, rect }) => (rect.left < -2 || rect.right > viewportWidth + 2) && !intentionalScroller(node)).slice(0, 20).map(({ node, rect }) => ({
            tag: node.tagName, id: node.id, className: String(node.className || '').slice(0, 160),
            rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.width)],
            html: node.outerHTML.slice(0, 500),
            ancestors: Array.from({ length: 5 }, (_, index) => {
              let current = node;
              for (let step = 0; step <= index; step += 1) current = current?.parentElement;
              return current ? current.tagName + (current.id ? '#' + current.id : '') + (current.className ? '.' + String(current.className).trim().replace(/\\s+/g, '.') : '') : null;
            }).filter(Boolean),
          }));
          const mediaGaps = Array.from(document.querySelectorAll('[data-matbox-frozen-video="true"]')).filter(visible).map((node) => {
            const rect = node.getBoundingClientRect();
            const parent = node.parentElement?.getBoundingClientRect();
            if (!parent || parent.width < viewportWidth * 0.8) return null;
            const gap = Math.max(0, parent.right - rect.right) + Math.max(0, rect.left - parent.left);
            return gap > 2 ? { id: node.id, gap: Math.round(gap), mediaWidth: Math.round(rect.width), parentWidth: Math.round(parent.width) } : null;
          }).filter(Boolean);
          const rectSummary = (node) => {
            if (!node) return null;
            const rect = node.getBoundingClientRect();
            return { tag: node.tagName, id: node.id, className: String(node.className || '').slice(0, 120), left: Math.round(rect.left), right: Math.round(rect.right), top: Math.round(rect.top), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
          };
          const mainRect = rectSummary(document.querySelector('main, [role="main"]'));
          const diagnosticRects = Object.fromEntries(['html', 'body', '#evenflow', 'header', '#sitewide-banner-top', '#menu'].map((selector) => {
            const node = document.querySelector(selector);
            if (!node) return [selector, null];
            const style = getComputedStyle(node);
            return [selector, { ...rectSummary(node), computedWidth: style.width, maxWidth: style.maxWidth, minWidth: style.minWidth, position: style.position, display: style.display, overflowX: style.overflowX }];
          }));
          const primaryContentGap = mainRect && mainRect.height > 100 && mainRect.left <= 2
            ? Math.max(0, Math.round(viewportWidth - mainRect.right))
            : 0;
          const largeRightGaps = Array.from(document.body.children)
            .filter((node) => visible(node) && !node.matches('script,style,link,[data-matbox-interactive]'))
            .map(rectSummary)
            .filter((rect) => rect && rect.height > 200 && rect.left <= 2 && viewportWidth - rect.right > 2);
          const contentNodes = Array.from(document.querySelectorAll('main *, [role="main"] *')).filter((node) => visible(node));
          const contentRects = contentNodes.map((node) => ({ node, rect: rectSummary(node) }));
          const rightGapCandidates = contentRects
            .filter(({ rect }) => rect && rect.height > 180 && rect.right >= viewportWidth * 0.5 && viewportWidth - rect.right >= 100)
            .map(({ node, rect }) => {
              const parent = rectSummary(node.parentElement);
              return {
                ...rect,
                computedWidth: getComputedStyle(node).width,
                computedMaxWidth: getComputedStyle(node).maxWidth,
                display: getComputedStyle(node).display,
                frozenComponent: node.matches('[data-matbox-frozen-layout-box="true"],[data-matbox-frozen-card-grid-box="true"]'),
                parent,
                parentLeftGap: parent ? Math.round(rect.left - parent.left) : 0,
                parentRightGap: parent ? Math.round(parent.right - rect.right) : 0,
                parentWidthRatio: parent?.width ? Number((rect.width / parent.width).toFixed(3)) : 1,
              };
            })
            .slice(0, 40);
          const sectionRightGaps = (${sectionRightGapDetectorSource})(contentRects, viewportWidth);
          const textNodes = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,a,button,li,span')).filter((node) => {
            if (!visible(node) || node.children.length > 0) return false;
            const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
            return text.length >= 4 && text.length <= 100;
          }).map((node) => ({ node, text: node.textContent.replace(/\\s+/g, ' ').trim().toLowerCase(), rect: node.getBoundingClientRect() }));
          const duplicateOverlaps = (${duplicateOverlapDetectorSource})(textNodes);
          return {
            innerWidth: viewportWidth,
            scrollWidth: document.documentElement.scrollWidth,
            overflowElements,
            mediaGaps,
            mainRect,
            diagnosticRects,
            primaryContentGap,
            largeRightGaps,
            sectionRightGaps,
            rightGapCandidates,
            duplicateOverlaps,
          };
        })()`);
        trace({ route, width, stage: 'metrics', state: 'done', elapsedMs: Date.now() - cellStartedAt });
        const failures = classifyResponsiveFailures({ metrics, width });
        report.cells.push({ route, viewport: profile.name, width, pass: failures.length === 0, failures, ...metrics });
        for (const failure of failures) report.failures.push({ route, viewport: profile.name, width, failure });
      } catch (error) {
        report.cells.push({ route, viewport: profile.name, width, pass: false, failures: ['navigation-or-audit-error'], error: String(error?.stack || error) });
        report.failures.push({ route, viewport: profile.name, width, failure: 'navigation-or-audit-error' });
      }
      completed += 1;
      if (completed % 25 === 0 || completed === routes.length * profiles.length) {
        process.stdout.write(`${completed}/${routes.length * profiles.length} responsive cells; failures=${report.failures.length}\n`);
      }
    }
  }
  report.passedCells = report.cells.filter((cell) => cell.pass).length;
  report.failedCells = report.cells.length - report.passedCells;
  report.pass = report.failedCells === 0;
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ routeCount: report.routeCount, cellCount: report.cells.length, passedCells: report.passedCells, failedCells: report.failedCells, pass: report.pass }, null, 2)}\n`);
  if (!report.pass) process.exitCode = 2;
} finally {
  await cleanup();
}
