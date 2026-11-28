const REQUIRED_UNIT_GATES = Object.freeze([
  'contract',
  'visual',
  'interaction',
  'coverage',
  'assets',
  'schema',
  'bindings',
  'imageRatio',
  'mutations',
]);

function canonicalRoute(route = '') {
  const url = new URL(String(route || '/'), 'https://matbox.local');
  url.searchParams.delete('matbox-viewport');
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}`;
}

function responsiveCellKey(cell = {}) {
  return `${canonicalRoute(cell.route)}\u0000${cell.viewport || ''}\u0000${Number(cell.width) || 0}`;
}

function passed(gate, details = {}) {
  return { gate, pass: true, failures: [], ...details };
}

function failed(gate, failures = [], details = {}) {
  return { gate, pass: false, failures, ...details };
}

function effectiveResponsiveCells(base = {}, patches = []) {
  const cells = new Map((base.cells || []).map((cell) => [responsiveCellKey(cell), cell]));
  for (const patch of patches || []) {
    for (const cell of patch?.cells || []) cells.set(responsiveCellKey(cell), cell);
  }
  return [...cells.values()];
}

function responsiveByRoute(base = {}, patches = []) {
  const routes = new Map();
  for (const cell of effectiveResponsiveCells(base, patches)) {
    const route = canonicalRoute(cell.route);
    const entry = routes.get(route) || { desktop: [], mobile: [] };
    const group = cell.viewport === 'mobile' ? 'mobile' : 'desktop';
    entry[group].push(cell);
    routes.set(route, entry);
  }
  return routes;
}

function interactionByRoute(base = {}, patches = []) {
  const routes = new Map();
  const apply = (report) => {
    const failuresByRoute = new Map();
    for (const failure of report?.failures || []) {
      const route = canonicalRoute(failure.route);
      const values = failuresByRoute.get(route) || [];
      values.push(failure);
      failuresByRoute.set(route, values);
    }
    for (const result of report?.routeResults || []) {
      const route = canonicalRoute(result.route);
      routes.set(route, { result, failures: failuresByRoute.get(route) || [] });
    }
  };
  apply(base);
  for (const patch of patches || []) apply(patch);
  return routes;
}

function routeResponsiveEvidence(route, routes) {
  const cells = routes.get(canonicalRoute(route));
  if (!cells) {
    const reason = [{ type: 'missing-responsive-route', route: canonicalRoute(route) }];
    return {
      pass: false,
      desktop: failed('desktop', reason),
      mobile: failed('mobile', reason),
      failures: reason,
    };
  }
  const evidence = {};
  const failures = [];
  for (const viewport of ['desktop', 'mobile']) {
    const group = cells[viewport] || [];
    const groupFailures = group.length === 0
      ? [{ type: 'missing-responsive-viewport', route: canonicalRoute(route), viewport }]
      : group.filter((cell) => cell.pass !== true).map((cell) => ({
        type: 'responsive-cell-failed',
        route: canonicalRoute(route),
        viewport,
        width: cell.width,
        failures: cell.failures || [],
      }));
    if (groupFailures.length > 0) failures.push(...groupFailures);
    evidence[viewport] = groupFailures.length === 0
      ? passed(viewport, { cellCount: group.length })
      : failed(viewport, groupFailures, { cellCount: group.length });
  }
  return { pass: failures.length === 0, ...evidence, failures };
}

function routeInteractionEvidence(route, routes) {
  const entry = routes.get(canonicalRoute(route));
  if (!entry) {
    return failed('interaction', [{ type: 'missing-interaction-route', route: canonicalRoute(route) }], {
      total: 0,
      verified: 0,
    });
  }
  const total = Number(entry.result?.visibleControls || 0);
  const failures = [...entry.failures];
  if (Number(entry.result?.noEffectButtons || 0) > 0) {
    failures.push({ type: 'no-observable-effect', count: Number(entry.result.noEffectButtons) });
  }
  return failures.length === 0
    ? { pass: true, total, verified: total, failures: [] }
    : { pass: false, total, verified: Math.max(0, total - failures.length), failures };
}

function componentRoutes(compositions = []) {
  const routes = new Map();
  for (const composition of compositions || []) {
    for (const instance of composition.instances || []) {
      if (!instance?.matboxComponentId) continue;
      const values = routes.get(instance.matboxComponentId) || new Set();
      values.add(canonicalRoute(composition.route));
      routes.set(instance.matboxComponentId, values);
    }
  }
  return routes;
}

export function compileVerificationEvidence({
  stageMarker = {},
  componentReport = {},
  editableAudit = {},
  routeClosure = {},
  responsiveBase = {},
  responsivePatches = [],
  interactionBase = {},
  interactionPatches = [],
  mutationReport = {},
  componentRegistry = {},
  pageCompositions = [],
} = {}) {
  const failures = [];
  if ((stageMarker.failedGates || []).length > 0) {
    failures.push({ type: 'stage-has-failed-gates', gates: stageMarker.failedGates });
  }
  if (componentReport.coverage !== 1
    || Number(componentReport.unmappedSectionCount || 0) !== 0
    || Number(componentReport.componentIdCollisionCount || 0) !== 0
    || Number(componentReport.reassemblyFailureCount || 0) !== 0) {
    failures.push({ type: 'component-coverage-failed' });
  }
  if (editableAudit.pass !== true) failures.push({ type: 'editable-contract-failed', failures: editableAudit.failures || [] });
  if (routeClosure.pass !== true || Number(routeClosure.missingTargetCount || 0) !== 0) {
    failures.push({ type: 'route-closure-failed', missingTargetCount: Number(routeClosure.missingTargetCount || 0) });
  }
  if (mutationReport.pass !== true || (mutationReport.externalRequests || []).length > 0) {
    failures.push({ type: 'mutation-verification-failed' });
  }

  const responsiveRoutes = responsiveByRoute(responsiveBase, responsivePatches);
  const interactionRoutes = interactionByRoute(interactionBase, interactionPatches);
  const pageEvidenceByRoute = {};
  for (const composition of pageCompositions || []) {
    const responsive = routeResponsiveEvidence(composition.route, responsiveRoutes);
    const interactions = routeInteractionEvidence(composition.route, interactionRoutes);
    const pageFailures = [...responsive.failures, ...interactions.failures];
    if (pageFailures.length > 0) {
      failures.push({ type: 'page-evidence-failed', route: composition.route, failures: pageFailures });
      if (!responsive.pass) failures.push({ type: 'responsive-route-failed', route: composition.route });
      if (!interactions.pass) failures.push({ type: 'interaction-route-failed', route: composition.route });
    }
    pageEvidenceByRoute[composition.route] = {
      route: composition.route,
      viewports: {
        desktop: { visual: responsive.desktop, geometry: responsive.desktop },
        mobile: { visual: responsive.mobile, geometry: responsive.mobile },
      },
      interactions,
    };
  }

  const routesByComponent = componentRoutes(pageCompositions);
  const globalContractPass = editableAudit.pass === true;
  const globalCoveragePass = componentReport.coverage === 1
    && Number(componentReport.unmappedSectionCount || 0) === 0
    && Number(componentReport.componentIdCollisionCount || 0) === 0
    && Number(componentReport.reassemblyFailureCount || 0) === 0;
  const globalAssetPass = routeClosure.pass === true && Number(routeClosure.missingTargetCount || 0) === 0;
  const globalMutationPass = mutationReport.pass === true && (mutationReport.externalRequests || []).length === 0;
  const unitEvidenceById = {};
  for (const component of componentRegistry.components || []) {
    const componentId = component.matboxComponentId;
    const routes = [...(routesByComponent.get(componentId) || [])];
    const visualFailures = routes.filter((route) => !routeResponsiveEvidence(route, responsiveRoutes).pass);
    const interactionFailures = routes.filter((route) => !routeInteractionEvidence(route, interactionRoutes).pass);
    const gates = {
      contract: globalContractPass ? passed('contract') : failed('contract', editableAudit.failures || []),
      visual: visualFailures.length === 0 ? passed('visual', { routes }) : failed('visual', visualFailures.map((route) => ({ type: 'route-failed', route }))),
      interaction: interactionFailures.length === 0 ? passed('interaction', { routes }) : failed('interaction', interactionFailures.map((route) => ({ type: 'route-failed', route }))),
      coverage: globalCoveragePass ? passed('coverage') : failed('coverage', [{ type: 'component-coverage-failed' }]),
      assets: globalAssetPass ? passed('assets') : failed('assets', [{ type: 'route-closure-failed' }]),
      schema: globalContractPass ? passed('schema') : failed('schema', editableAudit.failures || []),
      bindings: globalContractPass ? passed('bindings') : failed('bindings', editableAudit.failures || []),
      imageRatio: globalContractPass ? passed('image-ratio') : failed('image-ratio', editableAudit.failures || []),
      mutations: globalMutationPass
        ? passed('mutations', { sampleSize: mutationReport.sampleSize || 0, scope: 'shared-runtime-representative-components' })
        : failed('mutations', [{ type: 'mutation-verification-failed' }]),
    };
    unitEvidenceById[componentId] = Object.fromEntries(REQUIRED_UNIT_GATES.map((gate) => [gate, gates[gate]]));
  }

  return {
    pass: failures.length === 0,
    failures,
    unitEvidenceById,
    pageEvidenceByRoute,
    summary: {
      components: Object.keys(unitEvidenceById).length,
      pages: Object.keys(pageEvidenceByRoute).length,
      responsiveRoutes: responsiveRoutes.size,
      interactionRoutes: interactionRoutes.size,
    },
  };
}

export { canonicalRoute };
