import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const urls = process.argv.slice(2).length ? process.argv.slice(2) : ['https://www.cocorepublic.com.au/', 'http://127.0.0.1:4173/'];
const width = Number(process.env.MATBOX_VIEWPORT_WIDTH || 1908);
const height = Number(process.env.MATBOX_VIEWPORT_HEIGHT || 1000);

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

async function waitFor(fn, timeout = 45000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { return await fn(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 200));
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

const expression = `(() => {
  const text = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
  const rect = (node) => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      tag: node.tagName, id: node.id, className: String(node.className || '').slice(0, 220),
      left: Math.round(box.left), right: Math.round(box.right), top: Math.round(box.top + scrollY),
      width: Math.round(box.width), height: Math.round(box.height), display: style.display,
      gridTemplateColumns: style.gridTemplateColumns, gap: style.gap, widthCss: style.width,
      minWidth: style.minWidth, maxWidth: style.maxWidth, overflow: style.overflow,
      flex: style.flex, flexBasis: style.flexBasis, flexGrow: style.flexGrow, flexShrink: style.flexShrink,
      position: style.position, transform: style.transform, marginLeft: style.marginLeft, marginRight: style.marginRight,
      paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, leftCss: style.left, rightCss: style.right,
    };
  };
  const heading = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,div,span'))
    .find((node) => text(node).toUpperCase() === 'SHOP THE SALE');
  const heroLinks = document.querySelector('.home-hero .cr-msb__links, .cr-msb__links');
  const heroAnchor = heroLinks?.querySelector('a') || null;
  const hero = heroLinks?.closest('.home-hero, [data-content-region="home_hero"], section') || null;
  const heroAncestors = [];
  for (let node = hero; node && node !== document.body; node = node.parentElement) {
    heroAncestors.push({ ...rect(node), attributes: Object.fromEntries(Array.from(node.attributes).map((a) => [a.name, a.value])) });
  }
  const ancestors = [];
  for (let node = heading; node && node !== document.body; node = node.parentElement) ancestors.push(rect(node));
  const root = heading?.closest('section') || heading?.parentElement?.parentElement;
  const candidates = Array.from(document.querySelectorAll('div,ul,ol')).filter((node) => {
    const children = Array.from(node.children);
    const labels = text(node).toUpperCase();
    const box = node.getBoundingClientRect();
    return children.length >= 8
      && children.length <= 12
      && children.filter((child) => child.querySelector('img')).length >= 8
      && (!heading || box.top + scrollY > heading.getBoundingClientRect().top + scrollY)
      && labels.includes('SOFAS') && labels.includes('BEDROOM') && labels.includes('OUTDOOR') && labels.includes('RUGS');
  });
  const grid = candidates.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] || null;
  const gridAncestors = [];
  for (let node = grid; node && node !== document.body; node = node.parentElement) {
    gridAncestors.push({ ...rect(node), attributes: Object.fromEntries(Array.from(node.attributes).map((a) => [a.name, a.value])) });
  }
  const children = grid ? Array.from(grid.children).map((child) => {
    const result = rect(child);
    const image = child.querySelector('img');
    return { ...result, image: image ? { src: image.currentSrc || image.src, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, rect: rect(image) } : null };
  }) : [];
  const rows = [...new Set(children.map((child) => child.top))];
  return {
    url: location.href, viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth, heading: rect(heading), ancestors,
    hero: rect(hero), heroLinks: rect(heroLinks), heroAnchor: rect(heroAnchor), heroAncestors,
    heroGapToNextHeading: heroAnchor && heading
      ? Math.round(heading.getBoundingClientRect().top - heroAnchor.getBoundingClientRect().bottom)
      : null,
    root: rect(root), grid: rect(grid), gridAncestors, attributes: grid ? Object.fromEntries(Array.from(grid.attributes).map((a) => [a.name, a.value])) : null,
    contextHtml: heading?.parentElement?.parentElement?.parentElement?.outerHTML.slice(0, 6000) || '',
    childCount: children.length, rowCount: rows.length,
    columnsPerRow: rows.map((top) => children.filter((child) => child.top === top).length), children,
  };
})()`;

async function inspect(url) {
  const debugPort = await freePort();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-section-parity-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', `--window-size=${width},${height}`, `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  try {
    const target = await waitFor(async () => {
      const entries = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      const page = entries.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
      if (!page) throw new Error('Chrome target unavailable');
      return page;
    });
    cdp = connectCdp(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await cdp.call('Page.navigate', { url });
    const evaluate = async (code) => {
      const result = await cdp.call('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await waitFor(async () => {
      const state = await evaluate(`({ ready: document.readyState, text: document.body?.innerText || '' })`);
      if (state.ready === 'loading' || !state.text.toUpperCase().includes('SHOP THE SALE')) throw new Error('Section not ready');
      return true;
    });
    await evaluate(`Array.from(document.querySelectorAll('h1,h2,h3,h4,p,div,span')).find((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim().toUpperCase() === 'SHOP THE SALE')?.scrollIntoView({ block: 'center' })`);
    await evaluate(`Array.from(document.querySelectorAll('img[data-src]')).forEach((image) => { if (!image.src) image.src = image.dataset.src; })`);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return await evaluate(expression);
  } finally {
    cdp?.close();
    if (chrome.exitCode === null) chrome.kill();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
  }
}

const results = [];
for (const url of urls) results.push(await inspect(url));
const outputResults = process.env.MATBOX_SUMMARY === '1'
  ? results.map((result) => ({
    url: result.url, viewportWidth: result.viewportWidth, hero: result.hero, heroAncestors: result.heroAncestors, heroLinks: result.heroLinks,
    heroAnchor: result.heroAnchor, heroGapToNextHeading: result.heroGapToNextHeading,
    heading: result.heading, grid: result.grid, gridAncestors: result.gridAncestors,
    childCount: result.childCount, rowCount: result.rowCount, columnsPerRow: result.columnsPerRow,
    children: result.children.map((child) => ({ width: child.width, height: child.height, maxWidth: child.maxWidth, image: child.image && { naturalWidth: child.image.naturalWidth, naturalHeight: child.image.naturalHeight, width: child.image.rect?.width, height: child.image.rect?.height } })),
  }))
  : results;
process.stdout.write(`${JSON.stringify({ width, results: outputResults }, null, 2)}\n`);
