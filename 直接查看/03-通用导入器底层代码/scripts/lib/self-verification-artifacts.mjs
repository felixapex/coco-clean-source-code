import { evaluateBaselineEvidence, evaluateSelfVerification } from './self-verification-gate.mjs';

function routeCountOf(inventory) {
  return Number(inventory?.routeCount || inventory?.routes?.length || 0);
}

function manifestRouteCount(routeManifest) {
  return routeManifest && typeof routeManifest === 'object' ? Object.keys(routeManifest).length : 0;
}

export function assembleSelfVerificationEvidence({
  requiredViewports = [],
  inventory = {},
  routeManifest = {},
  goldenCaptures = [],
  componentFidelity,
  fidelity = {},
  responsive = {},
  links = {},
  clickAudit = {},
  parity = {},
  componentReport = {},
} = {}) {
  const requiredRoutes = Array.isArray(inventory.routes) ? inventory.routes : [];
  const baseline = evaluateBaselineEvidence({ requiredRoutes, requiredViewports, captures: goldenCaptures });
  const components = Array.isArray(componentFidelity?.results) ? componentFidelity.results : [];
  const pages = Array.isArray(fidelity?.results) ? fidelity.results : [];
  const inventoryRouteCount = routeCountOf(inventory);
  const generatedRouteCount = manifestRouteCount(routeManifest);
  const missingRoutes = Math.max(0, inventoryRouteCount - generatedRouteCount);
  const routeCoverage = inventoryRouteCount > 0 ? Math.min(1, generatedRouteCount / inventoryRouteCount) : 0;
  const sourceControls = Number(parity?.sourceControlCount || 0);
  const comparedControls = Number(parity?.comparedControlCount || 0);
  const interactionCoverage = sourceControls > 0 ? Math.min(1, comparedControls / sourceControls) : 0;
  const escapedSourceLinks = Number(links?.escapedSourceRouteCount || 0) + Number(links?.escapedCapturedRouteCount || 0);

  const report = evaluateSelfVerification({
    baseline,
    components,
    pages,
    site: {
      routeCoverage,
      generatedRouteCount,
      inventoryRouteCount,
      missingRoutes,
      escapedSourceLinks,
      uncapturedLocalRoutes: Number(links?.uncapturedLocalRouteCount || 0),
      interactionCoverage,
      clickAuditPass: clickAudit?.pass === true,
      interactionParityPass: parity?.pass === true,
      responsivePass: responsive?.pass === true,
      componentStructureCoverage: Number(componentReport?.coverage || 0),
      unmappedSectionCount: Number(componentReport?.unmappedSectionCount || 0),
      reassemblyFailureCount: Number(componentReport?.reassemblyFailureCount || 0),
    },
  });

  return {
    ...report,
    generatedAt: new Date().toISOString(),
    evidence: {
      fidelityErrors: fidelity?.errors || [],
      responsiveFailures: responsive?.failures || [],
      linkFailures: links?.failures || [],
      clickFailures: clickAudit?.failures || [],
      interactionFailures: parity?.failures || [],
    },
  };
}
