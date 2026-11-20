import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFontCapture, summarizeStylesheetCapture } from '../../src/capture/chromium-capture.mjs';

test('stylesheet capture summary distinguishes captured, failed, and unseen resources', () => {
  const summary = summarizeStylesheetCapture(
    [
      'https://cdn.example/loaded.css',
      'https://cdn.example/failed.css',
      'https://cdn.example/unseen.css',
    ],
    [
      { url: 'https://cdn.example/loaded.css', completed: true, captured: true },
      { url: 'https://cdn.example/failed.css', completed: false, captured: false, failed: true, errorText: 'net::ERR_CONNECTION_RESET' },
    ],
  );

  assert.equal(summary.capturedStylesheets, 1);
  assert.equal(summary.failedStylesheets, 1);
  assert.equal(summary.uncapturedStylesheets, 2);
  assert.deepEqual(summary.failedStylesheetDetails, [
    { url: 'https://cdn.example/failed.css', errorText: 'net::ERR_CONNECTION_RESET' },
  ]);
  assert.deepEqual(summary.uncapturedStylesheetDetails.map((item) => item.url), [
    'https://cdn.example/failed.css',
    'https://cdn.example/unseen.css',
  ]);
});

test('stylesheet capture summary canonicalizes fragments and duplicate links', () => {
  const summary = summarizeStylesheetCapture(
    ['https://cdn.example/theme.css#v1', 'https://cdn.example/theme.css'],
    [{ url: 'https://cdn.example/theme.css', completed: true, captured: true }],
  );
  assert.equal(summary.stylesheetCount, 1);
  assert.equal(summary.capturedStylesheets, 1);
  assert.equal(summary.failedStylesheets, 0);
  assert.equal(summary.uncapturedStylesheets, 0);
});

test('a failed stylesheet request is healthy after its body is recovered', () => {
  const summary = summarizeStylesheetCapture(
    ['https://cdn.example/theme.css'],
    [{ url: 'https://cdn.example/theme.css', captured: true, failed: true, errorText: 'net::ERR_FAILED' }],
  );
  assert.equal(summary.capturedStylesheets, 1);
  assert.equal(summary.failedStylesheets, 0);
  assert.equal(summary.uncapturedStylesheets, 0);
});

test('a failed font request is healthy after its body is recovered', () => {
  const summary = summarizeFontCapture([
    { url: 'https://cdn.example/site.woff2', captured: true, failed: true, errorText: 'net::ERR_FAILED' },
  ]);
  assert.equal(summary.capturedFonts, 1);
  assert.equal(summary.failedFonts, 0);
  assert.equal(summary.uncapturedFonts, 0);
});
