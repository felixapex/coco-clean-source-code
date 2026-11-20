import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('visual demo repairs the generated React workspace and emits a bounded Codex repair request', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-repair-e2e-'));
  const run = spawnSync(process.execPath, [
    'src/cli/run-visual-fidelity-demo.mjs', '--out', out, '--target', '0.98',
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);

  const report = JSON.parse(await fs.readFile(path.join(out, 'visual-report.json'), 'utf8'));
  assert.equal(report.version, '0.8');
  assert.equal(report.autoRepairStatus, 'passed');
  assert.ok(report.autoRepairHistory.length >= 2);
  assert.ok(report.autoRepairHistory.at(-1).similarity > report.autoRepairHistory[0].similarity);
  assert.ok(report.autoRepairBestSimilarity >= 0.98);
  assert.equal(report.repairExecution.provider, 'local-deterministic-style');
  assert.equal(report.repairExecution.codexStatus, 'prepared-not-executed');

  const css = await fs.readFile(path.join(out, 'generated-react/src/component-styles.css'), 'utf8');
  assert.match(css, /background-color:/);
  const request = JSON.parse(await fs.readFile(path.join(out, 'codex-repair-request.json'), 'utf8'));
  assert.equal(request.mode, 'workspace-write-sandbox');
  assert.equal(request.networkAccess, 'disabled');
  assert.deepEqual(request.forbiddenScopes, ['component-ir', 'crawler', 'provider-adapters', 'deployment']);
  assert.match(request.prompt, /Target similarity: 0\.98/);
});
