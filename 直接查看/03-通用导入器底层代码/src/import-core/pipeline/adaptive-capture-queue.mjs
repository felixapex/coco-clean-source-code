const TRANSIENT_CAPTURE_ERROR = /(?:ERR_CONNECTION_RESET|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|Timed out|pending-images|pending-stylesheets|fonts-not-ready)/i;

export function isTransientCaptureError(error) {
  return TRANSIENT_CAPTURE_ERROR.test(String(error?.stack || error || ''));
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export async function runAdaptiveCaptureQueue(items, operation, options = {}) {
  const initialConcurrency = Math.max(1, Math.floor(Number(options.initialConcurrency) || 1));
  const minimumConcurrency = Math.max(1, Math.min(initialConcurrency, Math.floor(Number(options.minimumConcurrency) || 1)));
  const maxAttempts = Math.max(1, Math.floor(Number(options.maxAttempts) || 1));
  const baseBackoffMs = Math.max(0, Number(options.baseBackoffMs) || 0);
  const maxBackoffMs = Math.max(baseBackoffMs, Number(options.maxBackoffMs) || 30_000);
  const isTransient = options.isTransient ?? isTransientCaptureError;
  const onWave = options.onWave ?? (() => {});
  const pending = items.map((item, index) => ({ item, index, attempts: 0 }));
  const completed = new Array(pending.length);
  let concurrency = initialConcurrency;
  let failureWave = 0;

  while (pending.length) {
    const wave = pending.splice(0, concurrency);
    const outcomes = await Promise.all(wave.map(async (entry) => {
      entry.attempts += 1;
      try {
        return { entry, ok: true, value: await operation(entry.item, entry.attempts) };
      } catch (error) {
        return { entry, ok: false, error, transient: isTransient(error) };
      }
    }));

    const retry = [];
    let transientFailures = 0;
    for (const outcome of outcomes) {
      const { entry } = outcome;
      if (outcome.ok) {
        completed[entry.index] = { item: entry.item, ok: true, value: outcome.value, attempts: entry.attempts };
      } else if (outcome.transient && entry.attempts < maxAttempts) {
        transientFailures += 1;
        retry.push(entry);
      } else {
        completed[entry.index] = { item: entry.item, ok: false, error: String(outcome.error?.stack || outcome.error), attempts: entry.attempts };
      }
    }

    const failureRatio = wave.length ? transientFailures / wave.length : 0;
    if (failureRatio >= 0.25) {
      concurrency = Math.max(minimumConcurrency, Math.floor(concurrency / 2));
      failureWave += 1;
    } else if (transientFailures === 0) {
      concurrency = Math.min(initialConcurrency, concurrency + 1);
      failureWave = 0;
    }

    const backoffMs = retry.length
      ? Math.min(maxBackoffMs, baseBackoffMs * (2 ** Math.max(0, failureWave - 1)))
      : 0;
    await onWave({
      attempted: wave.length,
      succeeded: outcomes.filter((outcome) => outcome.ok).length,
      retrying: retry.length,
      nextConcurrency: concurrency,
      concurrency,
      backoffMs,
    });
    if (retry.length) {
      await sleep(backoffMs);
      pending.unshift(...retry);
    }
  }

  return completed;
}
