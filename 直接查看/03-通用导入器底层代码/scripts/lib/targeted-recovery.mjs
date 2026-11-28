import { classifyCapturePipelineFailure } from '../../src/import-core/capture/capture-failure-policy.mjs';

export function classifyRecoveryFailure({ error, route = '', resourceUrl = '', validationFailures = [] } = {}) {
  const classified = classifyCapturePipelineFailure(error, { route, resourceUrl, validationFailures });
  if (classified.kind !== 'infrastructure') return classified;
  return { ...classified, kind: 'network', signature: `network:${classified.signature}` };
}

function taskKey(siteId, entry) {
  const viewport = entry.viewport || 'default';
  const route = encodeURIComponent(entry.route || '');
  const resource = encodeURIComponent(entry.resourceUrl || '');
  return `${siteId}:${entry.kind}:${viewport}:${route}:${resource}`;
}

function normalizeEntry(siteId, entry) {
  const key = entry.key || taskKey(siteId, entry);
  return {
    ...entry,
    key,
    siteId,
    status: entry.status || 'pending',
    attempts: Array.isArray(entry.attempts) ? [...entry.attempts] : [],
  };
}

export function createRecoveryLedger({ siteId, entries = [] }) {
  if (!siteId) throw new Error('Recovery ledger requires siteId');
  const normalized = {};
  for (const entry of entries) {
    const value = normalizeEntry(siteId, entry);
    normalized[value.key] ||= value;
  }
  return { version: 1, siteId, entries: normalized };
}

export function recordRecoveryAttempt(ledger, attempt) {
  const current = ledger?.entries?.[attempt?.key];
  if (!current) throw new Error(`Unknown recovery task: ${attempt?.key || ''}`);
  const attemptRecord = {
    ok: Boolean(attempt.ok),
    strategy: attempt.strategy || null,
    error: attempt.error || null,
    recordedAt: attempt.recordedAt || new Date().toISOString(),
  };
  const status = current.status === 'completed' || current.status === 'verified'
    ? current.status
    : attempt.status || (attempt.ok ? 'completed' : 'failed');
  return {
    ...ledger,
    entries: {
      ...ledger.entries,
      [attempt.key]: { ...current, status, attempts: [...current.attempts, attemptRecord] },
    },
  };
}

export function pendingRecoveryEntries(ledger) {
  return Object.values(ledger?.entries || {}).filter((entry) => !['completed', 'verified', 'source-protected'].includes(entry.status));
}
