function normalizeRoute(pathname) {
  const value = String(pathname || '/').replace(/\/{2,}/g, '/');
  return value === '/' ? '/' : value.replace(/\/$/, '');
}

function routePath(value) {
  try { return normalizeRoute(new URL(String(value || '/'), 'https://local.invalid').pathname); } catch { return normalizeRoute(value); }
}

function routeStateIdentity(value) {
  let url;
  try { url = new URL(String(value || '/'), 'https://local.invalid'); } catch { return normalizeRoute(value); }
  const pathname = normalizeRoute(url.pathname);
  if (pathname !== '/search.php') return pathname;
  const query = url.searchParams.get('search_query')?.trim();
  return query ? `${pathname}?search_query=${encodeURIComponent(query)}` : pathname;
}

function canonicalStorefrontHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function classifyMissingLocalTarget(targetRoute) {
  if (/~~/.test(targetRoute)) return 'unresolved-template-placeholder';
  if (/^\/https?:\//i.test(targetRoute)) return 'malformed-external-target';
  if (/\.pdf$/i.test(targetRoute)) return 'missing-local-document';
  if (/\.(?:avif|bmp|css|csv|gif|ico|jpe?g|js|json|map|mp3|mp4|mjs|mov|png|svg|tiff?|txt|webm|webp|woff2?|xml|zip)$/i.test(targetRoute)) {
    return 'missing-local-resource';
  }
  if (/\.(?:php|aspx?)$/i.test(targetRoute)) return 'unsupported-local-action';
  return 'uncaptured-local-route';
}

function aggregateMissingTargets(failures, recoveryEntries = []) {
  const statusByTarget = new Map((recoveryEntries || []).map((entry) => [
    normalizeRoute(entry.route || entry.resourceUrl),
    entry.status,
  ]));
  const targets = new Map();
  for (const failure of failures) {
    if (!failure.targetRoute || ['source-domain-escape', 'source-origin-missing'].includes(failure.type)) continue;
    const targetRoute = normalizeRoute(failure.targetRoute);
    const current = targets.get(targetRoute) || {
      targetRoute,
      type: failure.type,
      referenceCount: 0,
      status: statusByTarget.get(targetRoute) === 'source-protected' ? 'source-protected' : 'unresolved',
      referringRoutes: new Set(),
      hrefs: new Set(),
    };
    current.referenceCount += 1;
    if (failure.route) current.referringRoutes.add(failure.route);
    if (failure.href) current.hrefs.add(failure.href);
    targets.set(targetRoute, current);
  }
  return [...targets.values()]
    .map((target) => ({
      ...target,
      referringRoutes: [...target.referringRoutes].sort(),
      hrefs: [...target.hrefs].sort(),
    }))
    .sort((a, b) => a.targetRoute.localeCompare(b.targetRoute));
}

function recoveryTargetFields(failures, recoveryEntries) {
  const uniqueMissingTargets = aggregateMissingTargets(failures, recoveryEntries);
  return {
    uniqueMissingTargets,
    sourceProtectedTargets: uniqueMissingTargets.filter((target) => target.status === 'source-protected'),
    unresolvedResourceTargets: uniqueMissingTargets.filter((target) => ['missing-local-document', 'missing-local-resource'].includes(target.type)),
  };
}

export function auditCapturedRouteLinks(pages, { sourceOrigin, capturedRoutes = [], localDocumentRoutes = [], recoveryEntries = [] } = {}) {
  const sourceUrl = new URL(sourceOrigin);
  const origin = sourceUrl.origin;
  const sourceHost = canonicalStorefrontHost(sourceUrl.hostname);
  const knownRoutes = new Set(capturedRoutes.map(routePath));
  const knownRouteStates = new Set(capturedRoutes.map(routeStateIdentity));
  const knownLocalDocuments = new Set(localDocumentRoutes.map(normalizeRoute));
  const failures = [];
  const uncapturedLocalRoutes = new Set();
  let inspectedLinkCount = 0;
  for (const page of pages) {
    const renderedHtml = String(page.html || '').replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, '');
    for (const match of renderedHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1/gi)) {
      inspectedLinkCount += 1;
      const rawHref = match[2].replaceAll('&amp;', '&');
      let target;
      try { target = new URL(rawHref, origin); } catch { continue; }
      const targetRoute = normalizeRoute(target.pathname);
      const targetState = routeStateIdentity(`${target.pathname}${target.search}`);
      const targetIsKnown = targetRoute === '/search.php'
        ? knownRouteStates.has(targetState)
        : knownRoutes.has(targetRoute);
      const isSourceStorefront = target.origin === origin
        || (/^https?:$/.test(target.protocol) && canonicalStorefrontHost(target.hostname) === sourceHost);
      if (isSourceStorefront && /^https?:/i.test(rawHref)) {
        failures.push({ type: 'source-domain-escape', route: page.route, href: match[2], targetRoute });
      } else if (isSourceStorefront && !targetIsKnown && !knownLocalDocuments.has(targetRoute) && /^\//.test(rawHref)) {
        const type = classifyMissingLocalTarget(targetRoute);
        if (type === 'uncaptured-local-route') uncapturedLocalRoutes.add(targetRoute);
        failures.push({ type, route: page.route, href: match[2], targetRoute });
      }
    }
  }
  return {
    pass: failures.length === 0,
    inspectedPageCount: pages.length,
    inspectedLinkCount,
    escapedCapturedRouteCount: failures.filter((failure) => failure.type === 'source-domain-escape' && knownRoutes.has(failure.targetRoute)).length,
    escapedSourceRouteCount: failures.filter((failure) => failure.type === 'source-domain-escape').length,
    uncapturedLocalRouteCount: uncapturedLocalRoutes.size,
    uncapturedLocalRoutes: [...uncapturedLocalRoutes].sort(),
    failures,
    ...recoveryTargetFields(failures, recoveryEntries),
  };
}

export function auditCapturedRouteLinksBySource(pages, { capturedRoutes = [], localDocumentRoutes = [], recoveryEntries = [] } = {}) {
  const pagesBySourceOrigin = new Map();
  const failures = [];
  for (const page of pages || []) {
    const sourceOrigin = String(page.sourceOrigin || '').trim();
    if (!sourceOrigin) {
      failures.push({ type: 'source-origin-missing', route: page.route });
      continue;
    }
    if (!pagesBySourceOrigin.has(sourceOrigin)) pagesBySourceOrigin.set(sourceOrigin, []);
    pagesBySourceOrigin.get(sourceOrigin).push(page);
  }
  const reports = [...pagesBySourceOrigin].map(([sourceOrigin, sourcePages]) => ({
    sourceOrigin,
    ...auditCapturedRouteLinks(sourcePages, { sourceOrigin, capturedRoutes, localDocumentRoutes, recoveryEntries }),
  }));
  failures.push(...reports.flatMap((report) => report.failures));
  const uncapturedLocalRoutes = [...new Set(reports.flatMap((report) => report.uncapturedLocalRoutes))].sort();
  return {
    pass: failures.length === 0,
    sourceOrigins: reports.map((report) => report.sourceOrigin),
    inspectedPageCount: reports.reduce((sum, report) => sum + report.inspectedPageCount, 0),
    inspectedLinkCount: reports.reduce((sum, report) => sum + report.inspectedLinkCount, 0),
    escapedCapturedRouteCount: reports.reduce((sum, report) => sum + report.escapedCapturedRouteCount, 0),
    escapedSourceRouteCount: reports.reduce((sum, report) => sum + report.escapedSourceRouteCount, 0),
    uncapturedLocalRouteCount: uncapturedLocalRoutes.length,
    uncapturedLocalRoutes,
    failures,
    ...recoveryTargetFields(failures, recoveryEntries),
  };
}
