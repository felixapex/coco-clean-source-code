import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  executeInteractionPlan,
  interactionLoadPhases,
  interactionRunPlan,
  resolveInteractionWorkerCount,
  selectInteractionControls,
  interactionControlPreparationScrollY,
  interactionControlPreparationScrollCandidates,
} from '../scripts/lib/interaction-parity.mjs';

test('a lazy-mounted control is prepared near its captured document position', () => {
  assert.equal(interactionControlPreparationScrollY({ documentY: 2400 }, 1000), 1900);
  assert.equal(interactionControlPreparationScrollY({ documentY: 200 }, 1000), 0);
  assert.equal(interactionControlPreparationScrollY({}, 1000), 0);
});

test('a shifted lazy control gets captured, proportional, and page-end fallback positions', () => {
  assert.deepEqual(
    interactionControlPreparationScrollCandidates(
      { documentY: 2400, documentHeight: 4000 },
      1000,
      6000,
    ),
    [1900, 3100, 5000],
  );
});

test('clean control resets skip screenshot-grade stabilization but retain load and content readiness', () => {
  assert.deepEqual(interactionLoadPhases('inventory'), ['page-load', 'page-stabilize', 'content-ready']);
  assert.deepEqual(interactionLoadPhases('control-reset'), ['page-load', 'content-ready']);
});

test('external website parity is forced to one browser while other importer lanes keep their own setting', () => {
  assert.equal(resolveInteractionWorkerCount({ platform: 'external', configured: 8 }), 1);
  assert.equal(resolveInteractionWorkerCount({ platform: 'shopify', configured: 4 }), 4);
  assert.equal(resolveInteractionWorkerCount({ platform: 'wix', configured: 3 }), 3);
});

test('every visible control occurrence gets its own clean-page execution', () => {
  const controls = [
    { fingerprint: 'menu', occurrence: 0 },
    { fingerprint: 'menu', occurrence: 1 },
    { fingerprint: 'sign-in', occurrence: 0 },
  ];

  const plan = interactionRunPlan({ route: '/dining/', controls });

  assert.deepEqual(plan, [
    { route: '/dining/', fingerprint: 'menu', occurrence: 0, resetBefore: true },
    { route: '/dining/', fingerprint: 'menu', occurrence: 1, resetBefore: true },
    { route: '/dining/', fingerprint: 'sign-in', occurrence: 0, resetBefore: true },
  ]);
});

test('the clean-page execution plan never deduplicates duplicate-looking controls', () => {
  const controls = [
    { fingerprint: 'same', occurrence: 0 },
    { fingerprint: 'same', occurrence: 1 },
  ];

  const plan = interactionRunPlan({ route: '/', controls });

  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((item) => item.occurrence), [0, 1]);
  assert.ok(plan.every((item) => item.resetBefore));
});

test('the source/local interaction runner supports independent desktop and mobile evidence', async () => {
  const source = await fs.readFile(path.resolve(import.meta.dirname, '..', 'scripts', 'audit-source-local-interactions.mjs'), 'utf8');
  assert.match(source, /--viewport=/);
  assert.match(source, /mobile:\s*\{\s*width:\s*390,[\s\S]*?mobile:\s*true/);
  assert.match(source, /Emulation\.setDeviceMetricsOverride', auditViewport/);
  assert.match(source, /searchParams\.set\('matbox-viewport', 'mobile'\)/);
  assert.match(source, /source-local-interaction-parity-targeted-\$\{selectedViewport\}\.json/);
});

test('the source/local interaction runner uses trusted browser clicks for stateful controls', async () => {
  const source = await fs.readFile(path.resolve(import.meta.dirname, '..', 'scripts', 'audit-source-local-interactions.mjs'), 'utf8');
  assert.match(source, /Input\.dispatchMouseEvent/);
  assert.match(source, /trustedClickPreparationExpression/);
  assert.match(source, /trustedClickResultExpression/);
  assert.match(source, /elementFromPoint/);
  assert.match(source, /control-obstructed/);
  assert.match(source, /closeDelayedPopupExpression/);
  assert.match(source, /window\.__matboxInteractionAudit = true/);
  assert.match(source, /window\.__matboxUseTrustedClick = true/);
  assert.match(source, /Page\.frameNavigated/);
  assert.match(source, /Page\.navigatedWithinDocument/);
  assert.match(source, /waitForNewPageTarget/);
  assert.match(source, /\/json\/list/);
  assert.match(source, /\/json\/close\//);
  assert.match(source, /waitForNavigationSignal/);
  assert.match(source, /calendly-overlay/);
  assert.match(source, /custom-cart/);
  assert.match(source, /calendlyBound/);
  assert.match(source, /syntheticInteractionContract/);
  assert.match(source, /MATBOX_CONTROL_TIMEOUT_MS \|\| 15000/);
  assert.match(source, /completed % 10 === 0/);
  assert.match(source, /replacePageTarget/);
  assert.match(source, /restartChromeSession/);
  assert.match(source, /MATBOX_CONTROLS_PER_BROWSER \|\| 12/);
  assert.match(source, /controlsExecutedInBrowser >= controlsPerBrowser/);
  assert.match(source, /isInfrastructureFailure/);
  assert.match(source, /const sourceAudit = await auditUrl[\s\S]*await restartChromeSession\(\);[\s\S]*const localAudit = await auditUrl/);
  assert.match(source, /stale-interaction-run/);
  assert.match(source, /onTimeout:[\s\S]*replacePageTarget\(\)/);
  assert.match(source, /!timedOut/);
  assert.match(source, /liveControls = enrichControls\(liveInventory\.controls\)/);
  assert.match(source, /control-missing-after-reset/);
  assert.match(source, /target: prepared\.target(?: \|\| null)?, blocker: prepared\.blocker(?: \|\| null)?/);
  assert.match(source, /result\?\.error === 'trusted-click-state-missing'/);
  assert.match(source, /currentUrl !== beforeUrl[\s\S]*effectType: 'navigation'/);
  assert.match(source, /isTrivialHashNavigation/);
  assert.match(source, /interactionRedirects/);
  assert.match(source, /const candidatePoints =/);
  assert.match(source, /find\(\(\{ hit \}\) => hit && \(hit === node \|\| node\.contains\(hit\)\)\)/);
  assert.match(source, /const alreadyInViewport = initialRect\.bottom > 0/);
  assert.match(source, /if \(!alreadyInViewport\) node\.scrollIntoView/);
  assert.match(source, /const activeSurface =/);
  assert.match(source, /!activeSurface \|\| activeSurface\.contains\(node\)/);
  const captureStateSource = await fs.readFile(path.resolve(import.meta.dirname, '..', 'scripts', 'lib', 'capture-state.mjs'), 'utf8');
  assert.match(captureStateSource, /if \(interactionAudit\)[\s\S]*interactionAuditScrollSweep/);
  assert.match(captureStateSource, /scrollTo\(0, 0\);[\s\S]*interactionAuditScrollSweep/);
  assert.match(captureStateSource, /interactionAuditStableControlCount/);
  assert.match(captureStateSource, /for \(let pass = 0; pass < 4; pass \+= 1\)/);
});

test('one timed-out control is recorded and later controls still execute', async () => {
  const progress = [];
  const recoveries = [];
  let recovered = false;
  const results = await executeInteractionPlan({
    runs: [{ fingerprint: 'slow' }, { fingerprint: 'next' }],
    timeoutMs: 15,
    executeRun: async (run) => {
      if (run.fingerprint === 'slow') await new Promise((resolve) => setTimeout(resolve, 50));
      if (run.fingerprint === 'next' && !recovered) throw new Error('next-run-started-before-recovery');
      return run.fingerprint;
    },
    onResult: async (event) => {
      if (!event.ok) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        recovered = true;
        recoveries.push(event.run.fingerprint);
      }
    },
    onProgress: (event) => progress.push(event),
  });
  assert.equal(results[0].ok, false);
  assert.match(results[0].error, /control-timeout/);
  assert.deepEqual(results[1], { run: { fingerprint: 'next' }, ok: true, value: 'next' });
  assert.deepEqual(progress.map((item) => [item.completed, item.total, item.ok]), [[1, 2, false], [2, 2, true]]);
  assert.deepEqual(recoveries, ['slow']);
});

test('a timed-out click is cancelled and settled before the next click starts', async () => {
  let active = 0;
  let peakActive = 0;
  let timeoutRecoveries = 0;

  await executeInteractionPlan({
    runs: [{ fingerprint: 'slow' }, { fingerprint: 'next' }],
    timeoutMs: 5,
    executeRun: async (run) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      try {
        if (run.fingerprint === 'slow') await new Promise((resolve) => setTimeout(resolve, 30));
      } finally {
        active -= 1;
      }
      return run.fingerprint;
    },
    onTimeout: async () => { timeoutRecoveries += 1; },
  });

  assert.equal(timeoutRecoveries, 1);
  assert.equal(peakActive, 1, 'one Chrome must never execute overlapping controls after a timeout');
});

test('transient control failures get one clean-page retry before becoming a final failure', async () => {
  let attempts = 0;
  let recoveries = 0;
  const results = await executeInteractionPlan({
    runs: [{ fingerprint: 'flaky' }],
    timeoutMs: 10,
    maxAttempts: 2,
    shouldRetry: (error) => /control-timeout/.test(error),
    executeRun: async () => {
      attempts += 1;
      if (attempts === 1) await new Promise((resolve) => setTimeout(resolve, 30));
      return 'passed-after-retry';
    },
    onTimeout: async () => { recoveries += 1; },
  });
  assert.equal(attempts, 2);
  assert.equal(recoveries, 1);
  assert.deepEqual(results, [{ run: { fingerprint: 'flaky' }, ok: true, value: 'passed-after-retry' }]);
});

test('targeted interaction reruns select only requested fingerprints', () => {
  const controls = [
    { fingerprint: 'login', text: 'Sign In' },
    { fingerprint: 'sofas', text: 'SOFAS' },
    { fingerprint: 'wishlist', text: 'Wishlists' },
  ];
  assert.deepEqual(selectInteractionControls(controls, ['login', 'wishlist']), [controls[0], controls[2]]);
  assert.equal(selectInteractionControls(controls, []).length, 3);
});
