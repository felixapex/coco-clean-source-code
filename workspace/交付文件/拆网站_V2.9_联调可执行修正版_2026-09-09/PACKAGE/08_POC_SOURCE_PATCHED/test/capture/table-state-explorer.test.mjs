import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtmlWithAutoStates } from '../../src/capture/chromium-capture.mjs';

const html = `<!doctype html><html><body>
  <table id="orders-table">
    <thead><tr>
      <th id="sort-order" tabindex="0" aria-sort="none" onclick="this.setAttribute('aria-sort','ascending')">Order</th>
      <th>Status</th>
    </tr></thead>
    <tbody id="orders-body">
      <tr><td>#2</td><td><input id="select-order-2" type="checkbox" aria-label="Select order #2"></td></tr>
      <tr><td>#1</td><td>Ready</td></tr>
    </tbody>
  </table>
  <nav id="pagination" aria-label="Pagination">
    <button id="next-page" aria-label="Next page" aria-controls="orders-table"
      onclick="document.getElementById('orders-body').innerHTML='<tr><td>#3</td><td>Ready</td></tr>'">Next</button>
  </nav>
</body></html>`;

test('state explorer detects table sorting, row selection, and pagination through observed changes', async () => {
  const capture = await captureHtmlWithAutoStates(html, {
    chromiumPath: '/usr/bin/chromium',
    timeoutMs: 15000,
    maxStateSteps: 20,
  });

  const changed = capture.stateCaptures.filter((state) => state.changed);
  const byState = new Map(changed.map((state) => [state.state, state]));

  assert.equal(byState.get('sorted')?.ownerCandidateId, 'orders-table');
  assert.equal(byState.get('sorted')?.event, 'sort');
  assert.equal(byState.get('sorted')?.after?.ariaSort, 'ascending');

  assert.equal(byState.get('selected')?.ownerCandidateId, 'orders-table');
  assert.equal(byState.get('selected')?.event, 'toggle-selection');
  assert.equal(byState.get('selected')?.after?.checked, true);

  assert.equal(byState.get('paginated')?.ownerCandidateId, 'orders-table');
  assert.equal(byState.get('paginated')?.event, 'paginate');
  assert.notEqual(byState.get('paginated')?.beforeReveal?.text, byState.get('paginated')?.afterReveal?.text);
});
