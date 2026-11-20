import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = path.resolve(import.meta.dirname, '..');
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const testDistDir = process.env.MATBOX_TEST_DIST_DIR || '.dist-staging';

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
    await new Promise((resolve) => setTimeout(resolve, 100));
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

test('Coco desktop account controls open the captured drawer and category clicks stay on local routes', async (t) => {
  if (process.env.MATBOX_SKIP_TEST_BUILD !== '1') {
    const build = spawnSync(process.execPath, ['scripts/build.mjs', '--stage-only', `--staging-dir=${testDistDir}`], { cwd: root, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr || build.stdout);
  }
  const sitePort = await freePort();
  const debugPort = await freePort();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-coco-nav-'));
  const server = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(sitePort)], {
    cwd: root,
    stdio: 'pipe',
    env: { ...process.env, MATBOX_DIST_DIR: testDistDir },
  });
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check',
    '--window-size=1920,1080', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let cdp;
  t.after(async () => {
    cdp?.close();
    for (const child of [chrome, server]) if (child.exitCode === null) child.kill();
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await waitFor(async () => assert.equal((await fetch(`http://127.0.0.1:${sitePort}/`)).status, 200));
  const targets = await waitFor(async () => {
    const result = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    if (!result.find((entry) => entry.type === 'page')?.webSocketDebuggerUrl) throw new Error('Chrome target unavailable');
    return result;
  });
  cdp = connectCdp(targets.find((entry) => entry.type === 'page').webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?nav-contract=1` });

  const evaluate = async (expression) => {
    const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await waitFor(async () => assert.equal(await evaluate('document.readyState !== "loading" && Boolean(window.MatboxInteractive)'), true));

  const accountDrawer = await evaluate(`(() => {
    const before = location.href;
    const trigger = document.querySelector('[data-slideout="login"]');
    trigger?.click();
    const shell = document.querySelector('#slide-out');
    const login = shell?.querySelector('.slide-out__content--login');
    return {
      triggerFound: Boolean(trigger),
      urlUnchanged: location.href === before,
      shellOpen: Boolean(shell && !shell.classList.contains('hidden')),
      loginOpen: Boolean(login && !login.classList.contains('hidden')),
      bodyLocked: document.body.classList.contains('matbox-slideout-open'),
    };
  })()`);
  assert.deepEqual(accountDrawer, {
    triggerFound: true,
    urlUnchanged: true,
    shellOpen: true,
    loginOpen: true,
    bodyLocked: true,
  });
  const accountClosed = await evaluate(`(() => {
    document.querySelector('#slide-out--close')?.click();
    const shell = document.querySelector('#slide-out');
    return {
      shellClosed: Boolean(shell?.classList.contains('hidden')),
      bodyUnlocked: !document.body.classList.contains('matbox-slideout-open'),
    };
  })()`);
  assert.deepEqual(accountClosed, { shellClosed: true, bodyUnlocked: true });

  const cartDrawer = await evaluate(`(() => {
    const before = location.href;
    const trigger = document.querySelector('#nav-preview-cart');
    trigger?.click();
    const shell = document.querySelector('#custom-cart');
    return {
      triggerFound: Boolean(trigger),
      urlUnchanged: location.href === before,
      shellOpen: Boolean(shell && !shell.hidden && shell.classList.contains('is-open')),
      dialog: shell?.getAttribute('role') === 'dialog',
      bodyLocked: document.body.classList.contains('matbox-cart-open'),
    };
  })()`);
  assert.deepEqual(cartDrawer, {
    triggerFound: true,
    urlUnchanged: true,
    shellOpen: true,
    dialog: true,
    bodyLocked: true,
  });
  const cartClosed = await evaluate(`(() => {
    document.querySelector('#custom-cart [data-cart-drawer-close]')?.click();
    const shell = document.querySelector('#custom-cart');
    return {
      shellClosed: Boolean(shell?.hidden),
      bodyUnlocked: !document.body.classList.contains('matbox-cart-open'),
    };
  })()`);
  assert.deepEqual(cartClosed, { shellClosed: true, bodyUnlocked: true });

  const emptyHash = await evaluate(`(async () => {
    const before = location.href;
    const trigger = [...document.querySelectorAll('a[href]')].find((node) => node.textContent.trim() === 'AU');
    trigger?.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { triggerFound: Boolean(trigger), urlUnchanged: location.href === before };
  })()`);
  assert.deepEqual(emptyHash, { triggerFound: true, urlUnchanged: true });

  const consultation = await evaluate(`(() => {
    const trigger = document.querySelector('#booking-calender');
    const href = trigger?.getAttribute('href') || '';
    trigger?.click();
    return { triggerFound: Boolean(trigger), href };
  })()`);
  assert.deepEqual(consultation, { triggerFound: true, href: '/complimentary-interior-design#book' });
  await waitFor(async () => assert.equal(await evaluate('location.pathname'), '/complimentary-interior-design'));
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?nav-contract=1` });
  await waitFor(async () => assert.equal(await evaluate('document.readyState !== "loading" && Boolean(window.MatboxInteractive)'), true));

  const initial = await evaluate(`(() => {
    const hero = document.querySelector('.home-hero');
    const trigger = [...document.querySelectorAll('.navPages-item .menu-title-widget.has-subMenu')]
      .find((node) => node.textContent.trim().toLowerCase() === 'sofas');
    const item = trigger?.closest('.navPages-item');
    const panel = item?.querySelector(':scope > .navPage-subMenu');
    item?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    const style = panel ? getComputedStyle(panel) : null;
    return {
      viewport: innerWidth,
      heroWidth: hero?.getBoundingClientRect().width || 0,
      triggerFound: Boolean(trigger),
      panelText: panel?.innerText || '',
      panelWidth: panel?.getBoundingClientRect().width || 0,
      panelOpacity: style?.opacity || '',
      panelVisibility: style?.visibility || '',
      openClass: item?.classList.contains('matbox-mega-open') || false,
      url: location.href,
    };
  })()`);
  assert.ok(initial.heroWidth >= initial.viewport * 0.99, JSON.stringify(initial));
  assert.equal(initial.triggerFound, true, JSON.stringify(initial));
  assert.equal(initial.openClass, true, JSON.stringify(initial));
  assert.equal(initial.panelOpacity, '1', JSON.stringify(initial));
  assert.equal(initial.panelVisibility, 'visible', JSON.stringify(initial));
  assert.ok(initial.panelWidth >= initial.viewport * 0.6, JSON.stringify(initial));
  assert.match(initial.panelText, /ALL SOFAS/i);
  assert.match(initial.url, new RegExp(`^http://127\\.0\\.0\\.1:${sitePort}/\\?nav-contract=1`));

  const mainCategory = await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('.navPages-item .menu-title-widget.has-subMenu')]
      .find((node) => node.textContent.trim().toLowerCase() === 'sofas');
    return { found: Boolean(trigger), href: trigger?.getAttribute('href') || '' };
  })()`);
  assert.equal(mainCategory.found, true, JSON.stringify(mainCategory));
  await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('.navPages-item .menu-title-widget.has-subMenu')]
      .find((node) => node.textContent.trim().toLowerCase() === 'sofas');
    trigger?.click();
  })()`);
  await waitFor(async () => assert.equal(
    await evaluate('location.pathname === "/sofas" && document.readyState !== "loading"'),
    true,
  ));

  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/?nav-contract=submenu` });
  await waitFor(async () => assert.equal(await evaluate('document.readyState !== "loading" && Boolean(window.MatboxInteractive)'), true));
  await evaluate(`(() => {
    const trigger = [...document.querySelectorAll('.navPages-item .menu-title-widget.has-subMenu')]
      .find((node) => node.textContent.trim().toLowerCase() === 'sofas');
    trigger?.closest('.navPages-item')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  })()`);

  const clicked = await evaluate(`(() => {
    const link = [...document.querySelectorAll('.navPages-item.matbox-mega-open .navPage-subMenu a[href]')]
      .find((node) => node.textContent.trim().toLowerCase() === 'standard sofas');
    if (!link) return { found: false };
    link.click();
    return { found: true, href: link.getAttribute('href') };
  })()`);
  assert.equal(clicked.found, true, JSON.stringify(clicked));
  assert.equal(clicked.href, '/sofas/standard');
  await waitFor(async () => assert.equal(
    await evaluate('location.pathname === "/sofas/standard" && document.readyState !== "loading" && Boolean(document.querySelector("main h1"))'),
    true,
  ));
  const destination = await evaluate(`(() => {
    const main = document.querySelector('main');
    const heading = main?.querySelector('h1');
    return {
      origin: location.origin,
      path: location.pathname,
      heading: heading?.textContent.trim() || '',
      mainHeight: main?.getBoundingClientRect().height || 0,
      mainTextLength: main?.innerText.trim().length || 0,
      productSignals: main?.querySelectorAll('[class*="product"],article').length || 0,
    };
  })()`);
  assert.equal(destination.origin, `http://127.0.0.1:${sitePort}`, JSON.stringify(destination));
  assert.equal(destination.heading, 'Standard Sofas', JSON.stringify(destination));
  assert.ok(destination.mainHeight > 500, JSON.stringify(destination));
  assert.ok(destination.mainTextLength > 100, JSON.stringify(destination));
  assert.ok(destination.productSignals > 0, JSON.stringify(destination));

  const productInteractions = await evaluate(`(() => {
    const color = [...document.querySelectorAll('.ss-dropdown-button')]
      .find((node) => node.textContent.trim().toLowerCase() === 'color');
    const dropdown = color?.closest('.ss-dropdown');
    const panel = dropdown?.querySelector('.ss-dropdown-content');
    color?.click();
    const colorOpened = Boolean(
      color?.getAttribute('aria-expanded') === 'true'
      && panel?.classList.contains('ss-dropdown-open')
      && !panel?.classList.contains('ss-dropdown-closed')
    );
    panel?.querySelector('.ss-dropdown-close')?.click();
    const colorClosed = Boolean(
      color?.getAttribute('aria-expanded') === 'false'
      && panel?.classList.contains('ss-dropdown-closed')
    );

    const swatches = [...document.querySelectorAll('.product-card-swatches')]
      .map((host) => [...host.querySelectorAll('.product-card-swatch-button')])
      .find((items) => items.length > 1);
    const nextSwatch = swatches?.[1];
    nextSwatch?.click();
    const swatchSelected = Boolean(
      nextSwatch?.getAttribute('aria-pressed') === 'true'
      && nextSwatch?.querySelector('.product-card-swatch-item')?.classList.contains('selected')
      && !swatches?.[0]?.querySelector('.product-card-swatch-item')?.classList.contains('selected')
    );

    const wishlist = document.querySelector('.product-card-wishlist button[aria-label="add to wishlist"]');
    wishlist?.click();
    const wishlistSelected = Boolean(
      wishlist?.getAttribute('aria-pressed') === 'true'
      && wishlist?.classList.contains('matbox-wishlist-selected')
    );

    const commerce = document.querySelector('#searchspring-category');
    const grid = commerce?.querySelector('.product-grid,.ss-search-grid');
    const template = grid?.querySelector('.product-card');
    let prefetched = commerce?.querySelector('[data-matbox-load-more-item][hidden]');
    if (!prefetched && template) {
      prefetched = template.cloneNode(true);
      prefetched.hidden = true;
      prefetched.setAttribute('data-matbox-load-more-item', '');
      grid.append(prefetched);
    }
    let loadMore = commerce?.querySelector('.ss-load-more');
    if (!loadMore && commerce) {
      loadMore = document.createElement('button');
      loadMore.className = 'ss-load-more';
      loadMore.textContent = 'LOAD MORE';
      commerce.append(loadMore);
    }
    const preparedBatchSize = commerce?.querySelectorAll('[data-matbox-load-more-item][hidden]').length || 1;
    commerce?.setAttribute('data-matbox-load-more-batch-size', String(preparedBatchSize));
    loadMore?.setAttribute('data-matbox-load-more', 'true');
    if (loadMore) {
      loadMore.hidden = false;
      loadMore.disabled = false;
      loadMore.removeAttribute('aria-hidden');
      loadMore.removeAttribute('aria-disabled');
    }
    const beforeVisible = grid ? [...grid.querySelectorAll('.product-card')].filter((card) => !card.hidden).length : 0;
    const beforeHidden = commerce?.querySelectorAll('[data-matbox-load-more-item][hidden]').length || 0;
    let captureSeen = false;
    let bubbleSeen = false;
    document.addEventListener('click', (event) => {
      if (event.target === loadMore) captureSeen = true;
    }, { capture: true, once: true });
    document.addEventListener('click', (event) => {
      if (event.target === loadMore) bubbleSeen = true;
    }, { once: true });
    loadMore?.click();
    const afterVisible = grid ? [...grid.querySelectorAll('.product-card')].filter((card) => !card.hidden).length : 0;
    const afterHidden = commerce?.querySelectorAll('[data-matbox-load-more-item][hidden]').length || 0;
    const loadMoreWorked = Boolean(
      prefetched
      && beforeHidden > 0
      && afterVisible === beforeVisible + beforeHidden
      && afterHidden === 0
      && loadMore?.hidden
    );
    return {
      colorOpened, colorClosed, swatchSelected, wishlistSelected, loadMoreWorked,
      loadMoreDiagnostics: {
        beforeVisible,
        beforeHidden,
        afterVisible,
        afterHidden,
        buttonHidden: loadMore?.hidden,
        buttonDisabled: loadMore?.disabled,
        selectorMatch: loadMore?.matches('.ss-load-more[data-matbox-load-more="true"]'),
        commerceFound: Boolean(loadMore?.closest('#searchspring-category')),
        captureSeen,
        bubbleSeen,
        action: document.body.dataset.matboxLastAction || null,
      },
    };
  })()`);
  assert.equal(productInteractions.loadMoreWorked, true, JSON.stringify(productInteractions.loadMoreDiagnostics));
  assert.deepEqual({
    colorOpened: productInteractions.colorOpened,
    colorClosed: productInteractions.colorClosed,
    swatchSelected: productInteractions.swatchSelected,
    wishlistSelected: productInteractions.wishlistSelected,
  }, {
    colorOpened: true,
    colorClosed: true,
    swatchSelected: true,
    wishlistSelected: true,
  });

  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/faqs?accordion-contract=1` });
  await waitFor(async () => assert.equal(
    await evaluate('location.pathname === "/faqs" && document.readyState !== "loading" && Boolean(window.MatboxInteractive)'),
    true,
  ));
  const accordion = await evaluate(`(() => {
    const button = document.querySelector('.accordion-button[data-target]');
    const panel = button ? document.querySelector(button.getAttribute('data-target')) : null;
    button?.click();
    return {
      found: Boolean(button && panel),
      expanded: button?.getAttribute('aria-expanded'),
      collapsedClass: button?.classList.contains('collapsed'),
      panelShown: panel?.classList.contains('show'),
      panelHidden: panel?.getAttribute('aria-hidden'),
    };
  })()`);
  assert.deepEqual(accordion, {
    found: true,
    expanded: 'true',
    collapsedClass: false,
    panelShown: true,
    panelHidden: 'false',
  });

  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/cr11-h851-0002148-rug-anti-slip-underlay.html?product-contract=1` });
  await waitFor(async () => assert.equal(
    await evaluate('document.readyState !== "loading" && Boolean(window.MatboxInteractive) && Boolean(document.querySelector("[data-quantity-change]"))'),
    true,
  ));
  const product = await evaluate(`(() => {
    const options = document.querySelector('.options-modal-button');
    const quantity = document.querySelector('[data-quantity-change] input');
    const increase = document.querySelector('[data-quantity-change] [data-action="inc"]');
    const decrease = document.querySelector('[data-quantity-change] [data-action="dec"]');
    const cartForm = document.querySelector('form[data-cart-item-add]');
    options?.click();
    increase?.click();
    const afterIncrease = quantity?.value;
    decrease?.click();
    const afterDecrease = quantity?.value;
    cartForm?.requestSubmit();
    return {
      optionsExpanded: options?.getAttribute('aria-expanded'),
      optionsClass: document.body.classList.contains('matbox-product-options-open'),
      afterIncrease,
      afterDecrease,
      cartFormFound: Boolean(cartForm),
      cartFormNoValidate: cartForm?.noValidate || false,
      cartItems: window.MatboxInteractive?.readCart().items.length || 0,
      path: location.pathname,
    };
  })()`);
  assert.deepEqual(product, {
    optionsExpanded: 'true',
    optionsClass: true,
    afterIncrease: '2',
    afterDecrease: '1',
    cartFormFound: true,
    cartFormNoValidate: true,
    cartItems: 1,
    path: '/cr11-h851-0002148-rug-anti-slip-underlay.html',
  });

  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/olessio-wardrobes?carousel-contract=1` });
  await waitFor(async () => assert.equal(
    await evaluate('document.readyState !== "loading" && Boolean(window.MatboxInteractive) && Boolean(document.querySelector(".bc-carousel__arrow--right"))'),
    true,
  ));
  const carousel = await evaluate(`(() => {
    const arrow = document.querySelector('.bc-carousel__arrow--right');
    const container = arrow?.closest('[id^="bc-carousel-container-"]');
    const viewport = container?.querySelector('[id^="bc-carousel-"]:not([id^="bc-carousel-container-"])');
    const track = viewport?.firstElementChild;
    const before = track?.style.transform || '';
    arrow?.click();
    return {
      before,
      after: track?.style.transform || '',
      active: document.querySelector('.bc-carousel__bullet-active')?.getAttribute('data-bullet-index') || '',
    };
  })()`);
  assert.notEqual(carousel.after, carousel.before, JSON.stringify(carousel));
  assert.equal(carousel.active, '1', JSON.stringify(carousel));

  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${sitePort}/our-showrooms?storemapper-contract=1` });
  await waitFor(async () => assert.equal(
    await evaluate('document.readyState !== "loading" && Boolean(window.MatboxInteractive) && Boolean(document.querySelector("gmp-advanced-marker"))'),
    true,
  ));
  const storemapper = await evaluate(`(() => {
    const marker = document.querySelector('gmp-advanced-marker');
    marker?.click();
    const markerState = {
      active: marker?.classList.contains('matbox-store-active'),
      pressed: marker?.getAttribute('aria-pressed'),
      action: document.body.dataset.matboxLastAction || '',
    };
    const storeButton = document.querySelector('.strmpr-store-name-button');
    storeButton?.click();
    const storeAction = document.body.dataset.matboxLastAction || '';
    const before = document.querySelectorAll('.strmpr-search-result').length;
    const more = document.querySelector('.strmpr-view-more-stores-button');
    more?.click();
    const fullscreen = document.querySelector('.gm-fullscreen-control');
    fullscreen?.click();
    const fullscreenState = {
      pressed: fullscreen?.getAttribute('aria-pressed'),
      active: fullscreen?.closest('.strmpr-map')?.classList.contains('matbox-map-fullscreen'),
      action: document.body.dataset.matboxLastAction || '',
    };
    document.querySelector('[aria-label="地图镜头控件"]')?.click();
    const cameraAction = document.body.dataset.matboxLastAction || '';
    document.querySelector('[aria-label="键盘快捷键"]')?.click();
    const keyboardAction = document.body.dataset.matboxLastAction || '';
    const search = document.querySelector('.strmpr-search-box');
    if (search) search.value = 'Adelaide';
    document.querySelector('.strmpr-search-button')?.click();
    const searchAction = document.body.dataset.matboxLastAction || '';
    return {
      markerState,
      storeAction,
      before,
      after: document.querySelectorAll('.strmpr-search-result').length,
      generated: document.querySelectorAll('[data-matbox-generated-store]').length,
      moreHidden: more?.hidden,
      fullscreenState,
      cameraAction,
      keyboardAction,
      searchAction,
    };
  })()`);
  assert.equal(storemapper.markerState.active, true, JSON.stringify(storemapper));
  assert.equal(storemapper.markerState.pressed, 'true', JSON.stringify(storemapper));
  assert.match(storemapper.markerState.action, /^store:/);
  assert.match(storemapper.storeAction, /^store:/);
  assert.ok(storemapper.after > storemapper.before, JSON.stringify(storemapper));
  assert.ok(storemapper.generated > 0, JSON.stringify(storemapper));
  assert.equal(storemapper.moreHidden, true, JSON.stringify(storemapper));
  assert.deepEqual(storemapper.fullscreenState.pressed, 'true', JSON.stringify(storemapper));
  assert.equal(storemapper.fullscreenState.active, true, JSON.stringify(storemapper));
  assert.match(storemapper.fullscreenState.action, /^map:fullscreen:true:/);
  assert.match(storemapper.cameraAction, /^map:camera:/);
  assert.match(storemapper.keyboardAction, /^map:keyboard:/);
  assert.match(storemapper.searchAction, /^stores:search:adelaide:/);
});
