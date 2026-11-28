import { classifyCapturePipelineFailure } from '../../src/import-core/capture/capture-failure-policy.mjs';

export function classifyCaptureFailure(error) {
  return classifyCapturePipelineFailure(error);
}

export function evaluateCaptureBatchHealth(results, { consecutiveInfrastructureLimit = 3 } = {}) {
  let consecutiveSignature = null;
  let consecutiveCount = 0;
  let infrastructureFailureCount = 0;
  let pageFailureCount = 0;
  const sharedResourceUrls = new Set();
  const resourcePageCounts = new Map();
  for (const result of results || []) {
    if (result?.ok) {
      consecutiveSignature = null;
      consecutiveCount = 0;
      continue;
    }
    const classification = classifyCaptureFailure(result?.error);
    for (const url of new Set(classification.resourceUrls || [])) {
      resourcePageCounts.set(url, (resourcePageCounts.get(url) || 0) + 1);
    }
    if (classification.kind === 'shared-resource') {
      sharedResourceUrls.add(classification.resourceUrl);
      continue;
    }
    if (classification.kind === 'page') {
      pageFailureCount += 1;
      consecutiveSignature = null;
      consecutiveCount = 0;
      continue;
    }
    infrastructureFailureCount += 1;
    if (classification.signature === consecutiveSignature) consecutiveCount += 1;
    else {
      consecutiveSignature = classification.signature;
      consecutiveCount = 1;
    }
  }
  for (const [url, count] of resourcePageCounts) {
    if (count >= 2) sharedResourceUrls.add(url);
  }
  if (sharedResourceUrls.size) {
    return {
      pass: false,
      code: 'shared-resource-failure',
      infrastructureFailureCount,
      pageFailureCount,
      sharedResourceUrls: [...sharedResourceUrls].sort(),
    };
  }
  if (consecutiveCount >= consecutiveInfrastructureLimit) {
    return {
      pass: false,
      code: 'infrastructure-circuit-open',
      infrastructureFailureCount,
      pageFailureCount,
      sharedResourceUrls: [],
      signature: consecutiveSignature,
      consecutiveFailureCount: consecutiveCount,
    };
  }
  return { pass: true, infrastructureFailureCount, pageFailureCount, sharedResourceUrls: [] };
}

export function evaluateCanaryCaptureHealth(captures, {
  resolveRoute = (capture) => capture?.route || capture?.url || capture?.key || '',
  isProtected = () => false,
} = {}) {
  const failures = (captures || [])
    .filter((capture) => !capture?.ok)
    .map((capture) => ({ ...capture, route: resolveRoute(capture) }));
  const sourceProtected = failures.filter((failure) => isProtected(failure));
  const protectedSet = new Set(sourceProtected);
  const unhandledFailures = failures.filter((failure) => !protectedSet.has(failure));
  const base = evaluateCaptureBatchHealth((captures || []).filter((capture) => (
    capture?.ok || !sourceProtected.some((failure) => failure.key === capture.key && failure.error === capture.error)
  )));
  const health = base.pass && unhandledFailures.length > 0
    ? { ...base, pass: false, code: 'canary-page-failure' }
    : base;
  return {
    ...health,
    failureCount: failures.length,
    sourceProtectedCount: sourceProtected.length,
    sourceProtected,
    unhandledFailureCount: unhandledFailures.length,
    unhandledFailures,
  };
}

export function mergeCaptureAttempts(initialCaptures, retryResults) {
  const latestByKey = new Map();
  for (const result of retryResults || []) {
    if (!result?.item) continue;
    const capture = result.value ?? {
      key: result.item,
      ok: false,
      error: result.error || 'Canary retry failed without an error',
    };
    latestByKey.set(result.item, capture);
  }
  return (initialCaptures || []).map((capture) => latestByKey.get(capture.key) ?? capture);
}

function takeFirst(jobs, predicate, selected, selectedRoutes) {
  const job = jobs.find((candidate) => !selectedRoutes.has(candidate.route) && predicate(candidate.route));
  if (!job) return;
  selected.push(job);
  selectedRoutes.add(job.route);
}

export function selectRepresentativeCanaryJobs(jobs, count = 8) {
  const candidates = [...(jobs || [])];
  const selected = [];
  const selectedRoutes = new Set();
  takeFirst(candidates, (route) => route === '/', selected, selectedRoutes);
  takeFirst(candidates, (route) => /\.html$/i.test(route), selected, selectedRoutes);
  takeFirst(candidates, (route) => /^\/blog\//i.test(route), selected, selectedRoutes);
  takeFirst(candidates, (route) => route.split('/').filter(Boolean).length >= 2 && !/\.html$/i.test(route) && !/^\/blog\//i.test(route), selected, selectedRoutes);
  takeFirst(candidates, (route) => route !== '/' && route.split('/').filter(Boolean).length === 1 && !/\.html$/i.test(route), selected, selectedRoutes);
  for (const job of candidates) {
    if (selected.length >= count) break;
    if (selectedRoutes.has(job.route)) continue;
    selected.push(job);
    selectedRoutes.add(job.route);
  }
  return selected.slice(0, Math.max(0, count));
}

export async function runSupervisedCaptureChunks(jobs, captureChunk, {
  chunkSize = 16,
  onChunk = async () => {},
} = {}) {
  const queue = [...(jobs || [])];
  const captures = [];
  const normalizedChunkSize = Math.max(1, Math.floor(chunkSize));
  for (let offset = 0; offset < queue.length; offset += normalizedChunkSize) {
    const chunkJobs = queue.slice(offset, offset + normalizedChunkSize);
    const chunkCaptures = await captureChunk(chunkJobs, {
      chunkIndex: Math.floor(offset / normalizedChunkSize),
      offset,
    });
    if (!Array.isArray(chunkCaptures)) throw new Error('Supervised capture chunk must return an array');
    captures.push(...chunkCaptures);
    const health = evaluateCaptureBatchHealth(chunkCaptures);
    const pendingJobs = queue.slice(offset + chunkJobs.length);
    await onChunk({ chunkJobs, chunkCaptures, health, captures: [...captures], pendingJobs });
    if (!health.pass) {
      return { ...health, captures, pendingJobs };
    }
  }
  return { pass: true, code: null, captures, pendingJobs: [] };
}
