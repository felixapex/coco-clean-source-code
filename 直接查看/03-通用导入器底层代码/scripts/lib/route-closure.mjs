export function isCaptureCandidateRoute(route) {
  const value = String(route || '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  if (/~~|\/https?:|\.(?:php|pdf|css|js|json|xml|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(value)) return false;
  if (/\.(?!html$)[a-z0-9]{1,8}$/i.test(value)) return false;
  return true;
}

export function mergeRouteClosure(inventoryRoutes, uncapturedRoutes) {
  return [...new Set([
    ...(inventoryRoutes || []),
    ...(uncapturedRoutes || []).filter(isCaptureCandidateRoute),
  ])].sort();
}

export function createRouteRecoverySchedule(audit) {
  const scheduled = [];
  const deferred = [];
  for (const target of audit?.uniqueMissingTargets || []) {
    if (target.status === 'source-protected') {
      deferred.push({ kind: 'source-protected', route: target.targetRoute, referenceCount: target.referenceCount });
    } else if (['missing-local-document', 'missing-local-resource'].includes(target.type)) {
      scheduled.push({ kind: 'resource', resourceUrl: target.targetRoute, referenceCount: target.referenceCount });
    } else if (isCaptureCandidateRoute(target.targetRoute)) {
      scheduled.push({ kind: 'page', route: target.targetRoute, referenceCount: target.referenceCount });
    }
  }
  return { scheduled, deferred };
}
