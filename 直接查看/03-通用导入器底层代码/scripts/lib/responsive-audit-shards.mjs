export function assignResponsiveAuditShards(routes, weights, workerCount) {
  const count = Math.max(1, Math.min(Number(workerCount) || 1, routes.length || 1));
  const shards = Array.from({ length: count }, (_, index) => ({ index, routes: [], weight: 0 }));
  const weightedRoutes = routes.map((route) => ({ route, weight: Number(weights.get(route) || 1) }))
    .sort((left, right) => right.weight - left.weight || left.route.localeCompare(right.route));
  for (const item of weightedRoutes) {
    const shard = [...shards].sort((left, right) => left.weight - right.weight || left.index - right.index)[0];
    shard.routes.push(item.route);
    shard.weight += item.weight;
  }
  for (const shard of shards) shard.routes.sort((a, b) => a.localeCompare(b));
  return shards;
}

function cellKey(cell) {
  return `${cell.route}\u0000${cell.viewport}\u0000${cell.width}`;
}

export function mergeResponsiveAuditReports({ routes, profiles, reports }) {
  const expected = new Set(routes.flatMap((route) => profiles.map((profile) => (
    `${route}\u0000${profile.name}\u0000${profile.width}`
  ))));
  const cells = reports.flatMap((report) => report?.cells || []);
  const failures = reports.flatMap((report) => report?.failures || []);
  const seen = new Map();
  for (const cell of cells) seen.set(cellKey(cell), (seen.get(cellKey(cell)) || 0) + 1);
  const coverageFailures = [];
  for (const key of expected) {
    if (!seen.has(key)) coverageFailures.push({ type: 'missing-responsive-cell', key });
  }
  for (const [key, count] of seen) {
    if (!expected.has(key)) coverageFailures.push({ type: 'unexpected-responsive-cell', key, count });
    else if (count !== 1) coverageFailures.push({ type: 'duplicate-responsive-cell', key, count });
  }
  const orderedCells = [...cells].sort((left, right) => (
    routes.indexOf(left.route) - routes.indexOf(right.route)
    || profiles.findIndex((profile) => profile.name === left.viewport && profile.width === left.width)
      - profiles.findIndex((profile) => profile.name === right.viewport && profile.width === right.width)
  ));
  const passedCells = orderedCells.filter((cell) => cell.pass).length;
  const failedCells = orderedCells.length - passedCells;
  return {
    generatedAt: new Date().toISOString(),
    routeCount: routes.length,
    profiles,
    cells: orderedCells,
    failures,
    coverageFailures,
    cellCount: orderedCells.length,
    passedCells,
    failedCells,
    pass: failedCells === 0 && failures.length === 0 && coverageFailures.length === 0,
  };
}

export function replaceResponsiveAuditCells({ baseReport, patchReport, routes, profiles }) {
  const allowedRoutes = new Set(routes);
  const patchRoutes = new Set((patchReport?.cells || []).map((cell) => cell.route));
  const baseCells = (baseReport?.cells || []).filter((cell) => allowedRoutes.has(cell.route) && !patchRoutes.has(cell.route));
  const baseFailures = (baseReport?.failures || []).filter((failure) => allowedRoutes.has(failure.route) && !patchRoutes.has(failure.route));
  return mergeResponsiveAuditReports({
    routes,
    profiles,
    reports: [
      { cells: baseCells, failures: baseFailures },
      { cells: patchReport?.cells || [], failures: patchReport?.failures || [] },
    ],
  });
}
