import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureHtml } from '../../src/capture/chromium-capture.mjs';

const resolver = async (hostname) => {
  if (hostname === 'internal.example') return [{ address: '127.0.0.1', family: 4 }];
  return [{ address: '93.184.216.34', family: 4 }];
};

test('real Chromium request guard blocks a subresource whose hostname resolves to loopback', async () => {
  // Node's test-runner worker can suppress synthetic page subresource events on
  // Windows. Run the browser probe in a normal child process and assert the
  // real CDP interception result returned by production capture code.
  const probe = path.resolve('test/fixtures/request-guard-probe.mjs');
  const result = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const requestGuard = JSON.parse(result.stdout.trim());
  assert.ok(requestGuard);
  assert.ok(
    requestGuard.blocked.some((entry) => entry.url === 'https://internal.example/secret.png'),
    JSON.stringify(requestGuard),
  );
  assert.match(requestGuard.blocked.find((entry) => entry.url === 'https://internal.example/secret.png').reason, /127\.0\.0\.1/);
});


test('synthetic captureHtml keeps request guard off by default unless explicitly enabled', async () => {
  const html = `<!doctype html><html><body><img src="https://fake-fixture.example/image.png"></body></html>`;
  const capture = await captureHtml(html, {
    chromiumPath: '/usr/bin/chromium',
    timeoutMs: 5000,
    resolver: async () => { throw new Error('resolver must not run for default synthetic capture'); },
  });
  assert.equal(capture.requestGuard, undefined);
});
