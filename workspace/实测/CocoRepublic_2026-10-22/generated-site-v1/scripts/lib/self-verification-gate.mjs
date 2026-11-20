function cellKey(route, viewport) {
  return `${route}\u0000${viewport}`;
}

export function evaluateBaselineEvidence({ requiredRoutes = [], requiredViewports = [], captures = [] } = {}) {
  const indexed = new Map(captures.map((capture) => [cellKey(capture.route, capture.viewport), capture]));
  const failures = [];
  const coverage = { required: requiredRoutes.length * requiredViewports.length, passed: 0, missing: 0, errored: 0 };

  for (const route of requiredRoutes) {
    for (const viewport of requiredViewports) {
      const capture = indexed.get(cellKey(route, viewport));
      if (!capture) {
        coverage.missing += 1;
        failures.push({ type: 'missing-baseline-cell', route, viewport });
      } else if (capture.status !== 'passed') {
        coverage.errored += 1;
        failures.push({ type: 'baseline-capture-error', route, viewport, error: String(capture.error || capture.status || 'unknown error') });
      } else {
        coverage.passed += 1;
      }
    }
  }

  return { pass: failures.length === 0 && coverage.passed === coverage.required, failures, coverage };
}

export function evaluateSelfVerification({ baseline, components = [], pages = [], site = {} } = {}) {
  const failures = [];
  if (!baseline?.pass) failures.push(...(baseline?.failures || [{ type: 'baseline-evidence-failed' }]));

  if (components.length === 0) failures.push({ type: 'component-evidence-missing' });
  if (pages.length === 0) failures.push({ type: 'page-evidence-missing' });

  for (const component of components) {
    if (!component.pass) {
      failures.push({
        type: 'component-verification-failed',
        route: component.route,
        componentId: component.componentId,
        viewport: component.viewport,
        failures: component.failures || [],
      });
    } else if (Number.isFinite(component.similarity) && component.similarity < 0.95) {
      failures.push({
        type: 'component-visual-threshold-failed',
        route: component.route,
        componentId: component.componentId,
        viewport: component.viewport,
        similarity: component.similarity,
        threshold: 0.95,
      });
    }
  }

  for (const page of pages) {
    if (page.pass) continue;
    failures.push({ type: 'page-verification-failed', route: page.route, viewport: page.viewport, failures: page.failures || [] });
  }

  if (site.routeCoverage !== 1 || Number(site.missingRoutes || 0) > 0) {
    failures.push({ type: 'route-coverage-incomplete', coverage: Number(site.routeCoverage || 0), missingRoutes: Number(site.missingRoutes || 0) });
  }
  if (Number(site.escapedSourceLinks || 0) > 0) {
    failures.push({ type: 'source-link-escape', count: Number(site.escapedSourceLinks) });
  }
  if (site.interactionCoverage !== 1) {
    failures.push({ type: 'interaction-coverage-incomplete', coverage: Number(site.interactionCoverage || 0) });
  }

  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
    summary: {
      baseline: baseline?.coverage || null,
      components: { checked: components.length, passed: components.filter((item) => item.pass).length },
      pages: { checked: pages.length, passed: pages.filter((item) => item.pass).length },
      site,
    },
  };
}
