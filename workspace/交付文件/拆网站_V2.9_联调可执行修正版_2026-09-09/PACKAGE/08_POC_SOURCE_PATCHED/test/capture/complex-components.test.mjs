import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml, captureHtmlWithAutoStates } from '../../src/capture/chromium-capture.mjs';

const html = `<!doctype html><html><head><style>
body{font-family:Arial;margin:0}.topnav{display:flex;gap:16px;padding:12px}.filters{padding:16px}.menu{display:none}.menu[data-open="true"]{display:block}
.table-wrap{padding:16px}.modal{padding:20px}.toolbar{display:flex;gap:8px}.dropdown{padding:8px;border:1px solid #ddd}
</style></head><body>
<nav id="main-nav" class="topnav" aria-label="Primary">
  <a href="/products">Products</a>
  <div id="account-dropdown" class="dropdown">
    <button id="account-toggle" aria-expanded="false" aria-controls="account-menu" aria-haspopup="menu" onclick="const m=document.getElementById('account-menu'); const open=this.getAttribute('aria-expanded')==='true'; this.setAttribute('aria-expanded', String(!open)); m.dataset.open=String(!open)">Account</button>
    <div id="account-menu" role="menu" class="menu" data-open="false"><a role="menuitem" href="/profile">Profile</a></div>
  </div>
</nav>
<section id="catalog-filters" class="filters" aria-label="Product filters">
  <h2>Filters</h2>
  <label>Material <select id="material"><option>Oak</option><option>Walnut</option></select></label>
  <button id="more-filters" aria-expanded="false" aria-controls="advanced" onclick="const p=document.getElementById('advanced'); const open=this.getAttribute('aria-expanded')==='true'; this.setAttribute('aria-expanded', String(!open)); p.hidden=open">More filters</button>
  <div id="advanced" hidden><label><input type="checkbox"> In stock</label></div>
</section>
<div id="table-region" class="table-wrap">
  <table id="orders-table"><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody>
    <tr><td>#1001</td><td>Ready</td></tr><tr><td>#1002</td><td>Shipped</td></tr>
  </tbody></table>
</div>
<button id="open-modal" aria-haspopup="dialog" aria-controls="details-modal" onclick="document.getElementById('details-modal').showModal()">Details</button>
<dialog id="details-modal" class="modal"><h2>Order details</h2><button id="close-modal" onclick="this.closest('dialog').close()">Close</button></dialog>
</body></html>`;

test('captureHtml detects navigation, filter, dropdown and table with hierarchy but not table rows as content cards', async () => {
  const capture = await captureHtml(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const byRole = new Map(capture.componentCandidates.map((candidate) => [candidate.semanticRole, candidate]));

  assert.ok(byRole.has('navigation'));
  assert.ok(byRole.has('filter-panel'));
  assert.ok(byRole.has('dropdown'));
  assert.ok(byRole.has('data-table'));

  const navigation = byRole.get('navigation');
  const dropdown = byRole.get('dropdown');
  const table = byRole.get('data-table');
  assert.equal(dropdown.parentCandidateId, navigation.id);
  assert.equal(navigation.childCandidateIds.includes(dropdown.id), true);
  assert.deepEqual(table.content.columns, ['Order', 'Status']);
  assert.equal(table.content.rowCount, 2);
  assert.equal(navigation.content.rowCount, null);
  assert.equal(dropdown.content.rowCount, null);
  assert.equal(capture.componentCandidates.filter((candidate) => candidate.semanticRole === 'content-card').length, 0);
});

test('captureHtmlWithAutoStates explores expanded dropdown/filter and opens a controlled modal trigger', async () => {
  const result = await captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 16 });
  const changed = result.stateCaptures.filter((state) => state.changed);

  assert.equal(changed.some((state) => state.ownerCandidateId === 'account-dropdown' && state.state === 'expanded'), true);
  assert.equal(changed.some((state) => state.ownerCandidateId === 'catalog-filters' && state.state === 'expanded'), true);
  assert.equal(changed.some((state) => state.state === 'open' && state.revealedCandidateIds?.includes('details-modal')), true);
});
