import baseTest, { after as baseAfter, before as baseBefore } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { assertBrowserLaunchAllowed } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'full-site-audit', 'route-inventory.json'), 'utf8'));
const isMajesticFixture = new URL(inventory.source).origin === 'https://majestic-template.myshopify.com';
const test = isMajesticFixture ? baseTest : baseTest.skip;
const before = isMajesticFixture ? baseBefore : () => {};
const after = isMajesticFixture ? baseAfter : () => {};
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
let sitePort;
let debugPort;
let server;
let chrome;
let profileDir;
let cdp;

async function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : null;
      probe.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error('Unable to allocate test port'));
        else resolve(port);
      });
    });
  });
}

async function waitFor(fn, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { return await fn(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error('Timed out');
}

function countTagsWithClass(html, className) {
  return [...html.matchAll(/<[^>]+\bclass=(["'])(.*?)\1[^>]*>/gi)]
    .filter((match) => match[2].split(/\s+/).includes(className)).length;
}

function connectCdp(url) {
  const ws = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  return {
    ready: new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    }),
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function evaluate(expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function clickAt(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) throw new Error('Control is not visible: ' + ${JSON.stringify(selector)} + '; url=' + location.href + '; hidden=' + element?.closest('[data-subscription-popup]')?.hidden);
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}

before(async () => {
  assertBrowserLaunchAllowed(chromePath);
  execFileSync(process.execPath, ['scripts/build.mjs', '--stage-only', '--staging-dir=dist'], { cwd: root, stdio: 'pipe' });
  sitePort = await findAvailablePort();
  debugPort = await findAvailablePort();
  server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(sitePort)], { cwd: root, stdio: 'pipe' });
  await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${sitePort}/`);
    assert.equal(response.status, 200);
  });
  profileDir = await fs.mkdtemp(path.join(root, '.test-chrome-'));
  chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--edge-skip-compat-layer-relaunch',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, 'about:blank',
  ], { stdio: 'ignore' });
  const targets = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
    const list = await response.json();
    if (!list.find((target) => target.type === 'page')?.webSocketDebuggerUrl) throw new Error('Chrome target unavailable');
    return list;
  });
  cdp = connectCdp(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  const navigation = await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/` });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  await waitFor(async () => {
    const ready = await evaluate(`location.href.startsWith('http://127.0.0.1:${sitePort}/') && document.readyState !== "loading"`);
    if (!ready) throw new Error('Document not ready');
  });
  try {
    await waitFor(async () => {
      const version = await evaluate('window.MatboxInteractive?.version');
      if (version !== '1.0.0') throw new Error('Interaction runtime not ready');
    });
  } catch (error) {
    const diagnostic = await evaluate(`(async () => {
      const script = document.querySelector('script[src*="interactive/runtime.js"]');
      const response = await fetch('/interactive/runtime.js');
      const source = await response.text();
      let manualResult;
      try { (0, eval)(source); manualResult = window.MatboxInteractive?.version || 'no-version'; }
      catch (runtimeError) { manualResult = String(runtimeError && runtimeError.stack || runtimeError); }
      return { baseURI: document.baseURI, scriptSrc: script?.src, status: response.status, bytes: source.length, manualResult };
    })()`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
  }
});

after(async () => {
  cdp?.close();
  for (const child of [chrome, server]) {
    if (!child || child.exitCode !== null) continue;
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
  if (profileDir) {
    try { await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); } catch {}
  }
});

test('homepage preserves the captured deterministic final reveal frame', async () => {
  const capturedMarkup = await fs.readFile(path.join(root, 'src', 'replay', 'route-home.html'), 'utf8');
  const capturedRevealedItems = countTagsWithClass(capturedMarkup, 'is-revealed');
  const state = await evaluate(`(() => ({
    revealItems: document.querySelectorAll('[data-reveal-item]').length,
    revealedItems: document.querySelectorAll('[data-reveal-item].is-revealed').length,
    allRevealedItems: document.querySelectorAll('.is-revealed').length,
    productVisible: document.querySelector('.featured-collection__tab-panel.is-active .grid-slider__item')?.classList.contains('is-revealed'),
    bundleVisible: document.querySelector('.product-bundle__item')?.classList.contains('is-revealed')
  }))()`);
  assert.equal(state.productVisible, true);
  assert.equal(state.bundleVisible, true);
  assert.equal(state.revealItems, state.revealedItems, 'every captured reveal item is frozen on its final visible frame');
  assert.equal(state.allRevealedItems, capturedRevealedItems, 'runtime preserves the captured initial reveal state');
});

test('mobile homepage preserves the captured reveal state exactly', async (t) => {
  t.after(() => cdp.call('Emulation.clearDeviceMetricsOverride'));
  const capturedMarkup = await fs.readFile(path.join(root, 'src', 'replay', 'route-home-mobile.html'), 'utf8');
  const expected = {
    pending: countTagsWithClass(capturedMarkup, 'is-reveal-pending'),
    revealed: countTagsWithClass(capturedMarkup, 'is-revealed'),
  };
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?matbox-viewport=mobile&mobile-reveal-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxInteractive && document.querySelector(".is-reveal-pending,.is-revealed"))')) {
      throw new Error('Mobile homepage runtime not ready');
    }
  });
  const actual = await evaluate(`(() => ({
    pending: document.querySelectorAll('.is-reveal-pending').length,
    revealed: document.querySelectorAll('.is-revealed').length,
  }))()`);
  assert.deepEqual(actual, expected);
});

test('featured product carousel adapts card width to a desktop viewport', async (t) => {
  t.after(() => cdp.call('Emulation.clearDeviceMetricsOverride'));
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?desktop-slider-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?desktop-slider-test=1" && window.MatboxInteractive && document.querySelector(".featured-collection__tab-panel.is-active .grid-slider__item"))')) {
      throw new Error('Featured product carousel not ready');
    }
  });
  const geometry = await evaluate(`(() => {
    const card = document.querySelector('.featured-collection__tab-panel.is-active .grid-slider__item');
    const track = card.closest('.grid-slider__track');
    return { viewport: innerWidth, cardWidth: card.getBoundingClientRect().width, capturedWidth: card.style.width, capturedTransform: track.style.transform };
  })()`);
  assert.equal(geometry.viewport, 1200);
  assert.ok(geometry.cardWidth >= 200, JSON.stringify(geometry));
  assert.notEqual(geometry.capturedWidth, '', JSON.stringify(geometry));
  assert.notEqual(geometry.capturedTransform, '', JSON.stringify(geometry));
});

test('featured product carousel shows a partial next card on a phone viewport', async (t) => {
  t.after(() => cdp.call('Emulation.clearDeviceMetricsOverride'));
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?mobile-slider-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?mobile-slider-test=1" && window.MatboxInteractive && document.querySelector(".featured-collection__tab-panel.is-active .grid-slider__item"))')) {
      throw new Error('Mobile carousel not ready');
    }
  });
  const geometry = await evaluate(`(() => {
    const card = document.querySelector('.featured-collection__tab-panel.is-active .grid-slider__item');
    const viewport = card.closest('.grid-slider__swiper');
    return { screen: innerWidth, physical: screen.width, visual: visualViewport.width,
      document: document.documentElement.scrollWidth, slider: card.closest('grid-slider').getBoundingClientRect().width,
      track: card.closest('.grid-slider__track').getBoundingClientRect().width,
      overflow: Array.from(document.querySelectorAll('body *')).map(element => ({
        tag: element.tagName.toLowerCase(), cls: String(element.className?.baseVal || element.className || '').slice(0, 90),
        right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width)
      })).filter(item => item.right > 1000).sort((a, b) => b.right - a.right).slice(0, 8),
      stylesheets: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).slice(0, 8).map(link => ({ loaded: Boolean(link.sheet), href: link.href.slice(-75) })),
      card: card.getBoundingClientRect().width, viewport: viewport.getBoundingClientRect().width,
      capturedWidth: card.style.width, capturedTransform: card.closest('.grid-slider__track').style.transform };
  })()`);
  assert.equal(geometry.physical, 390, JSON.stringify(geometry));
  assert.equal(geometry.visual, 390, JSON.stringify(geometry));
  assert.ok(geometry.card > geometry.viewport * 0.6 && geometry.card < geometry.viewport * 0.9, JSON.stringify(geometry));
  assert.notEqual(geometry.capturedWidth, '', JSON.stringify(geometry));
  assert.notEqual(geometry.capturedTransform, '', JSON.stringify(geometry));
});

test('homepage does not allow captured full-size images to widen the phone page', async (t) => {
  t.after(() => cdp.call('Emulation.clearDeviceMetricsOverride'));
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?mobile-overflow-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?mobile-overflow-test=1" && window.MatboxInteractive)')) {
      throw new Error('Mobile page not ready');
    }
  });
  const geometry = await evaluate(`(() => {
    const image = document.querySelector('.image-comparison__asset');
    const parent = image.parentElement;
    const background = document.querySelector('.sbc-hero__bg-media');
    return { screen: screen.width, visual: visualViewport.width, layout: innerWidth,
      scroll: document.documentElement.scrollWidth, image: image.getBoundingClientRect().width,
      imagePosition: getComputedStyle(image).position, imageMaxWidth: getComputedStyle(image).maxWidth,
      parentOverflow: getComputedStyle(parent).overflowX, parentClass: parent.className,
      background: background.getBoundingClientRect().width };
  })()`);
  if (geometry.imageMaxWidth === 'none') {
    t.skip('Remote theme stylesheet is blocked in this test environment');
    return;
  }
  assert.ok(geometry.scroll <= geometry.visual + 2, JSON.stringify(geometry));
});

test('featured product carousel next arrow advances the visible products', async (t) => {
  t.after(() => cdp.call('Emulation.clearDeviceMetricsOverride'));
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?slider-next-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?slider-next-test=1" && window.MatboxInteractive && document.querySelector(".featured-collection__tab-panel.is-active .grid-slider__btn--next"))')) {
      throw new Error('Carousel controls not ready');
    }
  });
  const before = await evaluate(`(() => {
    const panel = document.querySelector('.featured-collection__tab-panel.is-active');
    const viewport = panel.querySelector('.grid-slider__swiper');
    panel.querySelector('.grid-slider__btn--next').click();
    return { left: viewport.scrollLeft, range: viewport.scrollWidth - viewport.clientWidth };
  })()`);
  assert.ok(before.range > 100, JSON.stringify(before));
  await waitFor(async () => {
    if (!await evaluate('document.querySelector(".featured-collection__tab-panel.is-active .grid-slider__swiper").scrollLeft > 100')) {
      throw new Error('Next arrow did not advance the carousel');
    }
  });
});

test('runtime restores local navigation, panels, FAQ, forms, quantities, and cart state', async () => {
  assert.equal(await evaluate('window.MatboxInteractive?.version'), '1.0.0');
  assert.deepEqual(await evaluate(`JSON.stringify([
    window.MatboxInteractive.normalizeHref('https://majestic-template.myshopify.com/collections/bedroom'),
    window.MatboxInteractive.normalizeHref('https://majestic-template.myshopify.com/collections/all'),
    window.MatboxInteractive.normalizeHref('https://majestic-template.myshopify.com/collections'),
    window.MatboxInteractive.normalizeHref('https://majestic-template.myshopify.com/products/not-captured')
  ])`), JSON.stringify(['/collections/bedroom', '/collections/all', '/collections', null]));

  const menu = await evaluate(`(() => {
    const button = document.querySelector('[data-drawer-menu-toggle]'); button.click();
    return [button.getAttribute('aria-expanded'), document.body.classList.contains('matbox-drawer-menu-open')];
  })()`);
  assert.deepEqual(menu, ['true', true]);

  assert.equal(await evaluate(`(() => {
    const summary = document.querySelector('.collapsible-row__summary');
    const details = summary.closest('details'); const before = details.open; summary.click();
    return details.open !== before;
  })()`), true);

  const bundle = await evaluate(`(() => {
    document.querySelector('[data-bundle-toggle-button]').click();
    document.querySelector('[data-bundle-qty-increase]').click();
    document.querySelector('[data-bundle-submit]').click();
    const cart = JSON.parse(localStorage.getItem('matbox-demo-cart-v1'));
    return [cart.items.length, cart.items[0].quantity, document.querySelector('[data-cart-trigger]').getAttribute('data-cart-item-count')];
  })()`);
  assert.deepEqual(bundle, [1, 2, '2']);

  const formResult = await evaluate(`(() => {
    const form = document.querySelector('form[data-newsletter-validate]');
    const input = form.querySelector('input[type="email"]'); input.value = 'demo@example.com';
    form.requestSubmit();
    return document.querySelector('[data-matbox-notice]').textContent;
  })()`);
  assert.match(formResult, /Thank you|谢谢/);
});

test('desktop Shop All and Collections navigation menus visibly open when clicked', async (t) => {
  t.after(() => cdp.call('Emulation.clearDeviceMetricsOverride'));
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?header-navigation-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxInteractive && document.querySelector("[data-menu-trigger]"))')) {
      throw new Error('Header navigation not ready');
    }
  });
  await evaluate(`(() => {
    const popup = document.querySelector('[data-subscription-popup]');
    if (popup) { popup.hidden = true; popup.classList.remove('is-open'); popup.setAttribute('aria-hidden', 'true'); }
    for (const root of [document.documentElement, document.body]) {
      root.classList.remove('theme-subscription-popup-lock', 'theme-scroll-lock-active', 'lenis-stopped');
    }
  })()`);
  const triggers = await evaluate(`Array.from(document.querySelectorAll('[data-menu-trigger]')).slice(0, 2).map((item, index) => {
    item.dataset.matboxTestMenu = String(index);
    return item.textContent.trim();
  })`);
  assert.deepEqual(triggers, ['Shop All', 'Collections']);
  for (let index = 0; index < triggers.length; index += 1) {
    const hitBefore = await evaluate(`(() => {
      const trigger = document.querySelector('[data-matbox-test-menu="${index}"]');
      const rect = trigger.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return { inside: Boolean(hit && (hit === trigger || trigger.contains(hit))), hit: hit?.outerHTML.slice(0, 240), rect: [rect.left, rect.top, rect.width, rect.height] };
    })()`);
    assert.equal(hitBefore.inside, true, `${triggers[index]} hit target: ${JSON.stringify(hitBefore)}`);
    await clickAt(`[data-matbox-test-menu="${index}"]`);
    const state = await evaluate(`(() => {
      const trigger = document.querySelector('[data-matbox-test-menu="${index}"]');
      const details = trigger.closest('details');
      const panel = details.querySelector('[data-menu-panel]');
      const style = getComputedStyle(panel);
      const rect = panel.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, Math.min(innerHeight - 1, rect.top + Math.min(80, rect.height / 2)));
      return { open: details.open, expanded: trigger.getAttribute('aria-expanded'), visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0, hit: Boolean(hit && panel.contains(hit)), opaque: !/^rgba\([^)]*,\s*0\)$/.test(style.backgroundColor) && style.backgroundColor !== 'transparent' };
    })()`);
    assert.deepEqual(state, { open: true, expanded: 'true', visible: true, hit: true, opaque: true }, `${triggers[index]}: ${JSON.stringify(state)}`);
  }
});

test('uncaptured Shopify content links fall through to the live page instead of becoming dead links', async () => {
  const result = await evaluate(`(() => {
    const anchor = document.createElement('a');
    anchor.href = 'https://majestic-template.myshopify.com/products/not-captured';
    anchor.textContent = 'Uncaptured product';
    document.body.append(anchor);
    let preventedAtWindow = null;
    window.addEventListener('click', event => {
      if (event.target === anchor) {
        preventedAtWindow = event.defaultPrevented;
        event.preventDefault();
      }
    }, { once: true });
    anchor.click();
    anchor.remove();
    return { preventedAtWindow, notice: document.querySelector('[data-matbox-notice]')?.textContent || '' };
  })()`);
  assert.deepEqual(result, { preventedAtWindow: false, notice: '' });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?after-external-link-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?after-external-link-test=1" && window.MatboxInteractive)')) {
      throw new Error('Local page not restored after external-link test');
    }
  });
});

test('newsletter close button removes the visible popup and unlocks scrolling', async () => {
  await evaluate('sessionStorage.clear()');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?popup-close-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?popup-close-test=1" && window.MatboxInteractive && document.querySelector("[data-subscription-popup]"))')) {
      throw new Error('Popup not ready');
    }
  });
  const initiallyVisible = await evaluate(`(() => {
    const popup = document.querySelector('[data-subscription-popup]');
    return popup.getBoundingClientRect().width > 0 && getComputedStyle(popup).visibility !== 'hidden';
  })()`);
  assert.equal(initiallyVisible, true);

  await clickAt('.subscription-popup__close');
  const state = await evaluate(`(() => {
    const popup = document.querySelector('[data-subscription-popup]');
    const close = popup.querySelector('.subscription-popup__close');
    const rect = close.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      hidden: popup.hidden,
      visible: popup.getBoundingClientRect().width > 0 && getComputedStyle(popup).visibility !== 'hidden',
      popupLock: document.documentElement.classList.contains('theme-subscription-popup-lock'),
      scrollLock: document.documentElement.classList.contains('theme-scroll-lock-active'),
      hit: hit?.outerHTML.slice(0, 220),
      closeRect: [rect.left, rect.top, rect.width, rect.height],
    };
  })()`);
  assert.deepEqual({hidden:state.hidden,visible:state.visible,popupLock:state.popupLock,scrollLock:state.scrollLock}, { hidden: true, visible: false, popupLock: false, scrollLock: false }, JSON.stringify(state));
});

test('newsletter dismiss button stays dismissed after reloading', async () => {
  await evaluate('sessionStorage.clear()');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?popup-dismiss-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?popup-dismiss-test=1" && window.MatboxInteractive && document.querySelector("[data-subscription-popup]"))')) {
      throw new Error('Popup not ready');
    }
  });
  await clickAt('[data-subscription-popup-dismiss]');
  assert.equal(await evaluate('document.querySelector("[data-subscription-popup]").hidden'), true);
  assert.equal(await evaluate(`(() => {
    const popup = document.querySelector('[data-subscription-popup]');
    return sessionStorage.getItem('matbox-dismissed:' + popup.dataset.dismissKey);
  })()`), '1');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?popup-dismiss-test=2` });
  try {
    await waitFor(async () => {
      if (!await evaluate('Boolean(location.search === "?popup-dismiss-test=2" && window.MatboxInteractive && document.querySelector("[data-subscription-popup]")?.hidden)')) {
        throw new Error('Reloaded popup not ready');
      }
    });
  } catch (error) {
    const diagnostic = await evaluate(`(() => {
      const popup = document.querySelector('[data-subscription-popup]');
      return { url: location.href, ready: document.readyState, runtime: window.MatboxInteractive?.version,
        popupExists: Boolean(popup), hidden: popup?.hidden, key: popup?.dataset.dismissKey,
        stored: popup && sessionStorage.getItem('matbox-dismissed:' + popup.dataset.dismissKey) };
    })()`);
    throw new Error(`${error.message}: ${JSON.stringify(diagnostic)}`);
  }
  const state = await evaluate(`(() => ({
    hidden: document.querySelector('[data-subscription-popup]').hidden,
    scrollLock: document.documentElement.classList.contains('theme-scroll-lock-active')
  }))()`);
  assert.deepEqual(state, { hidden: true, scrollLock: false });
});

test('newsletter backdrop activation closes popup and unlocks scrolling', async () => {
  await evaluate('sessionStorage.clear()');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?popup-overlay-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(location.search === "?popup-overlay-test=1" && window.MatboxInteractive && document.querySelector("[data-subscription-popup]") && !document.querySelector("[data-subscription-popup]").hidden)')) {
      throw new Error('Popup not ready');
    }
  });
  await evaluate('document.querySelector("[data-subscription-popup-overlay]").click()');
  assert.deepEqual(await evaluate(`(() => ({
    hidden: document.querySelector('[data-subscription-popup]').hidden,
    scrollLock: document.documentElement.classList.contains('theme-scroll-lock-active')
  }))()`), { hidden: true, scrollLock: false });
});

test('Chinese URL renders translated header and homepage content without changing currency', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&campaign=test` });
  await waitFor(async () => {
    if (!await evaluate(`Boolean(location.search.includes('lang=zh-CN') && window.MatboxReplayLocale?.ready)`)) {
      throw new Error('Chinese replay not ready');
    }
  });
  const state = await evaluate(`(() => ({
    locale: window.MatboxLocale.getLocale(),
    lang: document.documentElement.lang,
    title: document.querySelector('.selection__header .section__heading')?.textContent.trim(),
    hero: document.querySelector('.hero__buttons .btn__label-text')?.textContent.trim(),
    switcher: document.querySelector('.header-localization__trigger')?.textContent,
    currency: document.querySelector('[data-currency-code]')?.getAttribute('data-currency-code') || 'USD',
    campaign: new URL(location.href).searchParams.get('campaign')
  }))()`);
  assert.equal(state.locale, 'zh-CN');
  assert.equal(state.lang, 'zh-CN');
  assert.equal(state.title, '定义你的家居空间');
  assert.match(state.hero, /新品系列/);
  assert.match(state.switcher, /中文/);
  assert.equal(state.currency, 'USD');
  assert.equal(state.campaign, 'test');
});

test('language drawer switches locally and preserves choice across routes', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&campaign=test` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxInteractive && document.querySelector("[data-localization-tab-panel=language] [name=locale_code][value=en]"))')) {
      throw new Error('Language drawer not ready');
    }
  });
  const switched = await evaluate(`(() => {
    const option = document.querySelector('[data-localization-tab-panel="language"] [name="locale_code"][value="en"]');
    option.click();
    return { locale: window.MatboxLocale.getLocale(), href: location.href,
      heading: document.querySelector('.selection__header .section__heading')?.textContent.trim() };
  })()`);
  assert.equal(switched.locale, 'en');
  assert.match(switched.href, /127\.0\.0\.1/);
  assert.match(switched.href, /campaign=test/);
  assert.equal(switched.heading, 'Spaces That Define Your Home');

  await evaluate('document.querySelector(\'[data-localization-tab-panel="language"] [name="locale_code"][value="zh-CN"]\').click()');
  assert.equal(await evaluate('window.MatboxLocale.getLocale()'), 'zh-CN');
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/collections/bedroom` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxReplayLocale?.ready && location.pathname === "/collections/bedroom")')) {
      throw new Error('Translated collection not ready');
    }
  }, 30000);
  const collectionState = await evaluate(`(() => ({
    locale: window.MatboxLocale.getLocale(), lang: document.documentElement.lang,
    label: document.querySelector('.header-localization__trigger')?.textContent,
    stored: localStorage.getItem('matbox-locale')
  }))()`);
  assert.equal(collectionState.locale, 'zh-CN');
  assert.equal(collectionState.lang, 'zh-CN');
  assert.equal(collectionState.stored, 'zh-CN');
  assert.match(collectionState.label, /中文/);
});

test('Chinese locale translates dynamically rendered cart and local notices', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&dynamic-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxReplayLocale?.ready && window.MatboxInteractive)')) {
      throw new Error('Chinese runtime not ready');
    }
  });
  const state = await evaluate(`(() => {
    localStorage.removeItem('matbox-demo-cart-v1');
    document.querySelector('[data-cart-trigger]').click();
    const empty = document.querySelector('.matbox-cart-empty')?.textContent.trim();
    const count = document.querySelector('[data-cart-trigger]').getAttribute('aria-label');
    window.MatboxInteractive.showNotice(window.MatboxLocale.t('notice.notGenerated'));
    return { empty, count, notice: document.querySelector('[data-matbox-notice-text]')?.textContent };
  })()`);
  assert.equal(state.empty, '购物车目前为空。');
  assert.equal(state.count, '购物车，0 件商品');
  assert.equal(state.notice, '此页面尚未在本地生成。');
});

test('unsupported locale is rejected and missing translation is reported with route', async () => {
  const result = await evaluate(`(() => {
    const before = window.MatboxLocale.getLocale();
    const accepted = window.MatboxLocale.setLocale('fr');
    window.MatboxLocale.getContent('majestic.product.not-translated', 'title');
    return { before, accepted, after: window.MatboxLocale.getLocale(),
      missing: window.MatboxLocale.getMissingTranslations().find(item => item.key === 'majestic.product.not-translated') };
  })()`);
  assert.equal(result.accepted, false);
  assert.equal(result.after, result.before);
  assert.equal(result.missing.locale, 'zh-CN');
  assert.equal(result.missing.path, '/');
});

test('cart renders language-pack text as text, never executable markup', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&escape-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxReplayLocale?.ready && window.MatboxInteractive)')) throw new Error('Cart page not ready');
  });
  const state = await evaluate(`(() => {
    window.MatboxLocalePacks.messages['zh-CN']['cart.remove'] = '<img data-pack-injection src=x>';
    localStorage.setItem('matbox-demo-cart-v1', JSON.stringify({ items: [{ id: 'sample', title: 'Sample', priceCents: 100, image: '', quantity: 1 }] }));
    document.querySelector('[data-cart-trigger]').click();
    return { injected: Boolean(document.querySelector('[data-pack-injection]')),
      button: document.querySelector('[data-matbox-cart-remove]')?.textContent };
  })()`);
  assert.equal(state.injected, false);
  assert.equal(state.button, '<img data-pack-injection src=x>');
});

test('localization drawer close button hides the drawer and removes the page lock', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&locale-close-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxInteractive && document.querySelector("[data-localization-drawer-close]"))')) {
      throw new Error('Localization drawer not ready');
    }
  });
  await evaluate(`(() => {
    const popup = document.querySelector('[data-subscription-popup]');
    if (popup) { popup.hidden = true; popup.classList.remove('is-open'); popup.setAttribute('aria-hidden', 'true'); }
    for (const root of [document.documentElement, document.body]) root.classList.remove('theme-subscription-popup-lock', 'theme-scroll-lock-active', 'lenis-stopped');
  })()`);
  await evaluate('document.querySelector("[data-localization-drawer-toggle]").click()');
  assert.equal(await evaluate('document.body.classList.contains("matbox-localization-open")'), true);
  const closeHit = await evaluate(`(() => {
    const control = document.querySelector('[data-localization-drawer-close]');
    const rect = control.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { inside: Boolean(hit && (hit === control || control.contains(hit))), hit: hit?.outerHTML.slice(0, 260), rect: [rect.left, rect.top, rect.width, rect.height] };
  })()`);
  assert.equal(closeHit.inside, true, JSON.stringify(closeHit));
  await clickAt('[data-localization-drawer-close]');
  assert.deepEqual(await evaluate(`(() => {
    const drawer = document.querySelector('[data-localization-drawer]');
    return { hidden: drawer.hidden, ariaHidden: drawer.getAttribute('aria-hidden'),
      openClass: drawer.classList.contains('is-open'), bodyLock: document.body.classList.contains('matbox-localization-open') };
  })()`), { hidden: true, ariaHidden: 'true', openClass: false, bodyLock: false });
});

test('Chinese localization drawer translates country names instead of leaving the region list in English', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&country-name-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxReplayLocale?.ready && document.querySelector("[name=country_code][value=US]"))')) throw new Error('Country list not ready');
  });
  const names = await evaluate(`(() => Object.fromEntries(['NE','NG','US','VN'].map(code => [code,
    document.querySelector('[name="country_code"][value="' + code + '"] .localization-drawer__option-name')?.textContent.trim()
  ])))()`);
  assert.deepEqual(names, { NE: '尼日尔', NG: '尼日利亚', US: '美国', VN: '越南' });
});

test('Chinese homepage translates representative content from every major section', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&coverage-test=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxReplayLocale?.ready)')) throw new Error('Chinese page not ready');
  });
  const pageText = await evaluate('document.body.textContent');
  for (const english of [
    'Use this space for a store update or special offer', 'Featured collection',
    'Veloura Two-Seater Sofa', 'Everything You Need to Know', 'From the blog',
    'Subscribe to our newsletter', 'About us', 'Shipping Policy'
  ]) assert.ok(!pageText.includes(english), `untranslated: ${english}`);
  for (const chinese of [
    '店铺公告或特别优惠', '精选商品', 'Veloura 双人沙发', '常见问题',
    '博客文章', '订阅我们的邮件资讯', '关于我们', '配送政策'
  ]) assert.ok(pageText.includes(chinese), `missing translation: ${chinese}`);
});

test('Chinese homepage reports zero unapproved English after allowing brands models names and currency', async () => {
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?lang=zh-CN&untranslated-audit=1` });
  await waitFor(async () => {
    if (!await evaluate('Boolean(window.MatboxReplayLocale?.ready && document.querySelector("[data-bundle-item] label.visually-hidden"))')) throw new Error('Chinese audit page not ready');
  });
  const report = await evaluate('window.MatboxReplayLocale.report()');
  assert.equal(report.status, 'partial-demo');
  assert.deepEqual(report.untranslatedVisible, []);
  const bundleLabel = await evaluate('document.querySelector("[data-bundle-item] label.visually-hidden")?.textContent.trim()');
  assert.match(bundleLabel, /加入组合/);
});

test('all generated collection routes report zero unapproved visible English', async () => {
  for (const route of ['/collections', '/collections/all', '/collections/bedroom', '/collections/tables', '/collections/dining-room', '/collections/living-room', '/collections/luxury-dining']) {
    await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}${route}?lang=zh-CN&collection-audit=1` });
    await waitFor(async () => {
      if (!await evaluate(`Boolean(window.MatboxReplayLocale?.ready && location.pathname === ${JSON.stringify(route)})`)) throw new Error('Collection not ready');
    });
    const report = await evaluate('window.MatboxReplayLocale.report()');
    assert.deepEqual(report.untranslatedVisible, [], `${route}: ${JSON.stringify(report.untranslatedVisible)}`);
  }
});
