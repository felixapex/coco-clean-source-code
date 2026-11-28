export function isSourceProtectedFailure(failure) {
  const error = String(failure?.error || '');
  if (/source-verification-challenge/i.test(error)) return true;
  const previouslyVerifiedProtectedRoutes = new Set(['/book-an-appointment', '/contact-us']);
  return previouslyVerifiedProtectedRoutes.has(failure?.route)
    && /ERR_NETWORK_ACCESS_DENIED/i.test(error);
}

export function evaluateCaptureCoverage({ total, captured, failures = [], minimumCoverage = 0.95 }) {
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCaptured = Math.max(0, Number(captured) || 0);
  const sourceProtected = failures.filter(isSourceProtectedFailure);
  const unhandledFailures = failures.filter((failure) => !sourceProtected.includes(failure));
  const coverage = safeTotal ? safeCaptured / safeTotal : 1;
  const accounted = safeCaptured + failures.length === safeTotal;
  return {
    pass: coverage >= minimumCoverage && accounted && unhandledFailures.length === 0,
    coverage,
    minimumCoverage,
    sourceProtectedCount: sourceProtected.length,
    sourceProtected,
    unhandledFailures,
    accounted,
  };
}
