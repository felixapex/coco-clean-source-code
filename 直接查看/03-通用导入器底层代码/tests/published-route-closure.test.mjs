import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditPublishedRouteClosure } from '../scripts/lib/published-route-closure.mjs';

async function makeSite(routes, pages, assets = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-route-closure-'));
  await fs.mkdir(path.join(root, 'replay'), { recursive: true });
  await fs.writeFile(path.join(root, 'replay', 'routes.json'), JSON.stringify(routes), 'utf8');
  for (const [file, html] of Object.entries(pages)) {
    await fs.writeFile(path.join(root, 'replay', file), html, 'utf8');
  }
  for (const [file, contents] of Object.entries(assets)) {
    const target = path.join(root, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return root;
}

test('published route closure accepts generated targets with query strings and trailing slashes', async (t) => {
  const root = await makeSite(
    { '/': 'home.html', '/products/chair': 'chair.html' },
    {
      'home.html': '<a href="/products/chair/?sku=1">Chair</a><a href="#details">Details</a><a href="/assets/catalogue.pdf">PDF</a>',
      'chair.html': '<h1 id="details">Chair</h1>',
    },
    { 'assets/catalogue.pdf': 'pdf' },
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await auditPublishedRouteClosure(root);

  assert.equal(report.pass, true);
  assert.equal(report.inspectedPages, 2);
  assert.equal(report.inspectedLinks, 3);
  assert.deepEqual(report.missingTargets, []);
});

test('published route closure fails when a product link has no generated target page', async (t) => {
  const root = await makeSite(
    { '/bedroom/storage/side-tables': 'side-tables.html' },
    {
      'side-tables.html': '<a href="/-camden-bedside-table.html?sku=707941">Camden Bedside Table</a><a href="/-camden-bedside-table.html">Camden</a>',
    },
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await auditPublishedRouteClosure(root);

  assert.equal(report.pass, false);
  assert.equal(report.missingTargetCount, 1);
  assert.deepEqual(report.missingTargets, [{
    targetRoute: '/-camden-bedside-table.html',
    referenceCount: 2,
    referringRoutes: ['/bedroom/storage/side-tables'],
  }]);
});

test('published route closure reads a shared replay file once without losing route coverage', async (t) => {
  const root = await makeSite(
    { '/search.php?search_query=chair': 'search.html', '/search.php?search_query=table': 'search.html' },
    { 'search.html': '<a href="/search.php?search_query=chair">Chair search</a>' },
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await auditPublishedRouteClosure(root);

  assert.equal(report.pass, true);
  assert.equal(report.inspectedDocuments, 1);
  assert.equal(report.inspectedPages, 2);
});

test('published route closure reports a broken link found only in the mobile replay', async (t) => {
  const root = await makeSite(
    { '/': 'home.html', '/products/chair': 'chair.html' },
    {
      'home.html': '<a href="/products/chair">Chair</a>',
      'home-mobile.html': '<a href="/products/chair?sku=1">Chair</a><a href="/products/table">Table</a>',
      'chair.html': '<h1>Chair</h1>',
    },
    { 'replay/routes-mobile.json': JSON.stringify({ '/': 'home-mobile.html' }) },
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await auditPublishedRouteClosure(root);
  assert.equal(report.pass, false);
  assert.equal(report.inspectedDocuments, 3);
  assert.deepEqual(report.missingTargets.map(({ targetRoute }) => targetRoute), ['/products/table']);
});

test('mobile-only targets cannot satisfy a link rendered on desktop', async (t) => {
  const root = await makeSite(
    { '/': 'home.html' },
    {
      'home.html': '<a href="/mobile-offer">Offer</a>',
      'offer.html': '<h1>Offer</h1>',
    },
    { 'replay/routes-mobile.json': JSON.stringify({ '/mobile-offer': 'offer.html' }) },
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await auditPublishedRouteClosure(root);
  assert.equal(report.pass, false);
  assert.deepEqual(report.failures.map(({ href, viewports }) => ({ href, viewports })), [
    { href: '/mobile-offer', viewports: ['desktop'] },
  ]);
});

test('a route available only for one query does not satisfy other queries', async (t) => {
  const root = await makeSite(
    { '/': 'home.html', '/catalogue?filter=chairs': 'chairs.html' },
    {
      'home.html': '<a href="/catalogue?filter=chairs">Chairs</a><a href="/catalogue?filter=tables">Tables</a>',
      'chairs.html': '<h1>Chairs</h1>',
    },
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const report = await auditPublishedRouteClosure(root);
  assert.equal(report.pass, false);
  assert.deepEqual(report.failures.map(({ href }) => href), ['/catalogue?filter=tables']);
});
