export function extractExternalStylesheets(html, sourceUrl) {
  const urls = [];
  for (const match of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = tag.match(/\brel=["']([^"']*)["']/i)?.[1] || '';
    if (!rel.split(/\s+/).some((value) => value.toLowerCase() === 'stylesheet')) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim() || '';
    if (!href || /^(?:data:|blob:)/i.test(href)) continue;
    try {
      urls.push(new URL(href, sourceUrl).href);
    } catch {}
  }
  return [...new Set(urls)];
}

export function createStylesheetRecoveryPlan(pages) {
  const normalizedPages = [...(pages || [])]
    .map((page) => ({
      ...page,
      stylesheets: [...new Set(page.stylesheets || [])].sort(),
    }))
    .sort((left, right) => left.route.localeCompare(right.route));
  const routesByUrl = new Map();
  for (const page of normalizedPages) {
    for (const url of page.stylesheets) {
      if (!routesByUrl.has(url)) routesByUrl.set(url, []);
      routesByUrl.get(url).push(page.route);
    }
  }
  return {
    pages: normalizedPages,
    resources: [...routesByUrl.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([url, routes]) => ({ url, routes: [...new Set(routes)].sort() })),
  };
}

export function composeRecoveryAssetMap(page, resourceStatusByUrl, verifiedSharedAssets = {}) {
  const assetMap = { ...(verifiedSharedAssets || {}) };
  for (const url of page?.stylesheets || []) {
    const resource = resourceStatusByUrl.get(url);
    if (resource?.status !== 'recovered' || !resource.file) continue;
    assetMap[url] = { file: resource.file, mime: 'text/css' };
  }
  return assetMap;
}

export function shouldQueueRecoveryPage(previousStatus, options = {}) {
  if (options.routeFilter) return true;
  if (previousStatus === 'recovered-and-validated') return false;
  if (previousStatus !== 'source-protected') return true;
  return Boolean(options.retryProtected || options.verifiedAssetMap);
}

export function recoveryStatusForPage(page, resourceStatusByUrl) {
  const unresolved = (page.stylesheets || []).filter((url) => resourceStatusByUrl.get(url)?.status !== 'recovered');
  if (!unresolved.length) return { status: 'ready', unresolved: [] };
  const statuses = unresolved.map((url) => resourceStatusByUrl.get(url)?.status || 'pending');
  const status = statuses.includes('source-protected')
    ? 'source-protected'
    : statuses.includes('failed')
      ? 'failed'
      : 'pending';
  return { status, unresolved };
}

export function mergeRecoveryLedger(previous, current) {
  const key = (page) => `${page.viewport || 'desktop'}:${page.route}`;
  const pageByRoute = new Map((previous?.pages || []).map((page) => [key(page), page]));
  for (const page of current?.pages || []) pageByRoute.set(key(page), page);
  return {
    resources: {
      ...(previous?.resources || {}),
      ...(current?.resources || {}),
    },
    pages: [...pageByRoute.values()].sort((left, right) => key(left).localeCompare(key(right))),
  };
}

export function isRecentProtectedResource(resource, now = Date.now(), cooldownMs = 60 * 60 * 1000) {
  if (resource?.status !== 'source-protected') return false;
  const checkedAt = Date.parse(resource.checkedAt || '');
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 && now - checkedAt < cooldownMs;
}
