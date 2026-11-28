export function assignInteractionAuditShards(routes, weights, workerCount) {
  const count = Math.max(1, Math.min(Number(workerCount) || 1, 2, routes.length || 1));
  const shards = Array.from({ length: count }, (_, index) => ({ index, routes: [], weight: 0 }));
  const weighted = routes.map((route) => ({ route, weight: Number(weights.get(route) || 1) }))
    .sort((left, right) => right.weight - left.weight || left.route.localeCompare(right.route));
  for (const item of weighted) {
    const shard = [...shards].sort((left, right) => left.weight - right.weight || left.index - right.index)[0];
    shard.routes.push(item.route);
    shard.weight += item.weight;
  }
  for (const shard of shards) shard.routes.sort((left, right) => left.localeCompare(right));
  return shards;
}

export function mergeInteractionAuditReports({ routes, reports }) {
  const expected = new Set(routes);
  const routeResults = reports.flatMap((report) => report?.routeResults || []);
  const failures = reports.flatMap((report) => report?.failures || []);
  const seen = new Map();
  for (const result of routeResults) seen.set(result.route, (seen.get(result.route) || 0) + 1);
  const coverageFailures = [];
  for (const route of expected) if (!seen.has(route)) coverageFailures.push({ type: 'missing-interaction-route', route });
  for (const [route, count] of seen) {
    if (!expected.has(route)) coverageFailures.push({ type: 'unexpected-interaction-route', route, count });
    else if (count !== 1) coverageFailures.push({ type: 'duplicate-interaction-route', route, count });
  }
  const targetMap = new Map();
  for (const target of reports.flatMap((report) => report?.internalTargetDetails || [])) {
    const current = targetMap.get(target.target) || { target: target.target, occurrences: 0, sources: [], validated: true };
    current.occurrences += Number(target.occurrences || 0);
    current.validated = current.validated && target.validated === true;
    if (!current.validationState && target.validationState) current.validationState = target.validationState;
    for (const source of target.sources || []) {
      if (current.sources.length >= 5) break;
      if (!current.sources.some((item) => item.route === source.route && item.text === source.text)) current.sources.push(source);
    }
    targetMap.set(target.target, current);
  }
  const internalTargetDetails = [...targetMap.values()].sort((left, right) => left.target.localeCompare(right.target));
  const sum = (field) => routeResults.reduce((total, result) => total + Number(result?.[field] || 0), 0);
  const orderedRouteResults = [...routeResults].sort((left, right) => routes.indexOf(left.route) - routes.indexOf(right.route));
  return {
    generatedAt: new Date().toISOString(),
    sourceRouteCount: routes.length,
    routeResults: orderedRouteResults,
    visibleControlInstances: sum('visibleControls'),
    anchorInstances: sum('anchors'),
    nonAnchorButtonInstances: sum('buttons'),
    clickedButtonInstances: sum('clickedButtons'),
    expectedNoChangeInstances: sum('expectedNoChange'),
    uniqueInternalTargets: internalTargetDetails.length,
    validatedInternalTargets: internalTargetDetails.filter((target) => target.validated).length,
    internalTargetDetails,
    failures,
    coverageFailures,
    pass: failures.length === 0
      && coverageFailures.length === 0
      && internalTargetDetails.every((target) => target.validated),
  };
}
