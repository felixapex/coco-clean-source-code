import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { auditBuildCheckpointIntegrity } from '../scripts/lib/build-checkpoint-integrity.mjs';
import { writeBuildPageCheckpoint } from '../scripts/lib/build-resume.mjs';

test('checkpoint integrity audit accepts verified HTML and rejects later corruption', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-checkpoint-integrity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const replayFile = 'page.html';
  await writeBuildPageCheckpoint({
    outputDir: root,
    replayFile,
    sourceHtml: '<!doctype html><p>source</p>',
    outputHtml: '<!doctype html><p>output</p>',
  });

  const passed = await auditBuildCheckpointIntegrity({
    stageDir: root,
    replayFiles: [replayFile],
  });
  assert.equal(passed.pass, true);
  assert.equal(passed.replayFileCount, 1);
  assert.equal(passed.failureCount, 0);

  const sourceReplayDir = path.join(root, 'source');
  await fs.mkdir(sourceReplayDir, { recursive: true });
  await fs.writeFile(path.join(sourceReplayDir, replayFile), '<!doctype html><p>changed source</p>');
  const changedSource = await auditBuildCheckpointIntegrity({
    stageDir: root,
    sourceReplayDir,
    replayFiles: [replayFile],
  });
  assert.equal(changedSource.pass, false);
  assert.deepEqual(changedSource.failures.map((failure) => failure.type), [
    'checkpoint-source-hash-mismatch',
  ]);

  await fs.writeFile(path.join(root, 'replay', replayFile), Buffer.from('RIFFcorrupt'));
  const failed = await auditBuildCheckpointIntegrity({
    stageDir: root,
    replayFiles: [replayFile],
  });
  assert.equal(failed.pass, false);
  assert.equal(failed.failureCount, 2);
  assert.deepEqual(failed.failures.map((failure) => failure.type).sort(), [
    'checkpoint-output-hash-mismatch',
    'replay-not-html',
  ]);
});

test('checkpoint integrity audit reports missing and invalid checkpoints without throwing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-checkpoint-missing-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'replay'), { recursive: true });
  await fs.writeFile(path.join(root, 'replay', 'missing.html'), '<!doctype html>');
  await fs.mkdir(path.join(root, '.matbox-checkpoints', 'pages'), { recursive: true });
  await fs.writeFile(path.join(root, '.matbox-checkpoints', 'pages', `${encodeURIComponent('invalid.html')}.json`), 'not json');
  await fs.writeFile(path.join(root, 'replay', 'invalid.html'), '<!doctype html>');

  const report = await auditBuildCheckpointIntegrity({
    stageDir: root,
    replayFiles: ['missing.html', 'invalid.html'],
  });
  assert.equal(report.pass, false);
  assert.deepEqual(report.failures.map((failure) => failure.type).sort(), [
    'checkpoint-invalid',
    'checkpoint-missing',
  ]);
});
