import fs from 'node:fs/promises';
import path from 'node:path';

function emptyReport(routeCount) {
  return {
    routeCount,
    comparedControlCount: 0,
    sourceControlCount: 0,
    localControlCount: 0,
    routeResults: [],
    failures: [],
  };
}

function withPendingRoutes(checkpoint) {
  const completedRoutes = [...new Set(checkpoint.completedRoutes || [])];
  const completed = new Set(completedRoutes);
  return {
    ...checkpoint,
    completedRoutes,
    pendingRoutes: checkpoint.routeOrder.filter((route) => !completed.has(route)),
  };
}

export function createSourceLocalParityCheckpoint({ auditKey, routeOrder }) {
  if (!auditKey) throw new Error('Source-local parity checkpoint requires auditKey');
  if (!Array.isArray(routeOrder)) throw new Error('Source-local parity checkpoint requires routeOrder');
  return withPendingRoutes({
    version: 1,
    auditKey,
    routeOrder: [...routeOrder],
    completedRoutes: [],
    report: emptyReport(routeOrder.length),
    updatedAt: new Date().toISOString(),
  });
}

export function recordSourceLocalParityRoute(checkpoint, {
  route,
  routeResult,
  failures = [],
  completed = true,
} = {}) {
  if (!checkpoint?.routeOrder?.includes(route)) throw new Error(`Unknown source-local parity route: ${route || ''}`);
  const completedRoutes = new Set(checkpoint.completedRoutes || []);
  completed ? completedRoutes.add(route) : completedRoutes.delete(route);
  const routeResults = [
    ...(checkpoint.report?.routeResults || []).filter((item) => item.route !== route),
    ...(routeResult ? [routeResult] : []),
  ];
  const previousFailures = (checkpoint.report?.failures || []).filter((item) => item.route !== route);
  const sum = (field) => routeResults.reduce((total, item) => total + Number(item?.[field] || 0), 0);
  return withPendingRoutes({
    ...checkpoint,
    completedRoutes: [...completedRoutes],
    report: {
      ...checkpoint.report,
      routeResults,
      sourceControlCount: sum('sourceCount'),
      localControlCount: sum('localCount'),
      comparedControlCount: sum('comparedCount'),
      failures: [...previousFailures, ...failures],
    },
    updatedAt: new Date().toISOString(),
  });
}

export async function writeSourceLocalParityCheckpoint(checkpointPath, checkpoint) {
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const temporaryPath = `${checkpointPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, checkpointPath);
}

export async function loadSourceLocalParityCheckpoint(checkpointPath, { auditKey, routeOrder }) {
  let checkpoint;
  try {
    checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch {}
  if (
    checkpoint?.version !== 1
    || checkpoint?.auditKey !== auditKey
    || JSON.stringify(checkpoint?.routeOrder) !== JSON.stringify(routeOrder)
  ) return createSourceLocalParityCheckpoint({ auditKey, routeOrder });
  return withPendingRoutes(checkpoint);
}
