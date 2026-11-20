import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeJsonObjectStreaming } from '../scripts/lib/stream-json-file.mjs';

test('large top-level arrays are written incrementally without changing JSON data', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-stream-json-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'foundation.json');
  const value = {
    schemaVersion: 1,
    pages: Array.from({ length: 12 }, (_, index) => ({ index, text: `page-${index}` })),
    componentLibrary: Array.from({ length: 17 }, (_, index) => ({ id: `component-${index}` })),
    verification: { pass: false },
  };

  const report = await writeJsonObjectStreaming(filePath, value, {
    streamedArrayKeys: ['pages', 'componentLibrary'],
  });

  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), value);
  assert.equal(report.streamedItemCount, 29);
  assert.ok(report.peakSerializedItemBytes < report.bytesWritten);
});

test('streaming writer rejects a missing streamed array instead of silently corrupting output', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-stream-json-'));
  await assert.rejects(
    writeJsonObjectStreaming(path.join(directory, 'bad.json'), { pages: {} }, { streamedArrayKeys: ['pages'] }),
    /pages must be an array/,
  );
  await fs.rm(directory, { recursive: true, force: true });
});
