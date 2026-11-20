const DEFAULT_EXCLUDED_PREFIXES = ['/api/', '/assets/', '/static/', '/_next/', '/_nuxt/'];
const EXCLUDED_EXTENSIONS = /\.(?:avif|bmp|css|csv|docx?|gif|ico|jpe?g|js|json|map|mp3|mp4|mov|pdf|png|pptx?|rar|rss|svg|tar|tgz|ttf|txt|webm|webp|woff2?|xlsx?|xml|zip)$/i;

function canonicalize(url) {
  url.hash = '';
  url.search = '';
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

export function discoverInternalLinks(baseUrl, hrefs = [], options = {}) {
  const base = new URL(baseUrl);
  const excludedPrefixes = options.excludedPrefixes ?? DEFAULT_EXCLUDED_PREFIXES;
  const maxLinks = options.maxLinks ?? 500;
  const out = [];
  const seen = new Set();

  for (const href of hrefs) {
    if (out.length >= maxLinks) break;
    let url;
    try { url = new URL(href, base); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol)) continue;
    if (url.origin !== base.origin) continue;
    if (excludedPrefixes.some((prefix) => url.pathname.startsWith(prefix))) continue;
    if (EXCLUDED_EXTENSIONS.test(url.pathname)) continue;
    const canonical = canonicalize(url);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}
