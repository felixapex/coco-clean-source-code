import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtmlWithAutoStates } from '../../src/capture/chromium-capture.mjs';

const html = `<!doctype html><html><head><style>
body{font-family:Arial}.card{padding:16px;background:rgb(255,255,255)}.card:hover{background:rgb(238,244,255)}
input:focus{outline:3px solid rgb(255,0,0)}
</style></head><body>
<article class="card" id="card"><h2>Oak Chair</h2><p>$199</p>
  <button id="favorite" aria-pressed="false" onclick="this.setAttribute('aria-pressed', this.getAttribute('aria-pressed') === 'true' ? 'false' : 'true')">Favorite</button>
</article>
<form id="search-form" role="search"><input id="query" type="search" placeholder="Search products"><button>Search</button><button type="button" id="filters" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true')">Filters</button></form>
<button id="unsafe-button">Delete account</button>
</body></html>`;

test('captureHtmlWithAutoStates records only safe observable hover/focus/pressed state changes', async () => {
  const result = await captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 8 });
  assert.equal(result.base.componentCandidates.some((c) => c.id === 'card'), true);
  const changed = result.stateCaptures.filter((state) => state.changed);
  assert.equal(changed.some((s) => s.ownerCandidateId === 'card' && s.state === 'hover'), true);
  assert.equal(changed.some((s) => s.ownerCandidateId === 'card' && s.state === 'selected'), true);
  assert.equal(changed.some((s) => s.ownerCandidateId === 'search-form' && s.state === 'focus'), true);
  assert.equal(changed.some((s) => s.ownerCandidateId === 'search-form' && s.state === 'expanded'), true);
  assert.equal(result.stateCaptures.some((s) => s.targetId === 'unsafe-button'), false);
  const selected = changed.find((s) => s.state === 'selected');
  assert.equal(selected.after.ariaPressed, 'true');
});
