import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertBrowserLaunchAllowed } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const browserPath = process.env.MATBOX_CHROMIUM_PATH;
if (!browserPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
assertBrowserLaunchAllowed(browserPath);
const debugPort = 9400 + (process.pid % 500);
const url = process.argv[2] || 'http://127.0.0.1:4173/?lang=zh-CN&audit=1';
const screenshotArg = process.argv.find((item) => item.startsWith('--screenshot='));
const screenshotPath = screenshotArg ? path.resolve(screenshotArg.slice('--screenshot='.length)) : null;
const profile = await fs.mkdtemp(path.join(process.cwd(), '.audit-chrome-'));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--window-size=1200,900', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, url], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
try {
  let target;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      target = list.find((item) => item.type === 'page' && item.url.startsWith('http://127.0.0.1'));
      if (target) break;
    } catch {}
    await sleep(100);
  }
  if (!target) throw new Error('Browser target unavailable');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter(message);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    pending.set(requestId, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result));
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  await call('Runtime.enable');
  let runtimeReady = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    const ready = await call('Runtime.evaluate', { expression: 'document.readyState === "complete" && Boolean(window.MatboxReplayLocale?.ready)', returnByValue: true });
    if (ready.result.value) { runtimeReady = true; break; }
    await sleep(100);
  }
  if (!runtimeReady) throw new Error(`Localization runtime unavailable at ${target.url}`);
  const physicalClick = async (expression) => {
    const point = await call('Runtime.evaluate', { expression: `(() => { const element = ${expression}; if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`, returnByValue: true });
    if (!point.result.value) return false;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point.result.value });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point.result.value });
    return true;
  };
  if (process.argv.includes('--close-popup')) {
    await physicalClick(`document.querySelector('[data-subscription-popup-close]')`);
    for (let attempt = 0; attempt < 30; attempt++) {
      const closed = await call('Runtime.evaluate', { expression: `Boolean(document.querySelector('[data-subscription-popup]')?.hidden)`, returnByValue: true });
      if (closed.result.value) break;
      await sleep(100);
    }
  }
  if (process.argv.includes('--open-shop-all')) {
    await physicalClick(`Array.from(document.querySelectorAll('[data-menu-trigger]')).find(item => /Shop All|全部商品/.test(item.textContent))`);
    await sleep(100);
  }
  if (screenshotPath) {
    await call('Page.enable');
    const capture = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
    await fs.writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
  }
  const expression = `(() => {
    const visible = element => { const s = getComputedStyle(element); const r = element.getBoundingClientRect(); return !element.hidden && s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const values = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue.replace(/\\s+/g, ' ').trim();
      if (!text || !/[A-Za-z]{2}/.test(text) || !visible(node.parentElement)) continue;
      values.push({ text, tag: node.parentElement.tagName.toLowerCase(), cls: String(node.parentElement.className || '').slice(0, 80) });
    }
    const unique = [...new Set(values.map(item => item.text))].sort();
    const openMenu = document.querySelector('details[open] [data-menu-panel]');
    const menuRect = openMenu?.getBoundingClientRect();
    const menuStyle = openMenu ? getComputedStyle(openMenu) : null;
    const menuSample = openMenu?.querySelector('a, h3, .mega-menu__inner');
    const sampleRect = menuSample?.getBoundingClientRect();
    const sampleStyle = menuSample ? getComputedStyle(menuSample) : null;
    return { url: location.href, locale: window.MatboxLocale.getLocale(), missing: window.MatboxLocale.getMissingTranslations(), englishVisibleCount: values.length, englishUniqueCount: unique.length, englishUnique: unique,
      openMenu: openMenu ? { top: menuRect.top, left: menuRect.left, width: menuRect.width, height: menuRect.height, display: menuStyle.display, visibility: menuStyle.visibility, opacity: menuStyle.opacity, zIndex: menuStyle.zIndex,
        background: menuStyle.backgroundColor, sample: menuSample ? { text: menuSample.textContent.trim().slice(0, 80), top: sampleRect.top, width: sampleRect.width, height: sampleRect.height, display: sampleStyle.display, visibility: sampleStyle.visibility, opacity: sampleStyle.opacity, color: sampleStyle.color, transform: sampleStyle.transform } : null } : null };
  })()`;
  const result = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.stdout.write(JSON.stringify(result.result.value, null, 2));
} finally {
  socket?.close();
  browser.kill();
  await Promise.race([new Promise((resolve) => browser.once('exit', resolve)), sleep(1500)]);
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }).catch(() => {});
}
