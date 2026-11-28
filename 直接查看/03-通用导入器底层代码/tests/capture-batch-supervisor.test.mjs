import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCaptureFailure,
  evaluateCanaryCaptureHealth,
  evaluateCaptureBatchHealth,
  mergeCaptureAttempts,
  runSupervisedCaptureChunks,
  selectRepresentativeCanaryJobs,
} from '../scripts/lib/capture-batch-supervisor.mjs';

test('canary retries replace transient failures before health is evaluated', () => {
  const merged = mergeCaptureAttempts([
    { key: 'home', ok: true },
    { key: 'product', ok: false, error: 'pending-images' },
    { key: 'category', ok: false, error: 'load-more-not-prefetched' },
  ], [
    { item: 'product', ok: true, value: { key: 'product', ok: true } },
    { item: 'category', ok: false, error: 'still failed' },
  ]);
  assert.equal(merged.find((capture) => capture.key === 'product').ok, true);
  assert.equal(merged.find((capture) => capture.key === 'category').error, 'still failed');
  assert.equal(merged.find((capture) => capture.key === 'home').ok, true);
});

test('capture failures distinguish infrastructure, shared resources, and page content', () => {
  assert.equal(classifyCaptureFailure('Navigation failed: net::ERR_CONNECTION_RESET').kind, 'infrastructure');
  assert.equal(classifyCaptureFailure('Navigation failed: net::ERR_NETWORK_ACCESS_DENIED').kind, 'infrastructure');
  assert.equal(classifyCaptureFailure('Navigation failed: net::ERR_NETWORK_CHANGED').kind, 'infrastructure');
  assert.equal(classifyCaptureFailure('CDP command timeout: Page.navigate').kind, 'infrastructure');
  assert.equal(classifyCaptureFailure('CDP command timeout: Runtime.evaluate').kind, 'infrastructure');
  assert.equal(classifyCaptureFailure('Timed out waiting for document.readyState').kind, 'infrastructure');
  const shared = classifyCaptureFailure('Critical image capture failed: https://cdn.test/menu.jpg. Page-screenshot fallback is forbidden for navigation imagery.');
  assert.equal(shared.kind, 'shared-resource');
  assert.equal(shared.resourceUrl, 'https://cdn.test/menu.jpg');
  const sharedFont = classifyCaptureFailure('Invalid source capture: uncaptured-fonts details={"uncapturedFonts":[{"url":"https://cdn.test/site.woff2"}]}');
  assert.equal(sharedFont.kind, 'shared-resource');
  assert.equal(sharedFont.resourceUrl, 'https://cdn.test/site.woff2');
  assert.equal(classifyCaptureFailure('Product title missing').kind, 'page');
});

test('network access denial opens the infrastructure circuit instead of reporting page defects', () => {
  const health = evaluateCaptureBatchHealth([
    { ok: false, route: '/a', error: 'Navigation failed: net::ERR_NETWORK_ACCESS_DENIED' },
    { ok: false, route: '/b', error: 'Navigation failed: net::ERR_NETWORK_ACCESS_DENIED' },
    { ok: false, route: '/c', error: 'Navigation failed: net::ERR_NETWORK_ACCESS_DENIED' },
  ]);
  assert.equal(health.pass, false);
  assert.equal(health.code, 'infrastructure-circuit-open');
  assert.equal(health.signature, 'network-access-denied');
  assert.equal(health.infrastructureFailureCount, 3);
  assert.equal(health.pageFailureCount, 0);
});

test('batch health trips immediately on a shared navigation resource failure', () => {
  const health = evaluateCaptureBatchHealth([
    { ok: true, route: '/' },
    { ok: false, route: '/living', error: 'Critical image capture failed: https://cdn.test/menu.jpg. Page-screenshot fallback is forbidden for navigation imagery.' },
  ]);
  assert.equal(health.pass, false);
  assert.equal(health.code, 'shared-resource-failure');
  assert.deepEqual(health.sharedResourceUrls, ['https://cdn.test/menu.jpg']);
});

test('batch health promotes a resource URL repeated across pages to a shared failure', () => {
  const health = evaluateCaptureBatchHealth([
    {
      ok: false,
      route: '/category',
      error: 'Invalid source capture: pending-images details={"pending":[{"src":"https://cdn.test/products/a.jpg"},{"src":"https://cdn.test/menu.jpg"}]}',
    },
    {
      ok: false,
      route: '/showroom',
      error: 'Invalid source capture: pending-images, pending-background-images details={"pending":[{"src":"https://cdn.test/menu.jpg"}],"pendingBackgrounds":[{"source":"https://cdn.test/showroom.jpg"}]}',
    },
  ]);
  assert.equal(health.pass, false);
  assert.equal(health.code, 'shared-resource-failure');
  assert.deepEqual(health.sharedResourceUrls, ['https://cdn.test/menu.jpg']);
});

test('batch health trips on three matching consecutive infrastructure failures', () => {
  const health = evaluateCaptureBatchHealth([
    { ok: true, route: '/' },
    { ok: false, route: '/a', error: 'Navigation failed: net::ERR_CONNECTION_RESET' },
    { ok: false, route: '/b', error: 'Navigation failed: net::ERR_CONNECTION_RESET' },
    { ok: false, route: '/c', error: 'Navigation failed: net::ERR_CONNECTION_RESET' },
  ]);
  assert.equal(health.pass, false);
  assert.equal(health.code, 'infrastructure-circuit-open');
  assert.equal(health.infrastructureFailureCount, 3);
});

test('batch health does not confuse an isolated page defect with infrastructure failure', () => {
  const health = evaluateCaptureBatchHealth([
    { ok: true, route: '/' },
    { ok: false, route: '/product-a', error: 'Product title missing' },
    { ok: true, route: '/product-b' },
  ]);
  assert.equal(health.pass, true);
  assert.equal(health.pageFailureCount, 1);
});

test('canary health records source-protected routes without blocking healthy routes', () => {
  const health = evaluateCanaryCaptureHealth([
    { key: 'home', ok: true },
    { key: 'appointment', ok: false, error: 'source-verification-challenge' },
  ], {
    resolveRoute: (capture) => capture.key === 'home' ? '/' : '/book-an-appointment',
    isProtected: (failure) => /source-verification-challenge/.test(failure.error),
  });
  assert.equal(health.pass, true);
  assert.equal(health.failureCount, 1);
  assert.equal(health.sourceProtectedCount, 1);
  assert.equal(health.unhandledFailureCount, 0);
});

test('canary health still blocks an ordinary page defect', () => {
  const health = evaluateCanaryCaptureHealth([
    { key: 'product', ok: false, error: 'Product title missing' },
  ]);
  assert.equal(health.pass, false);
  assert.equal(health.code, 'canary-page-failure');
  assert.equal(health.unhandledFailureCount, 1);
});

test('representative canary includes home, category, product, blog, and content routes without duplicates', () => {
  const jobs = [
    { route: '/product-1.html' },
    { route: '/blog/story' },
    { route: '/living/chairs' },
    { route: '/' },
    { route: '/warranty' },
    { route: '/product-2.html' },
    { route: '/outdoor' },
    { route: '/about-us' },
  ];
  const selected = selectRepresentativeCanaryJobs(jobs, 6).map((job) => job.route);
  assert.equal(selected[0], '/');
  assert.ok(selected.some((route) => route.endsWith('.html')));
  assert.ok(selected.some((route) => route.startsWith('/blog/')));
  assert.ok(selected.some((route) => route.split('/').filter(Boolean).length >= 2 && !route.endsWith('.html')));
  assert.equal(new Set(selected).size, selected.length);
});

test('supervised chunks rotate capture batches and stop before later work when infrastructure circuit opens', async () => {
  const batches = [];
  const jobs = Array.from({ length: 9 }, (_, index) => ({ key: `job-${index + 1}`, route: `/route-${index + 1}` }));
  const outcome = await runSupervisedCaptureChunks(jobs, async (batch) => {
    batches.push(batch.map((job) => job.key));
    if (batches.length === 2) {
      return batch.map((job) => ({ key: job.key, ok: false, error: 'Navigation failed: net::ERR_CONNECTION_RESET' }));
    }
    return batch.map((job) => ({ key: job.key, ok: true }));
  }, { chunkSize: 3 });
  assert.deepEqual(batches, [
    ['job-1', 'job-2', 'job-3'],
    ['job-4', 'job-5', 'job-6'],
  ]);
  assert.equal(outcome.pass, false);
  assert.equal(outcome.code, 'infrastructure-circuit-open');
  assert.deepEqual(outcome.pendingJobs.map((job) => job.key), ['job-7', 'job-8', 'job-9']);
});

test('a page-specific failure is recorded without preventing the next supervised chunk', async () => {
  const jobs = Array.from({ length: 5 }, (_, index) => ({ key: `job-${index + 1}`, route: `/route-${index + 1}` }));
  let batchNumber = 0;
  const outcome = await runSupervisedCaptureChunks(jobs, async (batch) => {
    batchNumber += 1;
    return batch.map((job, index) => ({
      key: job.key,
      ok: !(batchNumber === 1 && index === 0),
      error: 'Product title missing',
    }));
  }, { chunkSize: 2 });
  assert.equal(outcome.pass, true);
  assert.equal(outcome.captures.length, 5);
  assert.equal(batchNumber, 3);
});

test('rendered golden capture gates the full pool behind a low-concurrency canary', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/capture-rendered-golden.mjs', import.meta.url), 'utf8'));
  assert.match(source, /selectRepresentativeCanaryJobs/);
  assert.match(source, /evaluateCanaryCaptureHealth/);
  assert.match(source, /MATBOX_CANARY_ROUTES/);
  assert.match(source, /Math\.min\(2, workerCount/);
  assert.match(source, /initialWorkers:\s*Math\.min\(2, workerCount, canaryRetryCandidates\.length\)/);
  assert.match(source, /capture-preflight\.json/);
  assert.match(source, /CANARY_RETRY/);
  assert.match(source, /mergeCaptureAttempts\(initialCanaryCaptures, canaryRetryResults\)/);
  assert.ok(source.indexOf('CANARY_RETRY') < source.indexOf('evaluateCanaryCaptureHealth(canaryCaptures'));
  assert.match(source, /Capture preflight circuit opened/);
  assert.match(source, /runSupervisedCaptureChunks/);
  assert.doesNotMatch(source, /capturePagePool\(remainingJobs/);
  assert.match(source, /capture-progress\.json/);
  assert.match(source, /recoveryFailuresFromCaptures/);
  assert.match(source, /recordCaptureRecoveryFailures\(canaryCaptures\)/);
  assert.match(source, /recordCaptureRecoveryFailures\(supervised\.captures\)/);
  assert.match(source, /createInvalidCaptureError/);
  assert.match(source, /capture-failure-policy\.mjs/);
});
