import fs from 'node:fs/promises';
import path from 'node:path';
import {
  classifyRecoveryFailure,
  createRecoveryLedger,
  pendingRecoveryEntries,
  recordRecoveryAttempt,
} from './targeted-recovery.mjs';

async function readLedger(ledgerPath) {
  try { return JSON.parse(await fs.readFile(ledgerPath, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}

function normalizeFailure(failure) {
  const classified = failure.kind ? failure : classifyRecoveryFailure(failure);
  return {
    ...failure,
    ...classified,
    viewport: failure.viewport || 'desktop',
    status: failure.status || (classified.kind === 'source-protected' ? 'source-protected' : 'pending'),
  };
}

export function recoveryFailuresFromCaptures(captures) {
  return (captures || []).filter((capture) => !capture?.ok).map((capture) => {
    const [keyViewport, ...keyRoute] = String(capture.key || '').split(':');
    const route = capture.route || keyRoute.join(':') || (() => {
      try { return new URL(capture.url).pathname; } catch { return ''; }
    })();
    const viewport = capture.viewport || capture.viewportName || (['desktop', 'mobile'].includes(keyViewport) ? keyViewport : 'desktop');
    return normalizeFailure({ route, viewport, error: capture.error });
  });
}

function recoveryGroups(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const key = ['resource', 'shared-resource'].includes(entry.kind) && entry.resourceUrl
      ? `${entry.kind}:${entry.resourceUrl}`
      : entry.key;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function summarize(ledger) {
  const entries = Object.values(ledger.entries || {});
  const count = (status) => entries.filter((entry) => entry.status === status).length;
  const completedCount = entries.filter((entry) => ['completed', 'verified'].includes(entry.status)).length;
  const sourceProtectedCount = count('source-protected');
  const unresolvedCount = entries.length - completedCount - sourceProtectedCount;
  return {
    generatedAt: new Date().toISOString(),
    siteId: ledger.siteId,
    taskCount: entries.length,
    completedCount,
    sourceProtectedCount,
    unresolvedCount,
    pass: unresolvedCount === 0 && sourceProtectedCount === 0,
  };
}

export async function runTargetedRecovery({
  siteId,
  failures = [],
  handlers = {},
  ledgerPath,
  initialWorkers = 2,
  maxRetryWaves = 3,
}) {
  if (!ledgerPath) throw new Error('runTargetedRecovery requires ledgerPath');
  const previous = await readLedger(ledgerPath);
  if (previous && previous.siteId !== siteId) throw new Error(`Recovery ledger belongs to ${previous.siteId}, not ${siteId}`);
  let ledger = createRecoveryLedger({
    siteId,
    entries: [...Object.values(previous?.entries || {}), ...failures.map(normalizeFailure)],
  });
  await writeAtomic(ledgerPath, ledger);

  for (let attempt = 1; attempt <= maxRetryWaves; attempt += 1) {
    const pending = pendingRecoveryEntries(ledger);
    if (!pending.length) break;
    const workerCount = Math.max(1, Math.floor(initialWorkers / (2 ** (attempt - 1))));
    for (const dependents of recoveryGroups(pending)) {
      const entry = dependents[0];
      const handler = handlers[entry.kind];
      let result;
      try {
        result = typeof handler === 'function'
          ? await handler(entry, { attempt, workerCount, dependents })
          : { pass: false, error: `No recovery handler for ${entry.kind}` };
      } catch (error) {
        result = { pass: false, error: error?.message || String(error) };
      }
      for (const dependent of dependents) {
        ledger = recordRecoveryAttempt(ledger, {
          key: dependent.key,
          ok: Boolean(result?.pass),
          status: result?.pass ? 'completed' : entry.kind === 'network' ? 'network-deferred' : 'failed',
          strategy: result?.strategy || `${entry.kind}-recovery`,
          error: result?.error || null,
        });
      }
    }
    await writeAtomic(ledgerPath, ledger);
  }
  const summary = summarize(ledger);
  await writeAtomic(path.join(path.dirname(ledgerPath), 'summary.json'), summary);
  return summary;
}
