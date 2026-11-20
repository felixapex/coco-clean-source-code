export function classifyVisibleAnchor({ href, localOrigin, generatedRoutes, sourceOrigins = new Set(), interactionRedirects = {} }) {
  let url;
  try { url = new URL(href, localOrigin); } catch { return { kind: 'failure', type: 'invalid-anchor-target', target: String(href || '') }; }
  const declaredRedirect = interactionRedirects[url.href]
    || interactionRedirects[`${url.pathname}${url.search}`]
    || interactionRedirects[url.pathname];
  if (declaredRedirect) {
    const local = new URL(declaredRedirect, localOrigin);
    if (local.origin !== localOrigin || !generatedRoutes.has(local.pathname)) {
      return { kind: 'failure', type: 'ungenerated-internal-target', target: `${local.pathname}${local.search}` };
    }
    return { kind: 'local', target: `${local.pathname}${local.search}`, pathname: local.pathname };
  }
  if (url.origin === localOrigin) {
    if (!generatedRoutes.has(url.pathname)) return { kind: 'failure', type: 'ungenerated-internal-target', target: url.pathname };
    return { kind: 'local', target: `${url.pathname}${url.search}`, pathname: url.pathname };
  }
  if (sourceOrigins.has(url.origin)) return { kind: 'failure', type: 'source-domain-escape', target: url.href };
  return { kind: 'external', target: url.href };
}
