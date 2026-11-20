import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCaptureBundle, readCaptureBundle } from '../../src/replay/capture-bundle.mjs';

test('capture bundle persists authorization, robots, and capture outcome audit metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-meta-'));
  await writeCaptureBundle({
    startUrl: 'https://example.com/',
    outputRoot: root,
    pages: [{ url: 'https://example.com/', capture: { metadata: {}, links: [], componentCandidates: [] } }],
    metadata: {
      authorization: { status: 'owned', attestedBy: 'owner', attestedAt: '2026-08-17T18:00:00Z' },
      robots: { policy: 'respect', fetched: true, url: 'https://example.com/robots.txt', sha256: 'abc' },
      captureOutcome: { attempted: 1, captured: 1, skipped: 0, errors: 0 },
    },
  });
  const bundle = await readCaptureBundle(root);
  assert.equal(bundle.manifest.metadata.authorization.status, 'owned');
  assert.equal(bundle.manifest.metadata.robots.policy, 'respect');
  assert.equal(bundle.manifest.metadata.captureOutcome.captured, 1);
});
