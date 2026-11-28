import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function buildInteractionAuditKey({ routeOrder, interactionRedirects, generatedRoutePaths, routeContentFingerprints = {}, sharedContentFingerprint = '' }) {
  return createHash('sha256')
    .update(JSON.stringify({
      contract: 'interaction-audit-v4',
      routes: [...routeOrder],
      interactionRedirects: interactionRedirects || {},
      generatedRoutePaths: [...generatedRoutePaths].sort(),
      routeContentFingerprints,
      sharedContentFingerprint,
    }))
    .digest('hex');
}

function initialReport(routeCount) {
  return {
    generatedAt: new Date().toISOString(),
    sourceRouteCount: routeCount,
    routeResults: [],
    visibleControlInstances: 0,
    anchorInstances: 0,
    nonAnchorButtonInstances: 0,
    clickedButtonInstances: 0,
    expectedNoChangeInstances: 0,
    uniqueInternalTargets: 0,
    validatedInternalTargets: 0,
    validatedStaticTargets: 0,
    failures: [],
  };
}

function withPendingRoutes(checkpoint) {
  const completed = new Set(checkpoint.completedRoutes || []);
  return {
    ...checkpoint,
    completedRoutes: [...completed],
    pendingRoutes: checkpoint.routeOrder.filter((route) => !completed.has(route)),
  };
}

export function createInteractionAuditCheckpoint({ auditKey, routeOrder }) {
  if (!auditKey) throw new Error('Interaction audit checkpoint requires auditKey');
  if (!Array.isArray(routeOrder)) throw new Error('Interaction audit checkpoint requires routeOrder');
  return withPendingRoutes({
    version: 1,
    auditKey,
    routeOrder: [...routeOrder],
    completedRoutes: [],
    report: initialReport(routeOrder.length),
    internalTargets: [],
    updatedAt: new Date().toISOString(),
  });
}

export function recordInteractionAuditRoute(checkpoint, {
  route,
  routeResult,
  failures = [],
  completed = true,
  internalTargets,
} = {}) {
  if (!checkpoint?.routeOrder?.includes(route)) throw new Error(`Unknown interaction audit route: ${route || ''}`);
  const completedRoutes = new Set(checkpoint.completedRoutes || []);
  completed ? completedRoutes.add(route) : completedRoutes.delete(route);
  const previousResults = (checkpoint.report?.routeResults || []).filter((item) => item.route !== route);
  const previousFailures = (checkpoint.report?.failures || []).filter((item) => item.route !== route);
  const routeResults = routeResult ? [...previousResults, routeResult] : previousResults;
  const sum = (field) => routeResults.reduce((total, item) => total + Number(item?.[field] || 0), 0);
  const next = {
    ...checkpoint,
    completedRoutes: [...completedRoutes],
    report: {
      ...checkpoint.report,
      routeResults,
      visibleControlInstances: sum('visibleControls'),
      anchorInstances: sum('anchors'),
      nonAnchorButtonInstances: sum('buttons'),
      clickedButtonInstances: sum('clickedButtons'),
      expectedNoChangeInstances: sum('expectedNoChange'),
      validatedStaticTargets: sum('staticTargets'),
      failures: [...previousFailures, ...failures],
    },
    internalTargets: internalTargets ?? checkpoint.internalTargets ?? [],
    updatedAt: new Date().toISOString(),
  };
  return withPendingRoutes(next);
}

export async function writeInteractionAuditCheckpoint(checkpointPath, checkpoint) {
  await fs.mkdir(path.dirname(checkpointPath), { recursive: true });
  const temporaryPath = `${checkpointPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, checkpointPath);
}

export async function loadInteractionAuditCheckpoint(checkpointPath, { auditKey, routeOrder }) {
  let stored = null;
  try {
    stored = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch {}
  if (
    stored?.version !== 1
    || stored.auditKey !== auditKey
    || JSON.stringify(stored.routeOrder) !== JSON.stringify(routeOrder)
  ) {
    return createInteractionAuditCheckpoint({ auditKey, routeOrder });
  }
  return withPendingRoutes(stored);
}
