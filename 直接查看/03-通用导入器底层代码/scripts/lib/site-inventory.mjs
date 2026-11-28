import { retryTransient } from './pipeline-budget.mjs';

const DEFAULT_ORIGIN = 'https://majestic-template.myshopify.com';
const EXCLUDED_PREFIXES = [
  '/cart', '/account', '/checkout', '/checkouts', '/challenge', '/localization',
  '/login.php', '/account.php', '/cart.php', '/checkout.php', '/search.php', '/wishlist.php',
  '/compare', '/sitemap', '/sitemap.php', '/cdn-cgi',
];
const NON_DOCUMENT_EXTENSION = /\.(?:avif|bmp|css|csv|gif|ico|jpe?g|js|json|map|mp3|mp4|mjs|mov|pdf|png|svg|tiff?|txt|webm|webp|woff2?|xml|zip)$/i;
const LOCALE_PREFIX = /^\/(?:ja|pt|nl|de|fr|es|it)(?:\/|$)/i;

export function extractSitemapLocations(xml) {
  return [...String(xml).matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)]
    .map((match) => match[1]
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'"));
}

function decodeHtmlEntities(value) {
  return String(value)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function extractHtmlHrefs(html) {
  return [...String(html).matchAll(/\bhref\s*=\s*(["'])([\s\S]*?)\1/gi)]
    .map((match) => decodeHtmlEntities(match[2].trim()))
    .filter(Boolean);
}

export function isDefaultLocaleSitemap(value) {
  const url = new URL(value, DEFAULT_ORIGIN);
  return !LOCALE_PREFIX.test(url.pathname);
}

function embeddedAbsoluteUrl(value) {
  const decodedSpaces = String(value || '').replace(/%20/gi, ' ');
  const match = decodedSpaces.match(/^\/?(https?):\/+(.+)$/i)
    || decodedSpaces.match(/(?:^|\/)\s+(https?):\/+(.+)$/i);
  return match ? `${match[1]}://${match[2]}` : value;
}

export function normalizePublicRoute(value, origin = DEFAULT_ORIGIN) {
  let url;
  try { url = new URL(embeddedAbsoluteUrl(value), origin); } catch { return null; }
  const expected = new URL(origin);
  if (url.origin !== expected.origin || LOCALE_PREFIX.test(url.pathname)) return null;
  let pathname;
  try { pathname = decodeURI(url.pathname); } catch { pathname = url.pathname; }
  pathname = pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
  if (EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;
  if (NON_DOCUMENT_EXTENSION.test(pathname)) return null;
  return pathname;
}

export function routeFilename(route) {
  if (route === '/') return 'route-home.html';
  const slug = route
    .replace(/^\/+|\/+$/g, '')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `route-${slug || 'page'}.html`;
}

export async function discoverDefaultLocaleRoutes(fetchImpl = fetch, root = `${DEFAULT_ORIGIN}/sitemap.xml`, retryOptions = { attempts: 3, delayMs: 500 }) {
  const origin = new URL(root).origin;
  const fetchSitemap = (url) => retryTransient(async () => {
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response;
  }, retryOptions);
  let resolvedRoot = root;
  let response;
  try {
    response = await fetchSitemap(resolvedRoot);
  } catch (error) {
    if (!/returned 404\b/.test(String(error))) throw error;
    resolvedRoot = `${origin}/sitemap.php`;
    response = await fetchSitemap(resolvedRoot);
  }
  const rootBody = await response.text();
  const xmlLocations = extractSitemapLocations(rootBody).filter(isDefaultLocaleSitemap);
  const htmlLocations = xmlLocations.length ? [] : extractHtmlHrefs(rootBody);
  const childLocations = [...xmlLocations, ...htmlLocations];
  const sitemapUrls = childLocations.filter((value) => new URL(value, origin).pathname.endsWith('.xml'));
  const pageUrls = childLocations.filter((value) => !new URL(value, origin).pathname.endsWith('.xml'));
  for (const sitemapUrl of sitemapUrls) {
    const childResponse = await fetchSitemap(sitemapUrl);
    pageUrls.push(...extractSitemapLocations(await childResponse.text()));
  }
  const homeResponse = await fetchSitemap(`${origin}/`);
  const linkedRoutes = extractHtmlHrefs(await homeResponse.text());
  const routes = [...new Set([...pageUrls, ...linkedRoutes].map((value) => normalizePublicRoute(value, origin)).filter(Boolean))].sort();
  if (!routes.includes('/')) routes.unshift('/');
  return { root: resolvedRoot, sitemapUrls, linkedRouteCount: linkedRoutes.length, routes };
}
