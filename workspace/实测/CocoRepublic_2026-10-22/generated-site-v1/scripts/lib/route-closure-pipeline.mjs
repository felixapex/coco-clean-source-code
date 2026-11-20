export function decideRouteClosureStep(audit, { passIndex, maxPasses }) {
  const missingRouteCount = Array.isArray(audit?.uncapturedLocalRoutes)
    ? audit.uncapturedLocalRoutes.length
    : Number(audit?.uncapturedLocalRouteCount || 0);
  if (audit?.pass) return { action: 'complete', missingRouteCount: 0 };
  if (Number(audit?.escapedCapturedRouteCount || 0) > 0 || Number(audit?.escapedSourceRouteCount || 0) > 0) {
    return { action: 'fail', code: 'route-link-escape', missingRouteCount };
  }
  if (missingRouteCount === 0) return { action: 'fail', code: 'route-link-audit-failed', missingRouteCount };
  if (passIndex + 1 >= maxPasses) {
    return { action: 'fail', code: 'route-closure-not-converged', missingRouteCount };
  }
  return { action: 'expand', missingRouteCount };
}
