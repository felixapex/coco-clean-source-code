import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureHtmlWithAutoStates } from '../../src/capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../../src/pipeline/run-site-component-pipeline.mjs';
import { validateComponentIr } from '../../src/ir/component-ir.mjs';

const pages = {
  'https://app.example.com/': `<!doctype html><html><body>
    <nav id="main-nav" aria-label="Primary"><a href="/orders">Orders</a><div id="account-dropdown"><button id="account-toggle" aria-haspopup="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded')==='true'?'false':'true')">Account</button></div></nav>
    <section id="catalog-filters" aria-label="Product filters"><h2>Filters</h2><select id="material"><option>Oak</option><option>Walnut</option></select><button id="more-filters" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true')">More</button></section>
    <table id="orders-table"><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody><tr><td>#1</td><td>Ready</td></tr><tr><td>#2</td><td>Shipped</td></tr></tbody></table>
    <button id="open-modal" aria-haspopup="dialog" aria-controls="details-modal" onclick="document.getElementById('details-modal').showModal()">Details</button>
    <dialog id="details-modal"><h2>Order details</h2><button onclick="this.closest('dialog').close()">Close</button></dialog>
  </body></html>`,
  'https://app.example.com/orders': `<!doctype html><html><body>
    <nav id="main-nav-orders" aria-label="Primary"><a href="/">Home</a><div id="account-dropdown-orders"><button id="account-toggle-orders" aria-haspopup="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded')==='true'?'false':'true')">Account</button></div></nav>
    <section id="order-filters" aria-label="Order filters"><h2>Filters</h2><select id="status"><option>Ready</option><option>Shipped</option></select></section>
  </body></html>`,
};

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('complex pipeline preserves nested component hierarchy and includes state-revealed modal in IR', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-complex-pipeline-'));
  const captureFn = async (url) => {
    const html = pages[url];
    if (!html) throw new Error(`missing fixture: ${url}`);
    return captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 20 });
  };

  const result = await runSiteComponentPipeline({
    startUrl: 'https://app.example.com/',
    captureFn,
    resolver,
    outputRoot: root,
    maxPages: 2,
    clusterThreshold: 0.72,
  });

  const validation = validateComponentIr(result.ir);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const family = (role) => result.ir.componentFamilies.find((item) => item.semanticRole === role);
  assert.ok(family('navigation'));
  assert.ok(family('dropdown'));
  assert.ok(family('filter-panel'));
  assert.ok(family('data-table'));
  assert.ok(family('modal'));
  assert.equal(family('navigation').occurrenceCount, 2);
  assert.equal(family('dropdown').occurrenceCount, 2);
  assert.deepEqual(family('data-table').propsSchema.columns, { type: 'string[]', required: true });
  assert.deepEqual(family('data-table').propsSchema.rowCount, { type: 'number', required: true });
  assert.equal(family('modal').states.includes('open'), true);

  const navFamilyId = family('navigation').id;
  const dropdownFamilyId = family('dropdown').id;
  const navInstances = result.ir.componentInstances.filter((item) => item.familyId === navFamilyId);
  const dropdownInstances = result.ir.componentInstances.filter((item) => item.familyId === dropdownFamilyId);
  assert.equal(navInstances.length, 2);
  assert.equal(dropdownInstances.length, 2);
  for (const dropdown of dropdownInstances) {
    const parent = result.ir.componentInstances.find((item) => item.id === dropdown.parentInstanceId);
    assert.ok(parent, `missing parent for ${dropdown.id}`);
    assert.equal(parent.familyId, navFamilyId);
    assert.equal(parent.childInstanceIds.includes(dropdown.id), true);
  }

  const modalInstance = result.ir.componentInstances.find((item) => item.familyId === family('modal').id);
  assert.ok(modalInstance);
  assert.equal(modalInstance.availableStates.includes('open'), true);
  assert.equal(modalInstance.discoveredInState, 'open');
});
