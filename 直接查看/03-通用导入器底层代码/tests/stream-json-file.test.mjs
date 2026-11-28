import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeJsonObjectFromJsonLineArrays, writeJsonObjectStreaming } from '../scripts/lib/stream-json-file.mjs';

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

test('JSON-line array writer assembles large arrays without loading them into one value', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-jsonl-object-'));
  const pagesPath = path.join(directory, 'pages.jsonl');
  const componentsPath = path.join(directory, 'components.jsonl');
  const outputPath = path.join(directory, 'foundation.json');
  await fs.writeFile(pagesPath, '{"route":"/"}\n{"route":"/about"}\n', 'utf8');
  await fs.writeFile(componentsPath, '{"id":"one"}\n{"id":"two"}\n', 'utf8');

  const report = await writeJsonObjectFromJsonLineArrays(outputPath, {
    schemaVersion: 1,
    pages: { jsonlPath: pagesPath },
    componentLibrary: { jsonlPath: componentsPath },
    verification: { pass: false },
  }, { jsonLineArrayKeys: ['pages', 'componentLibrary'] });

  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, 'utf8')), {
    schemaVersion: 1,
    pages: [{ route: '/' }, { route: '/about' }],
    componentLibrary: [{ id: 'one' }, { id: 'two' }],
    verification: { pass: false },
  });
  assert.equal(report.streamedItemCount, 4);
  assert.ok(report.peakSerializedItemBytes < 100);
});
