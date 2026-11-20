import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/chromium-capture.mjs';

function tableCandidate(capture) {
  return capture.componentCandidates.find((candidate) => candidate.semanticRole === 'data-table');
}

async function capture(body) {
  return captureHtml(`<!doctype html><html><body>${body}</body></html>`, {
    chromiumPath: '/usr/bin/chromium',
    timeoutMs: 15000,
  });
}

test('data table infers loading from aria-busy and loading status', async () => {
  const result = await capture(`
    <table id="orders" aria-busy="true">
      <thead><tr><th>Order</th></tr></thead>
      <tbody><tr><td><span role="status">Loading orders…</span></td></tr></tbody>
    </table>
  `);
  assert.deepEqual(tableCandidate(result).detectedStates, ['loading']);
});

test('data table infers empty when there are no data rows and an empty-state status', async () => {
  const result = await capture(`
    <table id="orders">
      <thead><tr><th>Order</th></tr></thead>
      <tbody></tbody>
      <caption><span role="status">No orders found</span></caption>
    </table>
  `);
  assert.deepEqual(tableCandidate(result).detectedStates, ['empty']);
});

test('data table infers error from an alert without requiring answer labels', async () => {
  const result = await capture(`
    <table id="orders">
      <thead><tr><th>Order</th></tr></thead>
      <tbody></tbody>
      <caption><span role="alert">Failed to load orders</span></caption>
    </table>
  `);
  assert.deepEqual(tableCandidate(result).detectedStates, ['error']);
});
