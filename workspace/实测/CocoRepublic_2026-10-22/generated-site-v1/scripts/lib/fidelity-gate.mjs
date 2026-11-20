export function evaluateFidelityGate(input, threshold = 0.95) {
  const failures = [];
  if (!(input.similarity >= threshold)) failures.push(`similarity<${threshold}`);
  if (!input.exactSize) failures.push('size-mismatch');
  if (!input.readinessOk) failures.push('visual-readiness-failed');
  if (!input.interactionInventoryOk) failures.push('interaction-inventory-mismatch');
  return { pass: failures.length === 0, threshold, failures };
}

export function visualReadinessOk(readiness) {
  return Boolean(readiness?.fontsReady) && Number(readiness?.pendingImages ?? 0) === 0 && Number(readiness?.failedImages ?? 0) === 0 && Number(readiness?.pendingBackgroundImages ?? 0) === 0 && Number(readiness?.failedBackgroundImages ?? 0) === 0 && Number(readiness?.pendingStylesheets ?? 0) === 0 && Number(readiness?.failedStylesheets ?? 0) === 0 && Number(readiness?.uncapturedStylesheets ?? 0) === 0;
}

export function visualReadinessParity(original, local) {
  return Boolean(original?.fontsReady && local?.fontsReady)
    && Number(local.pendingImages ?? 0) <= Number(original.pendingImages ?? 0)
    && Number(local.failedImages ?? 0) <= Number(original.failedImages ?? 0)
    && Number(local.pendingBackgroundImages ?? 0) <= Number(original.pendingBackgroundImages ?? 0)
    && Number(local.failedBackgroundImages ?? 0) <= Number(original.failedBackgroundImages ?? 0)
    && Number(local.pendingStylesheets ?? 0) <= Number(original.pendingStylesheets ?? 0)
    && Number(local.failedStylesheets ?? 0) <= Number(original.failedStylesheets ?? 0)
    && Number(local.uncapturedStylesheets ?? 0) <= Number(original.uncapturedStylesheets ?? 0);
}
