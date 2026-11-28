import fs from 'node:fs/promises';
import path from 'node:path';

function normalizePathname(value = '/') {
  const normalized = String(value || '/').replace(/\/{2,}/g, '/');
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '');
}

function routeIdentity(value) {
  const url = new URL(String(value || '/'), 'https://local.invalid');
  for (const parameter of ['matbox-viewport', 'responsive-audit', 'full-site-audit']) {
    url.searchParams.delete(parameter);
  }
  const query = url.searchParams.toString();
  const pathname = normalizePathname(url.pathname);
  return query ? `${pathname}?${query}` : pathname;
}

function resolvesRoute(states, request, pathname) {
  return states.has(request) || states.has(pathname);
}

function isDocumentResource(pathname) {
  return /\.(?:avif|bmp|css|csv|gif|ico|jpe?g|js|json|map|mp3|mp4|mjs|mov|pdf|png|svg|tiff?|txt|webm|webp|woff2?|xml|zip)$/i.test(pathname);
}

async function localResourceExists(siteRoot, pathname) {
  const candidate = path.resolve(siteRoot, `.${decodeURIComponent(pathname)}`);
  const relative = path.relative(siteRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    const stat = await fs.stat(candidate);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function auditPublishedRouteClosure(siteRoot) {
  const absoluteRoot = path.resolve(siteRoot);
  const routes = JSON.parse(await fs.readFile(path.join(absoluteRoot, 'replay', 'routes.json'), 'utf8'));
  let mobileRoutes = {};
  try {
    mobileRoutes = JSON.parse(await fs.readFile(path.join(absoluteRoot, 'replay', 'routes-mobile.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const knownRouteStates = new Set(Object.keys(routes).map(routeIdentity));
  const knownMobileRouteStates = new Set(Object.keys(mobileRoutes).map(routeIdentity));
  const routesByFile = new Map();
  function addDocument(file, route, viewport) {
    if (!routesByFile.has(file)) routesByFile.set(file, { desktop: new Set(), mobile: new Set() });
    routesByFile.get(file)[viewport].add(route);
  }
  for (const [route, file] of Object.entries(routes)) {
    addDocument(file, route, 'desktop');
    if (!Object.hasOwn(mobileRoutes, route)) addDocument(file, route, 'mobile');
  }
  for (const [route, file] of Object.entries(mobileRoutes)) addDocument(file, route, 'mobile');

  const missing = new Map();
  const failures = [];
  const localResources = new Map();
  let inspectedLinks = 0;
  for (const [file, referringRoutesByViewport] of routesByFile) {
    const html = await fs.readFile(path.join(absoluteRoot, 'replay', file), 'utf8');
    const renderedHtml = html.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, '');
    for (const match of renderedHtml.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1/gi)) {
      inspectedLinks += 1;
      const rawHref = match[2].replaceAll('&amp;', '&').trim();
      if (!rawHref || rawHref.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(rawHref)) continue;
      let target;
      try { target = new URL(rawHref, 'https://local.invalid'); } catch { continue; }
      if (target.origin !== 'https://local.invalid') continue;
      const targetPath = normalizePathname(target.pathname);
      const state = routeIdentity(`${target.pathname}${target.search}`);
      const missingViewports = Object.entries(referringRoutesByViewport)
        .filter(([viewport, referrers]) => referrers.size > 0 && !resolvesRoute(knownRouteStates, state, targetPath)
          && (viewport !== 'mobile' || !resolvesRoute(knownMobileRouteStates, state, targetPath)))
        .map(([viewport]) => viewport);
      if (missingViewports.length === 0) continue;
      const resource = isDocumentResource(targetPath);
      if (resource) {
        if (!localResources.has(targetPath)) {
          localResources.set(targetPath, await localResourceExists(absoluteRoot, targetPath));
        }
        if (localResources.get(targetPath)) continue;
      }
      const referringRoutes = new Set(missingViewports.flatMap((viewport) => [...referringRoutesByViewport[viewport]]));

      const current = missing.get(targetPath) || {
        targetRoute: targetPath,
        referenceCount: 0,
        referringRoutes: new Set(),
      };
      current.referenceCount += 1;
      for (const route of referringRoutes) current.referringRoutes.add(route);
      missing.set(targetPath, current);
      failures.push({
        type: resource ? 'missing-local-resource' : 'uncaptured-local-route',
        targetRoute: targetPath,
        href: rawHref,
        referringRoutes: [...referringRoutes],
        viewports: missingViewports,
      });
    }
  }

  const missingTargets = [...missing.values()]
    .map((entry) => ({
      ...entry,
      referringRoutes: [...entry.referringRoutes].sort(),
    }))
    .sort((left, right) => left.targetRoute.localeCompare(right.targetRoute));
  return {
    pass: failures.length === 0,
    inspectedPages: Object.keys(routes).length,
    inspectedMobilePages: new Set([...Object.keys(routes), ...Object.keys(mobileRoutes)]).size,
    inspectedDocuments: routesByFile.size,
    inspectedLinks,
    missingTargetCount: missingTargets.length,
    missingTargets,
    failures,
  };
}
