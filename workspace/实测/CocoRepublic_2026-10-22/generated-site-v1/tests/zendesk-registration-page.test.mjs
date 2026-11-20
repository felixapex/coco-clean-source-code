import assert from 'node:assert/strict';
import test from 'node:test';

import { buildZendeskRegistrationPage } from '../scripts/lib/zendesk-registration-page.mjs';

test('buildZendeskRegistrationPage keeps the official auth shell and inserts the official registration fields', () => {
  const shell = `<!doctype html><html><head><base href="https://cocorepublichelp.zendesk.com/hc/en-us/signin"><title>Sign in to Coco Republic Australia</title><style>.official-shell{display:block}</style></head><body><main class="official-shell"><p>Old sign-in content</p></main></body></html>`;
  const html = buildZendeskRegistrationPage(shell, {
    brandName: 'Coco Republic Australia',
    locale: 'en-us',
    sourceUrl: 'https://cocorepublichelp.zendesk.com/auth/v3/register',
  });

  assert.match(html, /\.official-shell/);
  assert.doesNotMatch(html, /Old sign-in content/);
  assert.match(html, /<title>Sign up to Coco Republic Australia<\/title>/);
  assert.match(html, /<h1[^>]*>Sign up to Coco Republic Australia<\/h1>/);
  assert.match(html, /Fill out this form, and we'll send you a welcome email to verify your email address and sign in\./);
  assert.match(html, /Name\* \(required\)/);
  assert.match(html, /Email\*/);
  assert.match(html, /data-testid="registration-form"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>Sign up<\/button>/);
  assert.match(html, /href="\/hc\/en-us\/signin"[^>]*>Back to sign in<\/a>/);
  assert.match(html, /<base href="https:\/\/cocorepublichelp\.zendesk\.com\/auth\/v3\/register">/);
});

test('buildZendeskRegistrationPage rejects a shell without an official main element', () => {
  assert.throws(
    () => buildZendeskRegistrationPage('<html><body>No main</body></html>'),
    /official main element/i,
  );
});
