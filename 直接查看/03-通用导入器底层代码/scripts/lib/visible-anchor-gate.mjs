function canonicalPathname(pathname = '/') {
  const value = String(pathname || '/').replace(/\/{2,}/g, '/');
  return value === '/' ? '/' : value.replace(/\/+$/, '');
}

function generatedRouteExists(generatedRoutes, pathname, search = '') {
  const canonical = canonicalPathname(pathname);
  return [...generatedRoutes].some((route) => {
    const candidate = new URL(String(route), 'http://matbox.local');
    if (canonicalPathname(candidate.pathname) !== canonical) return false;
    return !candidate.search || candidate.search === search;
  });
}

export function classifyVisibleAnchor({ href, localOrigin, generatedRoutes, sourceOrigins = new Set(), interactionRedirects = {} }) {
  let url;
  try { url = new URL(href, localOrigin); } catch { return { kind: 'failure', type: 'invalid-anchor-target', target: String(href || '') }; }
  const declaredRedirect = interactionRedirects[url.href]
    || interactionRedirects[`${url.pathname}${url.search}`]
    || interactionRedirects[url.pathname];
  if (declaredRedirect) {
    const local = new URL(declaredRedirect, localOrigin);
    const pathname = canonicalPathname(local.pathname);
    if (local.origin !== localOrigin || !generatedRouteExists(generatedRoutes, pathname, local.search)) {
      return { kind: 'failure', type: 'ungenerated-internal-target', target: `${local.pathname}${local.search}` };
    }
    return { kind: 'local', target: `${pathname}${local.search}`, pathname };
  }
  if (url.origin === localOrigin) {
    const pathname = canonicalPathname(url.pathname);
    if (!generatedRouteExists(generatedRoutes, pathname, url.search)) return { kind: 'failure', type: 'ungenerated-internal-target', target: `${pathname}${url.search}` };
    return { kind: 'local', target: `${pathname}${url.search}`, pathname };
  }
  if (sourceOrigins.has(url.origin)) return { kind: 'failure', type: 'source-domain-escape', target: url.href };
  return { kind: 'external', target: url.href };
}
