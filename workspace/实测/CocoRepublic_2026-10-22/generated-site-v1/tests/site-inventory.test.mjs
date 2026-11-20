import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverDefaultLocaleRoutes, extractHtmlHrefs, extractSitemapLocations, isDefaultLocaleSitemap, normalizePublicRoute, routeFilename } from '../scripts/lib/site-inventory.mjs';

test('extractSitemapLocations decodes XML entities', () => {
  const xml = '<urlset><url><loc>https://example.test/products/a?x=1&amp;y=2</loc></url></urlset>';
  assert.deepEqual(extractSitemapLocations(xml), ['https://example.test/products/a?x=1&y=2']);
});

test('homepage links add public routes omitted by Shopify sitemaps', () => {
  const html = '<a href="/collections/all">All</a><a href="/policies/shipping-policy?x=1&amp;y=2">Shipping</a><a href="/cart">Cart</a>';
  assert.deepEqual(extractHtmlHrefs(html), ['/collections/all', '/policies/shipping-policy?x=1&y=2', '/cart']);
});

test('default locale sitemap excludes translated sitemap prefixes', () => {
  assert.equal(isDefaultLocaleSitemap('https://majestic-template.myshopify.com/sitemap_products_1.xml?x=1'), true);
  assert.equal(isDefaultLocaleSitemap('https://majestic-template.myshopify.com/fr/sitemap_products_1.xml?x=1'), false);
});

test('public route normalization is stable and excludes unsafe/system routes', () => {
  assert.equal(normalizePublicRoute('https://majestic-template.myshopify.com/collections/all?sort_by=price'), '/collections/all');
  assert.equal(normalizePublicRoute('https://majestic-template.myshopify.com/'), '/');
  assert.equal(normalizePublicRoute('https://majestic-template.myshopify.com/cart'), null);
  assert.equal(normalizePublicRoute('https://accounts.shopify.com/lookup'), null);
});

test('route filenames are deterministic, unique by path, and filesystem safe', () => {
  assert.equal(routeFilename('/'), 'route-home.html');
  assert.equal(routeFilename('/products/alto-sideboard'), 'route-products-alto-sideboard.html');
  assert.notEqual(routeFilename('/pages/contact'), routeFilename('/products/contact'));
  assert.doesNotMatch(routeFilename('/blogs/a title'), /[\\/:*?"<>| ]/);
  assert.notEqual(routeFilename('/search.php?search_query=aster'), routeFilename('/search.php?search_query=camden'));
});

test('route discovery retries transient root and child sitemap failures', async () => {
  const attempts = new Map();
  const fetchImpl = async (url) => {
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    if (count === 1) throw new Error('ECONNRESET');
    const body = url.endsWith('/sitemap.xml')
      ? '<sitemapindex><sitemap><loc>https://example.test/sitemap_products_1.xml</loc></sitemap></sitemapindex>'
      : url === 'https://example.test/'
        ? '<a href="/collections/all">All products</a><a href="/cart">Cart</a>'
        : '<urlset><url><loc>https://example.test/products/a</loc></url></urlset>';
    return { ok: true, text: async () => body };
  };
  const result = await discoverDefaultLocaleRoutes(fetchImpl, 'https://example.test/sitemap.xml', { attempts: 2, delayMs: 0 });
  assert.deepEqual(result.routes, ['/', '/collections/all', '/products/a']);
  assert.equal(attempts.get('https://example.test/sitemap.xml'), 2);
  assert.equal(attempts.get('https://example.test/sitemap_products_1.xml'), 2);
  assert.equal(attempts.get('https://example.test/'), 2);
});

test('route discovery falls back to a BigCommerce HTML sitemap when sitemap.xml is absent', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url === 'https://example.test/sitemap.xml') {
      return { ok: false, status: 404, text: async () => '' };
    }
    if (url === 'https://example.test/sitemap.php') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => '<a href="/sofas/standard/">Standard sofas</a><a href="/living/tables/coffee-tables/">Coffee tables</a>',
      };
    }
    if (url === 'https://example.test/') {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' },
        text: async () => '<a href="/brands/">Brands</a>',
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const result = await discoverDefaultLocaleRoutes(fetchImpl, 'https://example.test/sitemap.xml', { attempts: 1, delayMs: 0 });

  assert.deepEqual(result.routes, ['/', '/brands', '/living/tables/coffee-tables', '/sofas/standard']);
  assert.equal(result.root, 'https://example.test/sitemap.php');
  assert.deepEqual(requested, [
    'https://example.test/sitemap.xml',
    'https://example.test/sitemap.php',
    'https://example.test/',
  ]);
});

test('public route normalization accepts generic commerce paths and rejects assets and system endpoints', () => {
  assert.equal(normalizePublicRoute('/sofas/standard/', 'https://example.test'), '/sofas/standard');
  assert.equal(normalizePublicRoute('/living/tables/coffee-tables/', 'https://example.test'), '/living/tables/coffee-tables');
  assert.equal(normalizePublicRoute('/cr11-h851-0002280-madison-console.html', 'https://example.test'), '/cr11-h851-0002280-madison-console.html');
  assert.equal(normalizePublicRoute('/content/catalogue.pdf', 'https://example.test'), null);
  assert.equal(normalizePublicRoute('/login.php', 'https://example.test'), null);
  assert.equal(normalizePublicRoute('/account.php', 'https://example.test'), null);
  assert.equal(normalizePublicRoute('/sitemap/categories', 'https://example.test'), null);
  assert.equal(normalizePublicRoute('https://other.test/sofas/standard/', 'https://example.test'), null);
});

test('full capture rebuilds the route manifest instead of retaining stale routes', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/capture-rendered-golden.mjs', import.meta.url), 'utf8'));
  assert.match(source, /routesByViewport\[viewport\] = isPartialCapture \|\| resumeMode \? existingRoutes : \{\}/);
  assert.match(source, /filter\(\(arg\) => arg\.startsWith\('--route='\)\)/);
  assert.match(source, /route-inventory\.json/);
  assert.doesNotMatch(source, /discoverDefaultLocaleRoutes/);
});
