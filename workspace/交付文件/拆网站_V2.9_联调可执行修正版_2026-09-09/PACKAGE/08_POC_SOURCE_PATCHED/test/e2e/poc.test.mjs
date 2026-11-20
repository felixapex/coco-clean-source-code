import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fixtureHtml } from '../fixtures/site.mjs';
import { runControlledPoc } from '../../src/poc/run-controlled-poc.mjs';
import { validateComponentIr } from '../../src/ir/component-ir.mjs';

test('controlled PoC captures evidence, clusters ProductCard variants, writes valid IR and benchmark report', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-poc-e2e-'));
  const result = await runControlledPoc({ html: fixtureHtml, outputRoot: root, chromiumPath: '/usr/bin/chromium' });

  const validation = validateComponentIr(result.ir);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(result.ir.componentFamilies.length, 1);
  assert.equal(result.ir.componentInstances.length, 2);
  assert.deepEqual(new Set(result.ir.componentFamilies[0].variants), new Set(['default','compact']));
  assert.equal(result.benchmark.f1, 1);
  assert.ok(result.manifest.artifacts.some((a) => a.type === 'screenshot'));
  assert.ok(result.manifest.artifacts.some((a) => a.type === 'component-ir'));
  assert.ok(result.manifest.artifacts.some((a) => a.type === 'benchmark'));
  assert.ok(result.captureDir.startsWith(root));
});
