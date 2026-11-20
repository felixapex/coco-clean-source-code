import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { candidateBuildStamp } from '../scripts/lib/candidate-build-stamp.mjs';

test('candidate build stamp changes when a generated route changes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-candidate-stamp-'));
  await fs.mkdir(path.join(directory, 'replay'));
  await fs.writeFile(path.join(directory, 'app.js'), 'app-v1');
  await fs.writeFile(path.join(directory, 'replay', 'routes.json'), '{"/":"route-home.html"}');
  await fs.writeFile(path.join(directory, 'replay', 'route-home.html'), '<h1>One</h1>');
  const before = await candidateBuildStamp(directory);
  await fs.writeFile(path.join(directory, 'replay', 'route-home.html'), '<h1>Changed route</h1>');
  const after = await candidateBuildStamp(directory);
  assert.notEqual(before, after);
  assert.equal(after, await candidateBuildStamp(directory));
  await fs.rm(directory, { recursive: true, force: true });
});
