import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { promoteVerifiedDirectory } from '../verified-promotion.mjs';

test('failed verification never replaces the last accepted directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-foundation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging');
  const acceptedDir = path.join(root, 'accepted');
  await fs.mkdir(stagingDir);
  await fs.mkdir(acceptedDir);
  await fs.writeFile(path.join(stagingDir, 'value.txt'), 'new');
  await fs.writeFile(path.join(acceptedDir, 'value.txt'), 'old');

  const result = await promoteVerifiedDirectory({
    stagingDir,
    acceptedDir,
    verification: { pass: false, failures: [{ type: 'visual-mismatch' }] },
  });

  assert.equal(result.promoted, false);
  assert.equal(await fs.readFile(path.join(acceptedDir, 'value.txt'), 'utf8'), 'old');
});

test('passed verification atomically promotes the staged directory', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-foundation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stagingDir = path.join(root, 'staging');
  const acceptedDir = path.join(root, 'accepted');
  await fs.mkdir(stagingDir);
  await fs.mkdir(acceptedDir);
  await fs.writeFile(path.join(stagingDir, 'value.txt'), 'new');
  await fs.writeFile(path.join(acceptedDir, 'value.txt'), 'old');

  const result = await promoteVerifiedDirectory({
    stagingDir,
    acceptedDir,
    verification: { pass: true, status: 'passed', failures: [] },
  });

  assert.equal(result.promoted, true);
  assert.equal(await fs.readFile(path.join(acceptedDir, 'value.txt'), 'utf8'), 'new');
});
