import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recoverResource } from '../scripts/lib/resource-recovery.mjs';

const valid = (buffer) => buffer.toString().startsWith('VALID:');

test('primary resource is retried before the recovery fails', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovery-primary-'));
  let calls = 0;
  const result = await recoverResource({
    primaryUrl: 'https://cdn.example.com/a.jpg',
    declaredCandidates: [],
    cacheDir,
    fetchResource: async () => {
      calls += 1;
      if (calls === 1) throw new Error('connection reset');
      return Buffer.from('VALID:image');
    },
    validateResource: valid,
  });
  assert.equal(result.pass, true);
  assert.equal(calls, 2);
  assert.equal(result.sourceUrl, 'https://cdn.example.com/a.jpg');
  assert.equal(result.attempts.length, 2);
});

test('only source-declared candidates may replace a failed primary resource', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovery-declared-'));
  const calls = [];
  const declared = 'https://cdn.example.com/a-1280.jpg';
  const result = await recoverResource({
    primaryUrl: 'https://cdn.example.com/a-2560.jpg',
    declaredCandidates: [declared],
    cacheDir,
    maxAttemptsPerCandidate: 1,
    fetchResource: async (url) => {
      calls.push(url);
      if (url === declared) return Buffer.from('VALID:declared');
      throw new Error('missing');
    },
    validateResource: valid,
  });
  assert.equal(result.pass, true);
  assert.equal(result.sourceUrl, declared);
  assert.deepEqual(calls, ['https://cdn.example.com/a-2560.jpg', declared]);
});

test('verified content-addressed cache is reused without downloading again', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovery-cache-'));
  let downloads = 0;
  const options = {
    primaryUrl: 'https://cdn.example.com/a.jpg',
    declaredCandidates: [],
    cacheDir,
    fetchResource: async () => {
      downloads += 1;
      return Buffer.from('VALID:cached');
    },
    validateResource: valid,
  };
  const first = await recoverResource(options);
  const second = await recoverResource(options);
  assert.equal(downloads, 1);
  assert.equal(first.cachePath, second.cachePath);
  assert.match(path.basename(first.cachePath), /^[a-f0-9]{64}\.bin$/);
});

test('concurrent duplicate recovery requests share one download', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovery-coalesce-'));
  let downloads = 0;
  const options = {
    primaryUrl: 'https://cdn.example.com/shared.jpg',
    declaredCandidates: [],
    cacheDir,
    fetchResource: async () => {
      downloads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Buffer.from('VALID:shared');
    },
    validateResource: valid,
  };
  const [left, right] = await Promise.all([recoverResource(options), recoverResource(options)]);
  assert.equal(downloads, 1);
  assert.equal(left.cachePath, right.cachePath);
});

test('invalid content is never cached and returns an explicit failure', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovery-invalid-'));
  const result = await recoverResource({
    primaryUrl: 'https://cdn.example.com/a.pdf',
    declaredCandidates: [],
    cacheDir,
    maxAttemptsPerCandidate: 1,
    fetchResource: async () => Buffer.from('<html>challenge</html>'),
    validateResource: valid,
  });
  assert.equal(result.pass, false);
  assert.match(result.failure.message, /validation failed/i);
  assert.equal((await fs.readdir(cacheDir)).filter((name) => name.endsWith('.bin')).length, 0);
});

test('undeclared guessed URLs are never attempted', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-recovery-no-guess-'));
  const calls = [];
  const result = await recoverResource({
    primaryUrl: 'https://cdn.example.com/a-2560.jpg',
    declaredCandidates: [],
    cacheDir,
    maxAttemptsPerCandidate: 1,
    fetchResource: async (url) => {
      calls.push(url);
      if (url.endsWith('a-1280.jpg')) return Buffer.from('VALID:guessed');
      throw new Error('missing');
    },
    validateResource: valid,
  });
  assert.equal(result.pass, false);
  assert.deepEqual(calls, ['https://cdn.example.com/a-2560.jpg']);
});
