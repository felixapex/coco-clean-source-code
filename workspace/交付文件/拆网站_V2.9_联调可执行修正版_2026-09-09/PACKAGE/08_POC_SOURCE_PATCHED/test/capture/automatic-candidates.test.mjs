import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/chromium-capture.mjs';

const html = `<!doctype html><html><head><style>
body{font-family:Arial}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.product-card,.story-card{padding:16px;border-radius:8px}.compact{padding:10px}
</style></head><body>
<nav><a href="/search">Search</a><a href="https://outside.example/">Outside</a></nav>
<form role="search"><input type="search" placeholder="Search products"><button>Search</button></form>
<div class="grid">
  <article class="product-card" id="oak"><img src="oak.jpg"><h2>Oak Chair</h2><p>$199</p><button>Favorite</button></article>
  <article class="product-card compact" id="walnut"><img src="walnut.jpg"><h2>Walnut Chair</h2><p>$249</p><button>Saved</button></article>
</div>
<article class="story-card" id="story"><h2>How oak ages</h2><p>Material guide</p><a href="/stories/oak">Read</a></article>
</body></html>`;

test('captureHtml discovers semantic component candidates without data-component annotations', async () => {
  const capture = await captureHtml(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  assert.ok(Array.isArray(capture.componentCandidates));
  assert.equal(capture.componentCandidates.some((c) => c.componentName === 'ProductCard'), true);
  assert.equal(capture.componentCandidates.filter((c) => c.semanticRole === 'product-card').length, 2);
  assert.equal(capture.componentCandidates.some((c) => c.semanticRole === 'content-card'), true);
  assert.equal(capture.componentCandidates.some((c) => c.semanticRole === 'search-form'), true);
  const oak = capture.componentCandidates.find((c) => c.id === 'oak');
  assert.equal(oak.content.title, 'Oak Chair');
  assert.equal(oak.content.price, '$199');
  assert.deepEqual(oak.content.actionLabels, ['Favorite']);
  assert.equal(oak.content.media, 'oak.jpg');
  assert.equal(capture.links.some((href) => href.endsWith('/search')), true);
  assert.equal(capture.componentCandidates.every((c) => !('dataset' in c)), true);
});
