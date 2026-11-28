import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as pipelineBudget from '../scripts/lib/pipeline-budget.mjs';

const { evaluatePipelineBudget, resolveWorkerCount, resolveOriginWorkerCount, resolveAuditWorkerCount, resolveResumeMode } = pipelineBudget;

test('twenty minutes is a measured target and never a release failure', () => {
  assert.deepEqual(evaluatePipelineBudget(20 * 60 * 1000), {
    pass: true,
    enforced: false,
    targetMet: true,
    elapsedMs: 20 * 60 * 1000,
    budgetMs: 20 * 60 * 1000,
    overrunMs: 0,
  });
  const overTarget = evaluatePipelineBudget(20 * 60 * 1000 + 1);
  assert.equal(overTarget.pass, true);
  assert.equal(overTarget.enforced, false);
  assert.equal(overTarget.targetMet, false);
  assert.equal(overTarget.overrunMs, 1);
});

test('the pipeline records target overruns without killing stages or failing release', async () => {
  const source = await fs.readFile(new URL('../scripts/run-20-minute-pipeline.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /20-minute budget (?:exhausted|exceeded)/);
  assert.doesNotMatch(source, /setTimeout\([\s\S]*?child\.kill\('SIGTERM'\)/);
  assert.match(source, /if \(failure\) process\.exitCode = 2/);
});

test('capture and fidelity reports record the target without using it as a quality gate', async () => {
  const [capture, fidelity] = await Promise.all([
    fs.readFile(new URL('../scripts/capture-rendered-golden.mjs', import.meta.url), 'utf8'),
    fs.readFile(new URL('../scripts/audit-full-site-fidelity.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(capture, /budget,/);
  assert.match(fidelity, /budget,/);
  assert.doesNotMatch(capture, /budget\.pass/);
  assert.doesNotMatch(fidelity, /budget\.pass/);
});

test('worker count defaults to eight and remains safely bounded', () => {
  assert.equal(resolveWorkerCount(undefined), 8);
  assert.equal(resolveWorkerCount('1'), 1);
  assert.equal(resolveWorkerCount('99'), 12);
});

test('remote-origin capture caps large inventories at the measured stable concurrency', () => {
  assert.equal(resolveOriginWorkerCount(undefined, 8, 75), 4);
  assert.equal(resolveOriginWorkerCount(undefined, 8, 164), 6);
  assert.equal(resolveOriginWorkerCount('2', 8), 2);
  assert.equal(resolveOriginWorkerCount('12', 8), 8);
  assert.equal(resolveOriginWorkerCount('8', 3), 3);
});

test('final fidelity audit can use a lower stable concurrency than origin capture', () => {
  assert.equal(resolveAuditWorkerCount(undefined, 8), 4);
  assert.equal(resolveAuditWorkerCount('2', 8), 2);
  assert.equal(resolveAuditWorkerCount('12', 8), 8);
});

test('explicit zero disables capture resume while the default remains enabled', () => {
  assert.equal(typeof resolveResumeMode, 'function');
  assert.equal(resolveResumeMode(undefined), '1');
  assert.equal(resolveResumeMode('1'), '1');
  assert.equal(resolveResumeMode('0'), '0');
});

test('pipeline launches Node-owned stages without Windows cmd shims', async () => {
  const source = await fs.readFile(new URL('../scripts/run-20-minute-pipeline.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /npm\.cmd/);
  assert.match(source, /desktop-rendered-golden-capture/);
  assert.match(source, /capture-rendered-golden\.mjs', '--viewport=desktop/);
  assert.doesNotMatch(source, /combined-rendered-golden-capture/);
  assert.doesNotMatch(source, /mobile-rendered-golden-capture/);
  assert.match(source, /MATBOX_WORKERS:\s*String\(originWorkerCount\)/);
  assert.match(source, /MATBOX_RESUME:\s*resumeMode/);
  assert.match(source, /MATBOX_WORKERS:\s*String\(auditWorkerCount\)/);
  assert.match(source, /runStage\('build', process\.execPath, \['scripts\/build\.mjs'\]\)/);
  assert.match(source, /audit-full-site-fidelity\.mjs', '--viewport=desktop/);
  assert.match(source, /runStage\('source-local-interaction-parity', process\.execPath, \['scripts\/audit-source-local-interactions\.mjs'\]/);
  assert.match(source, /runStage\('responsive-layout-gate', process\.execPath, \['scripts\/audit-responsive-layout\.mjs'\]/);
  assert.match(source, /runStage\('all-control-click-gate', process\.execPath, \['scripts\/audit-all-interactions\.mjs'\]/);
  assert.match(source, /MATBOX_LOCAL_ORIGIN:\s*localOrigin/);
  assert.match(source, /'tests\/\*\.test\.mjs'/);
  assert.match(source, /'--test-concurrency=2'/);
  assert.doesNotMatch(source, /'--test-force-exit'/);
  assert.doesNotMatch(source, /'--test-concurrency=1'/);
  assert.match(source, /spawn\(process\.execPath, \['scripts\/serve\.mjs'\]/);
  assert.match(source, /writeReport\(failure\s*\?\s*'failed'\s*:\s*'passed'/);
  assert.match(source, /20-minute-pipeline\.json/);
});

test('pipeline isolates its validation server from stale preview processes', async () => {
  const source = await fs.readFile(new URL('../scripts/run-20-minute-pipeline.mjs', import.meta.url), 'utf8');
  assert.match(source, /findAvailablePort/);
  assert.match(source, /MATBOX_LOCAL_ORIGIN/);
  assert.match(source, /PORT:\s*String\(validationPort\)/);
  assert.doesNotMatch(source, /fetch\('http:\/\/127\.0\.0\.1:4173\/'\)/);
});

test('transient capture failures are retried within a strict attempt limit', async () => {
  assert.equal(typeof pipelineBudget.retryTransient, 'function');
  let attempts = 0;
  const result = await pipelineBudget.retryTransient(async () => {
    attempts += 1;
    if (attempts < 2) throw new Error('temporary');
    return 'captured';
  }, { attempts: 2, delayMs: 0 });
  assert.equal(result, 'captured');
  assert.equal(attempts, 2);
  await assert.rejects(() => pipelineBudget.retryTransient(async () => { throw new Error('persistent'); }, { attempts: 2, delayMs: 0 }), /persistent/);
});
