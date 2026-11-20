import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureHtmlWithAutoStates } from '../../src/capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../../src/pipeline/run-site-component-pipeline.mjs';
import { validateComponentIr } from '../../src/ir/component-ir.mjs';

const pages = {
  'https://data.example.com/': `<!doctype html><html><body>
    <nav><a href="/loading">Loading</a><a href="/empty">Empty</a><a href="/error">Error</a></nav>
    <table id="orders-table">
      <thead><tr><th id="sort-order" tabindex="0" aria-sort="none" onclick="this.setAttribute('aria-sort','ascending')">Order</th><th>Status</th></tr></thead>
      <tbody id="orders-body"><tr><td>#2</td><td><input id="select-order" type="checkbox" aria-label="Select order #2"></td></tr><tr><td>#1</td><td>Ready</td></tr></tbody>
    </table>
    <button id="next-page" aria-label="Next page" aria-controls="orders-table" onclick="document.getElementById('orders-body').innerHTML='<tr><td>#3</td><td>Ready</td></tr>'">Next</button>
  </body></html>`,
  'https://data.example.com/loading': `<!doctype html><html><body>
    <table id="orders-loading" aria-busy="true"><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody><tr><td colspan="2"><span role="status">Loading orders…</span></td></tr></tbody></table>
  </body></html>`,
  'https://data.example.com/empty': `<!doctype html><html><body>
    <table id="orders-empty"><caption><span role="status">No orders found</span></caption><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody></tbody></table>
  </body></html>`,
  'https://data.example.com/error': `<!doctype html><html><body>
    <table id="orders-error"><caption><span role="alert">Failed to load orders</span></caption><thead><tr><th>Order</th><th>Status</th></tr></thead><tbody></tbody></table>
  </body></html>`,
};

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('pipeline merges runtime data-table states and interaction behavior into one family', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-data-table-states-'));
  const captureFn = async (url) => {
    const html = pages[url];
    if (!html) throw new Error(`missing fixture: ${url}`);
    return captureHtmlWithAutoStates(html, {
      chromiumPath: '/usr/bin/chromium',
      timeoutMs: 15000,
      maxStateSteps: 20,
    });
  };

  const result = await runSiteComponentPipeline({
    startUrl: 'https://data.example.com/',
    captureFn,
    resolver,
    outputRoot: root,
    maxPages: 4,
    clusterThreshold: 0.65,
  });

  const validation = validateComponentIr(result.ir);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const family = result.ir.componentFamilies.find((item) => item.semanticRole === 'data-table');
  assert.ok(family);
  assert.equal(family.occurrenceCount, 4);
  for (const state of ['default','sorted','selected','paginated','loading','empty','error']) {
    assert.equal(family.states.includes(state), true, `missing family state ${state}`);
  }

  const instances = result.ir.componentInstances.filter((item) => item.familyId === family.id);
  assert.equal(instances.length, 4);
  assert.equal(instances.some((item) => item.state === 'loading'), true);
  assert.equal(instances.some((item) => item.state === 'empty'), true);
  assert.equal(instances.some((item) => item.state === 'error'), true);

  const interaction = result.ir.interactions.find((item) => item.componentFamilyId === family.id);
  assert.ok(interaction);
  const eventByState = Object.fromEntries(interaction.transitions.map((transition) => [transition.to, transition.event]));
  assert.equal(eventByState.sorted, 'sort');
  assert.equal(eventByState.selected, 'toggle-selection');
  assert.equal(eventByState.paginated, 'paginate');
  assert.equal(eventByState.loading, 'loading');
  assert.equal(eventByState.empty, 'empty');
  assert.equal(eventByState.error, 'error');
});
