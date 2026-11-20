function aggregate(records, keySelector) {
  const result = {};
  for (const record of records) {
    const key = keySelector(record);
    if (!key) continue;
    const entry = result[key] || { count: 0, failedCount: 0, elapsedMs: 0, maxMs: 0 };
    entry.count += 1;
    entry.failedCount += record.failed ? 1 : 0;
    entry.elapsedMs += record.elapsedMs;
    entry.maxMs = Math.max(entry.maxMs, record.elapsedMs);
    result[key] = entry;
  }
  return result;
}

export function createInteractionTiming() {
  return { records: [] };
}

export async function measureInteractionPhase(timing, {
  phase,
  route = '',
  side = '',
  now = performance.now.bind(performance),
} = {}, execute) {
  if (!phase) throw new Error('Interaction timing requires a phase');
  if (typeof execute !== 'function') throw new Error('Interaction timing requires an execute function');
  const startedAt = now();
  let failed = false;
  try {
    return await execute();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const endedAt = now();
    timing.records.push({
      phase,
      route,
      side,
      failed,
      startedAt,
      endedAt,
      elapsedMs: Math.max(0, endedAt - startedAt),
    });
  }
}

export function interactionTimingSummary(timing) {
  const records = timing?.records || [];
  const starts = records.map((record) => Number(record.startedAt)).filter(Number.isFinite);
  const ends = records.map((record) => Number(record.endedAt)).filter(Number.isFinite);
  const events = records.flatMap((record) => [
    { at: Number(record.startedAt), delta: 1 },
    { at: Number(record.endedAt), delta: -1 },
  ]).filter((event) => Number.isFinite(event.at))
    .sort((left, right) => left.at - right.at || left.delta - right.delta);
  let concurrent = 0;
  let peakConcurrentPhases = 0;
  for (const event of events) {
    concurrent += event.delta;
    peakConcurrentPhases = Math.max(peakConcurrentPhases, concurrent);
  }
  const phaseEntries = aggregate(records, (record) => record.phase);
  const phases = Object.fromEntries(Object.entries(phaseEntries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, {
      count: entry.count,
      failedCount: entry.failedCount,
      elapsedMs: entry.elapsedMs,
      averageMs: entry.count ? entry.elapsedMs / entry.count : 0,
      maxMs: entry.maxMs,
    }]));
  const compact = (entries) => Object.fromEntries(Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, {
      count: entry.count,
      failedCount: entry.failedCount,
      elapsedMs: entry.elapsedMs,
    }]));
  return {
    totalMeasuredMs: records.reduce((total, record) => total + record.elapsedMs, 0),
    observedSpanMs: starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0,
    peakConcurrentPhases,
    phases,
    sides: compact(aggregate(records, (record) => record.side)),
    routes: compact(aggregate(records, (record) => record.route)),
  };
}

export function withInteractionTiming(report, timing) {
  return {
    ...report,
    timing: interactionTimingSummary(timing),
  };
}
