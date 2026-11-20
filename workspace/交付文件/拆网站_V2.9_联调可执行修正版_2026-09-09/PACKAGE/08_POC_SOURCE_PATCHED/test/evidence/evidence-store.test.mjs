import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EvidenceStore } from '../../src/evidence/evidence-store.mjs';

test('EvidenceStore persists JSON and binary artifacts with sha256 manifest entries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'evidence-store-'));
  const store = new EvidenceStore(root);
  const capture = await store.createCapture('site-1', { sourceUrl: 'https://example.com/' });
  const jsonEntry = await capture.putJson('metadata', { title: 'Demo' });
  const bufferEntry = await capture.putBuffer('screenshot', Buffer.from([1,2,3,4]), 'png');
  const manifest = await capture.finalize();

  assert.match(jsonEntry.sha256, /^[a-f0-9]{64}$/);
  assert.match(bufferEntry.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.siteId, 'site-1');
  assert.equal(manifest.artifacts.length, 2);
  assert.equal(JSON.parse(await fs.readFile(jsonEntry.path, 'utf8')).title, 'Demo');
  assert.deepEqual(await fs.readFile(bufferEntry.path), Buffer.from([1,2,3,4]));
  const diskManifest = JSON.parse(await fs.readFile(path.join(capture.dir, 'manifest.json'), 'utf8'));
  assert.equal(diskManifest.artifacts.length, 2);
});
