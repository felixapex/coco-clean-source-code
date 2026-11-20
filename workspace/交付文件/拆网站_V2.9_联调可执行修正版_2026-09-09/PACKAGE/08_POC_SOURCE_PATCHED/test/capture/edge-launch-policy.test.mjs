import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBrowserLaunchAllowed, capturePagePool } from '../../src/capture/chromium-capture.mjs';

test('local Microsoft Edge automation is blocked before browser launch', () => {
  assert.throws(
    () => assertBrowserLaunchAllowed('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'),
    /Local Microsoft Edge automation is disabled/,
  );
});

test('the Edge block does not reject an isolated non-Edge browser', () => {
  assert.doesNotThrow(() => assertBrowserLaunchAllowed('/opt/isolated-browser/chromium'));
});

test('an empty dynamic capture pool returns without resolving or launching a browser', async () => {
  assert.deepEqual(await capturePagePool([], {
    workerCount: 8,
    chromiumPath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  }), []);
});
