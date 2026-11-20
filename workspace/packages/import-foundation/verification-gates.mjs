export const REQUIRED_UNIT_GATES = Object.freeze([
  'editorData',
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

function appendGateFailures(failures, gate, result) {
  if (!result || typeof result.pass !== 'boolean') {
    failures.push({ gate, type: 'missing-gate-evidence' });
    return;
  }
  if (result.pass) return;
  const reasons = Array.isArray(result.failures) && result.failures.length > 0
    ? result.failures
    : [{ type: 'gate-failed-without-reason' }];
  for (const reason of reasons) failures.push({ gate, ...reason });
}

export function evaluateUnitVerification(evidence = {}) {
  const failures = [];
  for (const gate of REQUIRED_UNIT_GATES) appendGateFailures(failures, gate, evidence[gate]);
  return { pass: failures.length === 0, status: failures.length === 0 ? 'passed' : 'failed', failures };
}

export function evaluatePageVerification(evidence = {}) {
  const failures = [];
  const componentIds = Array.isArray(evidence.componentIds) ? evidence.componentIds : [];
  const accepted = new Set(Array.isArray(evidence.acceptedComponentIds) ? evidence.acceptedComponentIds : []);
  if (componentIds.length === 0) failures.push({ gate: 'components', type: 'missing-page-components' });
  for (const componentId of componentIds) {
    if (!accepted.has(componentId)) failures.push({ gate: 'components', type: 'unverified-component', componentId });
  }
  for (const viewport of ['desktop', 'mobile']) {
    const viewportEvidence = evidence.viewports?.[viewport];
    if (!viewportEvidence) {
      failures.push({ gate: 'viewport', type: 'missing-viewport-evidence', viewport });
      continue;
    }
    appendGateFailures(failures, `${viewport}-visual`, viewportEvidence.visual);
    appendGateFailures(failures, `${viewport}-geometry`, viewportEvidence.geometry);
  }
  appendGateFailures(failures, 'interactions', evidence.interactions);
  if (evidence.interactions?.pass === true) {
    const total = Number(evidence.interactions.total);
    const verified = Number(evidence.interactions.verified);
    if (!Number.isInteger(total) || total < 0 || verified !== total) {
      failures.push({ gate: 'interactions', type: 'incomplete-control-coverage', total, verified });
    }
  }
  return { pass: failures.length === 0, status: failures.length === 0 ? 'passed' : 'failed', failures };
}

export function evaluateSiteVerification({ publicResources, components = [], pages = [], site = {} } = {}) {
  const failures = [];
  appendGateFailures(failures, 'public-resources', publicResources);
  if (components.length === 0) failures.push({ type: 'component-evidence-missing' });
  for (const component of components) {
    if (component.status !== 'passed') failures.push({ type: 'component-not-verified', componentId: component.id ?? null, status: component.status ?? 'missing' });
  }
  if (pages.length === 0) failures.push({ type: 'page-evidence-missing' });
  for (const page of pages) {
    if (page.status !== 'passed') failures.push({ type: 'page-not-verified', platformPageId: page.platformPageId ?? null, status: page.status ?? 'missing' });
  }
  if (site.status !== 'passed') failures.push({ type: 'site-gate-not-passed', status: site.status ?? 'missing' });
  if (site.routeCoverage !== 1) failures.push({ type: 'route-coverage-incomplete', coverage: Number(site.routeCoverage ?? 0) });
  if (site.interactionCoverage !== 1) failures.push({ type: 'interaction-coverage-incomplete', coverage: Number(site.interactionCoverage ?? 0) });
  if (Number(site.escapedSourceLinks ?? 0) > 0) failures.push({ type: 'source-link-escape', count: Number(site.escapedSourceLinks) });
  return { pass: failures.length === 0, status: failures.length === 0 ? 'passed' : 'failed', failures };
}

