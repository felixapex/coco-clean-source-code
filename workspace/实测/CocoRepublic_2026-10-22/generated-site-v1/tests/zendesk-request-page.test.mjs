import assert from 'node:assert/strict';
import test from 'node:test';

import { buildZendeskRequestPage } from '../scripts/lib/zendesk-request-page.mjs';

test('buildZendeskRequestPage keeps the official shell and inserts the verified email step', () => {
  const shell = `<!doctype html><html><head><title>Help</title></head><body>
    <header class="header"><a href="/hc/en-us">Official header</a></header>
    <main role="main"><p>Old home content</p></main>
    <footer class="footer"><a href="https://example.com">Official footer</a></footer>
  </body></html>`;

  const html = buildZendeskRequestPage(shell, {
    locale: 'en-us',
    sourceUrl: 'https://cocorepublichelp.zendesk.com/hc/en-us/requests/new',
  });

  assert.match(html, /Official header/);
  assert.match(html, /Official footer/);
  assert.doesNotMatch(html, /Old home content/);
  assert.match(html, /<h1[^>]*>Submit a request<\/h1>/);
  assert.match(html, /Please enter your email to submit a request/);
  assert.match(html, /type="email"/);
  assert.match(html, /Invalid Email/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Next<\/button>/);
  assert.match(html, /data-source-url="https:\/\/cocorepublichelp\.zendesk\.com\/hc\/en-us\/requests\/new"/);
});

test('buildZendeskRequestPage rejects a shell without an official main element', () => {
  assert.throws(
    () => buildZendeskRequestPage('<html><body>No main</body></html>'),
    /official main element/i,
  );
});
