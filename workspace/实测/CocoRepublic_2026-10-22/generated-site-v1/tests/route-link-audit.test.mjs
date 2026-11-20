import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCapturedRouteLinks, auditCapturedRouteLinksBySource } from '../scripts/lib/route-link-audit.mjs';

test('route link audit fails when a captured internal route still escapes to the source domain', () => {
  const report = auditCapturedRouteLinks([
    { route: '/', html: '<a href="https://www.cocorepublic.com.au/sofas/">Sofas</a><a href="https://example.com/help">Help</a>' },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/', '/sofas'],
  });
  assert.equal(report.pass, false);
  assert.equal(report.escapedCapturedRouteCount, 1);
  assert.equal(report.failures[0].targetRoute, '/sofas');
});

test('route link audit accepts local captured routes and unrelated external sites', () => {
  const report = auditCapturedRouteLinks([
    { route: '/', html: '<a href="/sofas">Sofas</a><a href="https://example.com/help">Help</a>' },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/', '/sofas'],
  });
  assert.equal(report.pass, true);
  assert.equal(report.escapedCapturedRouteCount, 0);
});

test('route link audit rejects bare-host escapes from a www storefront', () => {
  const pages = [
    { route: '/living/tables/side-tables', html: '<a href="https://cocorepublic.com.au/705936-aster-bedside-table.html?sku=706238">Aster</a>' },
  ];
  const report = auditCapturedRouteLinks(pages, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/living/tables/side-tables', '/705936-aster-bedside-table.html'],
  });
  assert.equal(report.pass, false);
  assert.equal(report.escapedSourceRouteCount, 1);
  assert.equal(report.escapedCapturedRouteCount, 1);
});

test('route link audit reports uncaptured local navigation separately from source-domain escapes', () => {
  const report = auditCapturedRouteLinks([
    { route: '/', html: '<a href="/missing-product.html?sku=1">Missing</a><a href="https://www.cocorepublic.com.au/another-missing.html">Escaped</a>' },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/'],
  });
  assert.equal(report.pass, false);
  assert.equal(report.escapedSourceRouteCount, 1);
  assert.equal(report.uncapturedLocalRouteCount, 1);
  assert.deepEqual(report.uncapturedLocalRoutes, ['/missing-product.html']);
});

test('route link audit fails when a local navigation target was not generated', () => {
  const report = auditCapturedRouteLinks([
    { route: '/', html: '<a href="/missing-product.html?sku=1">Missing product</a>' },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/'],
  });
  assert.equal(report.pass, false);
  assert.equal(report.escapedSourceRouteCount, 0);
  assert.equal(report.uncapturedLocalRouteCount, 1);
  assert.deepEqual(report.failures, [{
    type: 'uncaptured-local-route',
    route: '/',
    href: '/missing-product.html?sku=1',
    targetRoute: '/missing-product.html',
  }]);
});

test('multi-origin audit only compares each page with its own source storefront', () => {
  const report = auditCapturedRouteLinksBySource([
    {
      route: '/',
      sourceOrigin: 'https://www.cocorepublic.com.au',
      html: '<a href="https://republicpropertystyling.com.au/pages/services">Related external site</a><a href="/missing">Missing</a>',
    },
    {
      route: '/styling',
      sourceOrigin: 'https://republicpropertystyling.com.au',
      html: '<a href="https://www.cocorepublic.com.au/sofas">Related external site</a><a href="https://republicpropertystyling.com.au/pages/services">Escaped own site</a>',
    },
  ], { capturedRoutes: ['/', '/styling'] });
  assert.equal(report.escapedSourceRouteCount, 1);
  assert.equal(report.uncapturedLocalRouteCount, 1);
  assert.deepEqual(report.uncapturedLocalRoutes, ['/missing']);
  assert.equal(report.failures.some((failure) => failure.href === 'https://www.cocorepublic.com.au/sofas'), false);
});

test('route link audit classifies documents, actions, placeholders, and malformed external targets separately from pages', () => {
  const report = auditCapturedRouteLinks([
    {
      route: '/',
      html: [
        '<a href="/missing-page">Page</a>',
        '<a href="/content/report.pdf">Report</a>',
        '<a href="/search.php?search_query=chair">Search</a>',
        '<a href="/~~PRODUCT_ACTION_URL~~">Product action</a>',
        '<a href="/https:/example.com/showroom">Showroom</a>',
      ].join(''),
    },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/'],
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.uncapturedLocalRoutes, ['/missing-page']);
  assert.equal(report.uncapturedLocalRouteCount, 1);
  assert.deepEqual(report.failures.map(({ type, targetRoute }) => ({ type, targetRoute })), [
    { type: 'uncaptured-local-route', targetRoute: '/missing-page' },
    { type: 'missing-local-document', targetRoute: '/content/report.pdf' },
    { type: 'unsupported-local-action', targetRoute: '/search.php' },
    { type: 'unresolved-template-placeholder', targetRoute: '/~~PRODUCT_ACTION_URL~~' },
    { type: 'malformed-external-target', targetRoute: '/https:/example.com/showroom' },
  ]);
});

test('route link audit ignores inert template anchors but still rejects a rendered placeholder link', () => {
  const report = auditCapturedRouteLinks([
    {
      route: '/showrooms',
      html: [
        '<template id="store-card"><a href="~~STORE_URL~~">Website</a></template>',
        '<a href="/~~VISIBLE_URL~~">Visible broken link</a>',
      ].join(''),
    },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/showrooms'],
  });

  assert.equal(report.pass, false);
  assert.equal(report.inspectedLinkCount, 1);
  assert.deepEqual(report.failures, [{
    type: 'unresolved-template-placeholder',
    route: '/showrooms',
    href: '/~~VISIBLE_URL~~',
    targetRoute: '/~~VISIBLE_URL~~',
  }]);
});

test('route link audit accepts a local document only when the build declares that file was frozen', () => {
  const page = { route: '/responsibility', html: '<a href="/content/report.pdf">Download report</a>' };
  const missing = auditCapturedRouteLinks([page], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/responsibility'],
  });
  const frozen = auditCapturedRouteLinks([page], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/responsibility'],
    localDocumentRoutes: ['/content/report.pdf'],
  });

  assert.equal(missing.pass, false);
  assert.equal(missing.failures[0].type, 'missing-local-document');
  assert.equal(frozen.pass, true);
  assert.deepEqual(frozen.failures, []);
});

test('route link audit treats each captured search query as a distinct supported local state', () => {
  const report = auditCapturedRouteLinks([
    {
      route: '/editorials/bedroom-collection',
      html: '<a href="/search.php?search_query=aster">Aster</a><a href="/search.php?search_query=camden">Camden</a>',
    },
  ], {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: [
      '/editorials/bedroom-collection',
      '/search.php?search_query=aster',
      '/search.php?search_query=camden',
    ],
  });

  assert.equal(report.pass, true);
  assert.deepEqual(report.failures, []);
});

test('route link audit aggregates repeated references into unique recovery targets', () => {
  const pages = Array.from({ length: 80 }, (_, index) => ({
    route: `/source-${index + 1}`,
    html: '<a href="/collections/shifting-spaces">Shifting Spaces</a>',
  }));
  pages[0].html += '<a href="/contact-us">Contact</a><a href="/content/2026-APCO-Report-Action-Plan.pdf">Report</a>';

  const report = auditCapturedRouteLinks(pages, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: pages.map(({ route }) => route),
    recoveryEntries: [{ route: '/contact-us', status: 'source-protected' }],
  });

  assert.equal(report.failures.length, 82);
  assert.equal(report.uniqueMissingTargets.length, 3);
  assert.deepEqual(report.uniqueMissingTargets.map(({ targetRoute, referenceCount, status }) => ({ targetRoute, referenceCount, status })), [
    { targetRoute: '/collections/shifting-spaces', referenceCount: 80, status: 'unresolved' },
    { targetRoute: '/contact-us', referenceCount: 1, status: 'source-protected' },
    { targetRoute: '/content/2026-APCO-Report-Action-Plan.pdf', referenceCount: 1, status: 'unresolved' },
  ]);
  assert.deepEqual(report.sourceProtectedTargets.map(({ targetRoute }) => targetRoute), ['/contact-us']);
  assert.deepEqual(report.unresolvedResourceTargets.map(({ targetRoute }) => targetRoute), ['/content/2026-APCO-Report-Action-Plan.pdf']);
});

test('the build enriches route audit targets from the persistent recovery ledger', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'));
  assert.match(source, /recoveryEntries/);
  assert.match(source, /full-site-audit', 'recovery'/);
  assert.match(source, /auditCapturedRouteLinksBySource\(componentPages, \{ capturedRoutes, localDocumentRoutes, recoveryEntries \}\)/);
});
