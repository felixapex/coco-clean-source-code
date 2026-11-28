const VIEWPORTS = Object.freeze(['desktop', 'mobile']);

function routeState(route = '') {
  const url = new URL(route || '/', 'https://matbox.invalid');
  const mobile = url.searchParams.get('matbox-viewport') === 'mobile';
  url.searchParams.delete('matbox-viewport');
  const query = url.searchParams.toString();
  return { route: `${url.pathname}${query ? `?${query}` : ''}`, viewport: mobile ? 'mobile' : 'desktop' };
}

export function groupPageCompositions(compositions = []) {
  const groups = new Map();
  for (const composition of compositions) {
    const state = routeState(composition?.route);
    const group = groups.get(state.route) || { route: state.route, desktop: null, mobile: null, componentIds: [] };
    group[state.viewport] = composition;
    for (const instance of composition?.instances || []) {
      if (instance.matboxComponentId && !group.componentIds.includes(instance.matboxComponentId)) group.componentIds.push(instance.matboxComponentId);
    }
    groups.set(state.route, group);
  }
  return [...groups.values()].sort((left, right) => left.route.localeCompare(right.route));
}

function viewportOf(cell) {
  if (cell?.viewport === 'desktop' || cell?.viewport === 'mobile') return cell.viewport;
  return Number(cell?.width) <= 700 ? 'mobile' : 'desktop';
}

function normalizeFailures(failures, extra = {}) {
  return (Array.isArray(failures) ? failures : []).map((failure) => (
    typeof failure === 'string' ? { type: failure, ...extra } : { ...failure, ...extra }
  ));
}

function visualEvidence(fidelity, route, viewport) {
  const result = fidelity?.results?.find((item) => item.route === route && item.viewport === viewport);
  if (!result) return { pass: false, failures: [{ type: 'missing-page-visual-evidence', viewport }] };
  return {
    pass: result.pass === true,
    similarity: result.similarity ?? null,
    exactSize: result.exactSize ?? null,
    source: result.source || result.original || '',
    local: result.local || '',
    diff: result.diff || '',
    failures: result.pass === true ? [] : normalizeFailures(result.failures),
  };
}

function geometryEvidence(responsive, route, viewport) {
  const cells = (responsive?.cells || []).filter((cell) => cell.route === route && viewportOf(cell) === viewport);
  if (cells.length === 0) return { pass: false, failures: [{ type: 'missing-page-geometry-evidence', viewport }] };
  const failures = cells.flatMap((cell) => (
    cell.pass === true ? [] : normalizeFailures(cell.failures?.length ? cell.failures : ['geometry-cell-failed-without-reason'], { width: cell.width })
  ));
  return { pass: failures.length === 0, cells, failures };
}

function interactionEvidence(interactions, route) {
  const failures = [];
  const viewports = [];
  let total = 0;
  let verified = 0;
  for (const viewport of VIEWPORTS) {
    const report = interactions?.[viewport];
    const routeResult = report?.routeResults?.find((item) => item.route === route);
    if (!routeResult) {
      failures.push({ viewport, type: 'missing-page-interaction-evidence' });
      continue;
    }
    viewports.push(viewport);
    total += Number(routeResult.sourceCount || 0);
    verified += Number(routeResult.comparedCount || 0);
    const routeFailures = (report.failures || []).filter((failure) => failure.route === route);
    failures.push(...routeFailures.map(({ route: _route, ...failure }) => ({ viewport, ...failure })));
    if (routeResult.pass !== true && routeFailures.length === 0) {
      failures.push({ viewport, type: 'interaction-route-failed-without-reason' });
    }
    if (Number(routeResult.localCount || 0) !== Number(routeResult.sourceCount || 0) && routeFailures.length === 0) {
      failures.push({ viewport, type: 'control-count-mismatch', sourceCount: routeResult.sourceCount, localCount: routeResult.localCount });
    }
  }
  return { pass: failures.length === 0 && viewports.length === VIEWPORTS.length && verified === total, total, verified, viewports, failures };
}

export function assemblePageVerificationEvidence({
  composition,
  acceptedComponentIds = [],
  fidelity,
  responsive,
  interactions,
} = {}) {
  const route = composition?.route || '';
  const componentIds = composition?.componentIds
    ? [...new Set(composition.componentIds)]
    : [...new Set((composition?.instances || []).map((instance) => instance.matboxComponentId).filter(Boolean))];
  return {
    contractVersion: 1,
    generatedAt: new Date().toISOString(),
    route,
    componentIds,
    acceptedComponentIds: [...new Set(acceptedComponentIds)],
    viewports: Object.fromEntries(VIEWPORTS.map((viewport) => [viewport, {
      visual: visualEvidence(fidelity, route, viewport),
      geometry: geometryEvidence(responsive, route, viewport),
    }])),
    interactions: interactionEvidence(interactions, route),
  };
}

