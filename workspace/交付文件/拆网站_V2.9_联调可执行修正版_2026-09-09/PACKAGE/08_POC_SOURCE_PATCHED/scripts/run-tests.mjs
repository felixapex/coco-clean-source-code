import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (entry.name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const files = (await walk(path.resolve('test'))).sort();
// Chromium integration tests share finite browser/process resources on Windows.
// Run files serially so request-interception timing is deterministic in the release gate.
const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
process.exit(run.status ?? 1);
