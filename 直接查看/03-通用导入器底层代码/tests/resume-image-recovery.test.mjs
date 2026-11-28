import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('image recovery resume dry-run exposes the bounded recovery sequence', async () => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/resume-image-recovery.mjs', '--dry-run'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, output }));
  });

  assert.equal(result.code, 0, result.output);
  const plan = JSON.parse(result.output);
  assert.deepEqual(plan.steps, [
    'compile-current-blockers',
    'recover-from-same-sku-product-pages',
    'retry-pending-network-images',
    'apply-newly-recovered-images',
    'remeasure-only-changed-pages',
    'recompile-blockers-and-problem-list',
    'publish-recovered-images-to-dist',
  ]);
  assert.equal(plan.chromium, 'C:/Program Files/Google/Chrome/Application/chrome.exe');
});
