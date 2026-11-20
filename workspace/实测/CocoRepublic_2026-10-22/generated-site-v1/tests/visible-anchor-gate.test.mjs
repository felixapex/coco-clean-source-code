import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyVisibleAnchor } from '../scripts/lib/visible-anchor-gate.mjs';

const localOrigin = 'http://127.0.0.1:4173';
const generatedRoutes = new Set(['/', '/bedroom', '/products/chair']);
const sourceOrigins = new Set(['https://www.cocorepublic.com.au']);

test('visible local link must target a generated route', () => {
  assert.deepEqual(classifyVisibleAnchor({ href: `${localOrigin}/missing`, localOrigin, generatedRoutes, sourceOrigins }), {
    kind: 'failure', type: 'ungenerated-internal-target', target: '/missing',
  });
});

test('visible local link to a generated route is collected for validation', () => {
  assert.deepEqual(classifyVisibleAnchor({ href: `${localOrigin}/products/chair?sku=1`, localOrigin, generatedRoutes, sourceOrigins }), {
    kind: 'local', target: '/products/chair?sku=1', pathname: '/products/chair',
  });
});

test('visible link back to source website fails', () => {
  assert.deepEqual(classifyVisibleAnchor({ href: 'https://www.cocorepublic.com.au/bedroom', localOrigin, generatedRoutes, sourceOrigins }), {
    kind: 'failure', type: 'source-domain-escape', target: 'https://www.cocorepublic.com.au/bedroom',
  });
});

test('declared cross-origin capture redirect validates its local replacement', () => {
  assert.deepEqual(classifyVisibleAnchor({
    href: 'https://republicpropertystyling.com.au/pages/services/',
    localOrigin,
    generatedRoutes: new Set(['/pages/services']),
    sourceOrigins: new Set(['https://republicpropertystyling.com.au']),
    interactionRedirects: { 'https://republicpropertystyling.com.au/pages/services/': '/pages/services' },
  }), {
    kind: 'local', target: '/pages/services', pathname: '/pages/services',
  });
});

test('interaction audit can inspect a non-promoted staging candidate', async () => {
  const source = await fs.readFile(path.resolve(import.meta.dirname, '..', 'scripts', 'audit-all-interactions.mjs'), 'utf8');
  assert.match(source, /MATBOX_DIST_DIR/);
  assert.match(source, /auditedRoutePathname/);
  assert.match(source, /if \(control\.disabled\) continue;[\s\S]*?await navigate\(route\);/);
});

test('captured property styling source route is redirected to its local page', async () => {
  const routes = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '..', 'src', 'replay', 'interaction-routes.json'), 'utf8'));
  assert.equal(routes.redirects['https://republicpropertystyling.com.au/pages/services/'], '/pages/services');
});
