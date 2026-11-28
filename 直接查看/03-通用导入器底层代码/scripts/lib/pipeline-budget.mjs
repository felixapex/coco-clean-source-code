export const PIPELINE_TARGET_MS = 20 * 60 * 1000;
export const PIPELINE_BUDGET_MS = PIPELINE_TARGET_MS;

export function evaluatePipelineBudget(elapsedMs, budgetMs = PIPELINE_BUDGET_MS) {
  const measuredElapsedMs = Number(elapsedMs);
  return {
    pass: true,
    enforced: false,
    targetMet: measuredElapsedMs <= budgetMs,
    elapsedMs: measuredElapsedMs,
    budgetMs,
    overrunMs: Math.max(0, measuredElapsedMs - budgetMs),
  };
}

export function resolveWorkerCount(value) {
  const parsed = Number.parseInt(value ?? '8', 10);
  return Math.max(1, Math.min(12, Number.isFinite(parsed) ? parsed : 8));
}

export function resolveOriginWorkerCount(value, workerCount, routeCount = 0) {
  const overall = resolveWorkerCount(workerCount);
  if (value == null && Number(routeCount) > 120) return Math.min(6, overall);
  const parsed = Number.parseInt(value ?? '4', 10);
  const requested = Number.isFinite(parsed) ? parsed : 4;
  return Math.max(1, Math.min(overall, requested));
}

export function resolveAuditWorkerCount(value, workerCount) {
  const overall = resolveWorkerCount(workerCount);
  const parsed = Number.parseInt(value ?? '4', 10);
  const requested = Number.isFinite(parsed) ? parsed : 4;
  return Math.max(1, Math.min(overall, requested));
}

export function resolveResumeMode(value) {
  return String(value ?? '1').trim() === '0' ? '0' : '1';
}

export async function retryTransient(operation, { attempts = 2, delayMs = 250 } = {}) {
  const limit = Math.max(1, Math.floor(Number(attempts) || 1));
  let lastError;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < limit && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
