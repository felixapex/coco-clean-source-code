import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatedStaticTargetExists } from '../scripts/lib/static-target-gate.mjs';

test('local document target passes only when the file exists inside the generated site', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-static-target-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'content'));
  await fs.writeFile(path.join(root, 'content', 'report.pdf'), 'local report');

  assert.equal(await generatedStaticTargetExists(root, '/content/report.pdf'), true);
  assert.equal(await generatedStaticTargetExists(root, '/content/missing.pdf'), false);
  assert.equal(await generatedStaticTargetExists(root, '/../outside.pdf'), false);
  assert.equal(await generatedStaticTargetExists(root, '/content/'), false);
});
