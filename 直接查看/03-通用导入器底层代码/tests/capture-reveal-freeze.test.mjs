import test from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { captureHtml } from '../src/import-core/capture/chromium-capture.mjs';

const { PNG } = pngjs;

test('scroll-reveal nodes are frozen into their final visible state before serialization', async () => {
  const result = await captureHtml(`<!doctype html><html class="reveal-ready"><head><style>.reveal-ready .is-reveal-pending{opacity:0;transform:translateY(20px)}.is-revealed{opacity:1;transform:none}</style></head><body><section class="is-reveal-pending" data-reveal>Pending content</section><section class="is-revealed" data-reveal>Already revealed content</section></body></html>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.equal(result.metadata.visualReadiness.normalizedRevealItems, 2);
  assert.doesNotMatch(result.renderedDocument.html, /<section[^>]+class="[^"]*is-reveal-pending/);
  assert.match(result.renderedDocument.html, /is-revealed/);
  assert.match(result.renderedDocument.html, /opacity:\s*1\s*!important/);
  assert.match(result.renderedDocument.html, /Already revealed content<\/section>/);
  assert.equal((result.renderedDocument.html.match(/opacity:\s*1\s*!important/g) ?? []).length, 2);
});

test('runtime block content inside a paragraph survives HTML serialization without layout drift', async () => {
  const source = await captureHtml(`<!doctype html><style>html,body{margin:0}#host{margin:24px 0;font:16px/24px Arial}.block{height:120px;background:#246}</style><p id="host"></p><script>const block=document.createElement('div');block.className='block';block.textContent='Dynamic form';document.querySelector('#host').append(block)</script>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /data-matbox-original-tag="p"/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('CSSOM rules inserted into an empty runtime style element survive replay', async () => {
  const source = await captureHtml(`<!doctype html><style id="runtime"></style><div id="card">Runtime CSS</div><script>document.querySelector('#runtime').sheet.insertRule('#card{width:180px;height:120px;background:rgb(12,34,56)}')</script>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /#card\s*\{[^}]*width:\s*180px/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('decoded lazyload images are promoted to their deterministic visible state before capture', async () => {
  const source = await captureHtml(`<!doctype html><style>html,body{margin:0}.lazyload{opacity:0}.lazyloaded{opacity:1}img{display:block;width:120px;height:80px;background:#246}</style><img class="lazyload" data-src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="">`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /class="lazyloaded"/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('empty image sources serialize as transparent placeholders instead of re-requesting the replay document', async () => {
  const source = await captureHtml('<!doctype html><style>img{display:block;width:120px;height:80px}</style><img src="" alt="Unavailable product">', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  assert.doesNotMatch(source.renderedDocument.html, /<img[^>]+src=""/);
  assert.match(source.renderedDocument.html, /<img[^>]+src="data:image\/gif;base64,/);
  assert.match(source.renderedDocument.html, /data-matbox-empty-image-placeholder="true"/);
  assert.equal(source.metadata.visualReadiness.failedImages, 0);
});

test('non-Shopify main regions preserve their captured minimum height while allowing responsive growth', async () => {
  const source = await captureHtml('<!doctype html><style>html,body{margin:0}.region{padding:13px;font:17px/23px Arial}</style><main><section class="region">Section one<br>Second line</section><section class="region">Section two</section></main>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.equal((source.renderedDocument.html.match(/data-matbox-frozen-main-region="true"/g) ?? []).length, 2);
  assert.match(source.renderedDocument.html, /class="region"[^>]+min-height:\s*[\d.]+px\s*!important/);
  assert.doesNotMatch(source.renderedDocument.html, /class="region"[^>]+(?<!min-)height:\s*[\d.]+px\s*!important/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('component geometry reaches children nested below transparent page wrappers', async () => {
  const source = await captureHtml('<!doctype html><style>html,body{margin:0}.hero{height:80px}.description{height:60px}</style><main><div class="top_level_container"><div class="hero">Hero</div><div class="page"><div class="page-content"><div class="description">Description</div></div></div></div></main>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /class="hero"[^>]+data-matbox-component-width="320"/);
  assert.match(source.renderedDocument.html, /class="description"[^>]+data-matbox-component-height="60"/);
});

test('non-Shopify flex and grid boxes preserve measured geometry during replay', async () => {
  const source = await captureHtml('<!doctype html><style>html,body{margin:0}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;width:91%}.cell{display:flex;align-items:center;min-height:53px;padding:5px}</style><main><section class="top_level_container"><div class="full_plp_top"><div class="grid"><article class="cell">One</article><article class="cell">Two</article><article class="cell">Three</article></div></div></section></main>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-frozen-layout-box="true"/);
  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-captured-width="[\d.]+"/);
  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-captured-parent-width="[\d.]+"/);
  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-width-ratio="[\d.]+"/);
  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-responsive-width="constrained"/);
  assert.equal((source.renderedDocument.html.match(/data-matbox-frozen-layout-box="true"/g) ?? []).length >= 4, true);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('full-parent-width frozen components preserve fluid responsive intent', async () => {
  const source = await captureHtml('<!doctype html><style>html,body{margin:0}.full_plp_top{width:100%}.grid{display:grid;width:100%;grid-template-columns:1fr 1fr}.cell{display:flex;min-height:40px}</style><main><section class="top_level_container"><div class="full_plp_top"><div class="grid"><article class="cell">One</article><article class="cell">Two</article></div></div></section></main>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-responsive-width="fluid"/);
  assert.match(source.renderedDocument.html, /class="grid"[^>]+data-matbox-width-ratio="1(?:\.0+)?"/);
});

test('tall source and replay use full viewport width without disabling scrolling', async () => {
  const source = await captureHtml(`<!doctype html><style>body{margin:0}.page{height:900px;background:#eee}</style><div class="page"></div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /data-matbox-source-client-width="320"/);
  assert.match(source.renderedDocument.html, /data-matbox-hidden-scrollbar/);
  assert.match(source.renderedDocument.html, /overflow:\s*[^;]*auto\s*!important/);
  assert.equal(source.metadata.visualReadiness.standardizedScrollbarGutter, 1);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('runtime carousel and card-grid geometry are locked against replay-time percentage recalculation', async () => {
  const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const source = await captureHtml(`<!doctype html><style>html,body{margin:0}.page{height:900px}.card-grid-widget{width:95%}.productCarousel{width:100%}.slick-list{width:83.3333%}.slick-track{display:flex}.slick-slide{box-sizing:border-box;width:33.3333%!important;margin:0 12px}.slick-slide img{display:block;width:100%;aspect-ratio:4/3;background:#765}</style><div class="page"><div class="card-grid-widget"><div class="productCarousel"><div class="slick-list"><div class="slick-track"><div class="slick-slide"><img src="${transparentPixel}" alt=""></div><div class="slick-slide"><img src="${transparentPixel}" alt=""></div><div class="slick-slide"><img src="${transparentPixel}" alt=""></div></div></div></div></div></div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /class="slick-list"[^>]+data-matbox-frozen-carousel-geometry="true"/);
  assert.match(source.renderedDocument.html, /class="slick-slide"[^>]+width:\s*[\d.]+px\s*!important/);
  assert.equal((source.renderedDocument.html.match(/data-matbox-frozen-card-grid-box="true"/g) ?? []).length, 2);
  assert.match(source.renderedDocument.html, /class="card-grid-widget"[^>]+min-height:\s*[\d.]+px\s*!important/);
  assert.doesNotMatch(source.renderedDocument.html, /class="card-grid-widget"[^>]+(?<!min-)height:\s*[\d.]+px\s*!important/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('zero-height card-grid parents use their visible descendants as the captured height', async () => {
  const transparentPixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  const source = await captureHtml(`<!doctype html><style>
    html,body{margin:0}.card-grid-widget{position:relative;width:100%;height:0}.cat-cards{position:absolute;inset:0 auto auto 0;display:grid;grid-template-columns:repeat(4,1fr);width:100%;gap:4px}.category-block img{display:block;width:100%;height:80px}
  </style><div class="card-grid-widget"><div class="cat-cards">${Array.from({ length: 8 }, () => `<div class="category-block"><img src="${transparentPixel}" alt=""></div>`).join('')}</div></div><div id="after">After</div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 240, mobile: false },
  });

  assert.match(source.renderedDocument.html, /class="card-grid-widget"[^>]+data-matbox-frozen-card-grid-box="true"/);
  assert.match(source.renderedDocument.html, /class="card-grid-widget"[^>]+min-height:\s*[\d.]+px\s*!important/);
  assert.ok(source.metadata.visualReadiness.frozenCardGridBoxes >= 1);
});

test('computed transforms are locked inline before serialization', async () => {
  const result = await captureHtml(`<!doctype html><style>#mover{transform:translateY(24px)}</style><div id="mover">Moving content</div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  assert.equal(result.metadata.visualReadiness.frozenTransforms, 1);
  assert.match(result.renderedDocument.html, /id="mover"[^>]+transform:\s*matrix\([^;]+\)\s*!important/);
});

test('animated presentation is locked to the captured frame before replay', async () => {
  const source = await captureHtml(`<!doctype html><html><head><style>
    html,body{margin:0;background:white}
    @keyframes promo{from{opacity:0;filter:blur(4px);transform:translateY(20px)}to{opacity:1;filter:blur(0);transform:none}}
    #promo{width:160px;height:100px;background:#111;animation:promo 100s linear infinite;animation-delay:-25s}
  </style></head><body><div id="promo"></div></body></html>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.equal(source.metadata.visualReadiness.frozenAnimatedTargets, 1);
  assert.match(source.renderedDocument.html, /id="promo"[^>]+opacity:\s*[\d.]+\s*!important/);
  assert.match(source.renderedDocument.html, /id="promo"[^>]+filter:\s*[^;]+\s*!important/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});

test('scroll-effect media is normalized to a deterministic neutral frame', async () => {
  const result = await captureHtml(`<!doctype html><section class="is-scroll-fx-active"><img id="parallax" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="transform:translateY(28px);translate:0 4px"></section>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  assert.equal(result.metadata.visualReadiness.normalizedScrollEffects, 1);
  assert.match(result.renderedDocument.html, /id="parallax"[^>]+transform:\s*none\s*!important/);
  assert.match(result.renderedDocument.html, /id="parallax"[^>]+translate:\s*none\s*!important/);
});

test('continuously moving commerce tracks are normalized before serialization and screenshot', async () => {
  const result = await captureHtml(`<!doctype html><style>html,body{margin:0}.ticker-rail__track{width:50px;height:50px;background:#ff0000;transform:translate3d(-120px,0,0)}</style><div class="ticker-rail__viewport"><div id="track" class="ticker-rail__track" data-ticker-track></div></div><script>setInterval(()=>{document.querySelector('#track').style.transform='translate3d(120px,0,0)'},10)</script>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 390, height: 844, mobile: true },
  });
  assert.equal(result.metadata.visualReadiness.normalizedMotionTracks, 1);
  const screenshot = PNG.sync.read(result.screenshot);
  const pixel = (10 * screenshot.width + 10) * 4;
  assert.deepEqual([...screenshot.data.subarray(pixel, pixel + 3)], [255, 0, 0]);
});

test('header visibility remains responsive when replayed at another desktop width', async () => {
  const html = `<!doctype html><style>.account{display:none}.announcement{display:block;height:42px}@media(min-width:600px){.account{display:inline}.announcement{display:none}}</style><header><div class="announcement">Sale</div><a class="account" href="/account">Account</a><button>Search</button></header>`;
  const result = await captureHtml(html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 390, height: 844, mobile: true },
  });
  assert.equal(result.metadata.visualReadiness.frozenHeaderActions, 0);
  assert.equal(result.metadata.visualReadiness.frozenHeaderNodes, 0);
  assert.doesNotMatch(result.renderedDocument.html, /class="(?:account|announcement)"[^>]+display:/);

  const replay = await captureHtml(result.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 900, height: 844, mobile: false },
    afterSettleExpression: `(() => {
      document.documentElement.setAttribute('data-account-display', getComputedStyle(document.querySelector('.account')).display);
      document.documentElement.setAttribute('data-announcement-display', getComputedStyle(document.querySelector('.announcement')).display);
      return true;
    })()`,
  });
  assert.match(replay.renderedDocument.html, /data-account-display="inline"/);
  assert.match(replay.renderedDocument.html, /data-announcement-display="none"/);
});

test('root scroll state keeps tall replays scrollable without reserving a scrollbar gutter', async () => {
  const result = await captureHtml('<!doctype html><html class="locked"><head><style>html.locked{overflow-y:hidden}body{margin:0}.tall{height:1200px}</style></head><body><main class="tall">Form</main></body></html>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  assert.equal(result.metadata.visualReadiness.frozenRootScrollNodes, 2);
  assert.match(result.renderedDocument.html, /<html[^>]+overflow:\s*[^;]*auto\s*!important/);
  assert.match(result.renderedDocument.html, /<html[^>]+scrollbar-width:\s*none\s*!important/);
  assert.match(result.renderedDocument.html, /<body[^>]+overflow:\s*visible\s*!important/);
});

test('short pages include delayed post-freeze content in both screenshot and replay', async () => {
  const source = await captureHtml(`<!doctype html><style>html,body{margin:0}.base{height:900px;background:#eee}.late{height:42px;background:#123}</style><main><div class="base"></div></main><script>
    const freezeObserver = new MutationObserver(() => {
      if (!document.querySelector('style[data-matbox-live-freeze]')) return;
      freezeObserver.disconnect();
      setTimeout(() => {
        const late = document.createElement('div');
        late.className = 'late';
        late.textContent = 'Late campaign';
        document.querySelector('main').append(late);
      }, 500);
    });
    freezeObserver.observe(document.documentElement, { childList: true, subtree: true });
  </script>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const replay = await captureHtml(source.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });

  assert.match(source.renderedDocument.html, /Late campaign/);
  assert.deepEqual(replay.screenshot, source.screenshot);
});
