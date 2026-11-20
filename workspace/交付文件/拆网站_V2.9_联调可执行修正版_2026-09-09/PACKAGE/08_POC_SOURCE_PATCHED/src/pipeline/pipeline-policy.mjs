export const PIPELINE_BUDGET_MS = 20 * 60 * 1000;

export function evaluatePipelineBudget(elapsedMs, budgetMs = PIPELINE_BUDGET_MS) {
  const elapsed = Number(elapsedMs);
  const budget = Number(budgetMs);
  return {
    pass: elapsed <= budget,
    elapsedMs: elapsed,
    budgetMs: budget,
    overrunMs: Math.max(0, elapsed - budget),
  };
}

export function resolveCaptureConcurrency(value) {
  if (value === undefined || value === null || value === '') return 8;
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(12, Number.isFinite(parsed) ? parsed : 8));
}

export async function runWithPipelineDeadline(operation, { budgetMs = PIPELINE_BUDGET_MS } = {}) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error(`Pipeline hard deadline exceeded after ${budgetMs}ms`));
      reject(controller.signal.reason);
    }, budgetMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation({ signal: controller.signal })), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
