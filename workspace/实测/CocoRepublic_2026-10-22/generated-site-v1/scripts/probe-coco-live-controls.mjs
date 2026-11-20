import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const targetUrl = process.argv[2] || 'https://www.cocorepublic.com.au/sofas/standard/';

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

async function waitFor(fn, timeout = 30000) {
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

const debugPort = await freePort();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-coco-live-probe-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
  '--no-default-browser-check', '--edge-skip-compat-layer-relaunch', '--window-size=1920,1080',
  `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, targetUrl,
], { stdio: 'ignore' });
let cdp;

try {
  const targets = await waitFor(async () => {
    const entries = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const page = entries.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
    if (!page) throw new Error('Chrome target unavailable');
    return page;
  });
  cdp = connectCdp(targets.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Page.navigate', { url: targetUrl });
  const evaluate = async (expression) => {
    const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await waitFor(async () => {
    const state = await evaluate(`({ ready: document.readyState, url: location.href, title: document.title, body: document.body?.innerText.slice(0, 300) || '', cards: document.querySelectorAll('.product-card').length, loadMore: Boolean(document.querySelector('.ss-load-more')) })`);
    if (state.ready === 'loading' || !state.cards || !state.loadMore) throw new Error(`Storefront not ready: ${JSON.stringify(state)}`);
    return state;
  }, 45000);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const before = await evaluate(`(() => ({
    url: location.href,
    cards: document.querySelectorAll('.product-card').length,
    itemsText: document.querySelector('.items-shows')?.textContent.trim() || '',
    buttonText: document.querySelector('.ss-load-more')?.textContent.trim() || ''
  }))()`);
  await evaluate(`document.querySelector('.ss-load-more')?.click()`);
  let after;
  try {
    after = await waitFor(async () => {
      const state = await evaluate(`(() => ({
        url: location.href,
        cards: document.querySelectorAll('.product-card').length,
        itemsText: document.querySelector('.items-shows')?.textContent.trim() || '',
        buttonPresent: Boolean(document.querySelector('.ss-load-more'))
      }))()`);
      if (state.cards <= before.cards) throw new Error(`Card count unchanged: ${JSON.stringify(state)}`);
      return state;
    }, 20000);
  } catch (error) {
    after = { error: error.message, ...(await evaluate(`({ cards: document.querySelectorAll('.product-card').length, itemsText: document.querySelector('.items-shows')?.textContent.trim() || '' })`)) };
  }
  process.stdout.write(`${JSON.stringify({ targetUrl, before, after }, null, 2)}\n`);
} finally {
  cdp?.close();
  if (chrome.exitCode === null) chrome.kill();
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
}
