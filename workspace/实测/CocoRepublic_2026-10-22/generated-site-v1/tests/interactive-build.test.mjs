import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const stagingName = process.env.MATBOX_TEST_DIST_DIR || '.dist-staging';
const stagingDist = path.join(root, stagingName);

test.before(async () => {
  if (process.env.MATBOX_SKIP_TEST_BUILD === '1') {
    await fs.access(path.join(stagingDist, 'UNVERIFIED-STAGING.json'));
    await fs.access(path.join(stagingDist, 'replay', 'routes.json'));
    await fs.access(path.join(stagingDist, 'component-library', 'component-report.json'));
    return;
  }
  execFileSync(process.execPath, ['scripts/build.mjs', '--stage-only', `--staging-dir=${stagingName}`], { cwd: root, stdio: 'pipe' });
});

test('stage-only output is explicitly unverified and cannot be published', async () => {
  const status = JSON.parse(await fs.readFile(path.join(stagingDist, 'UNVERIFIED-STAGING.json'), 'utf8'));
  assert.equal(status.verified, false);
  assert.equal(status.publishable, false);
  assert.ok(Array.isArray(status.failedGates));
  assert.equal(typeof status.routeLinkAudit?.pass, 'boolean');
  if (!status.routeLinkAudit.pass) assert.ok(status.failedGates.includes('route-links'));
});

test('build injects the interaction runtime exactly once into every replay route', async () => {
  const routes = JSON.parse(await fs.readFile(path.join(stagingDist, 'replay', 'routes.json'), 'utf8'));
  const mobileRoutes = JSON.parse(await fs.readFile(path.join(stagingDist, 'replay', 'routes-mobile.json'), 'utf8'));
  assert.ok(Object.keys(routes).length > 0, 'at least one desktop route is generated');
  for (const replayFile of new Set([...Object.values(routes), ...Object.values(mobileRoutes)])) {
    const html = await fs.readFile(path.join(stagingDist, 'replay', replayFile), 'utf8');
    assert.equal((html.match(/<style data-matbox-interactive>/g) ?? []).length, 1, `${replayFile} inline css injection`);
    assert.equal((html.match(/<script data-matbox-interactive>/g) ?? []).length, 1, `${replayFile} inline script injection`);
    assert.equal((html.match(/<script data-matbox-locale-pack>/g) ?? []).length, 1, `${replayFile} locale pack injection`);
    assert.equal((html.match(/<script data-matbox-locale-service>/g) ?? []).length, 1, `${replayFile} locale service injection`);
    assert.equal((html.match(/<script data-matbox-locale-adapter>/g) ?? []).length, 1, `${replayFile} locale adapter injection`);
    assert.equal((html.match(/<script data-matbox-interaction-routes>/g) ?? []).length, 1, `${replayFile} interaction route injection`);
    assert.ok(html.indexOf('<script data-matbox-locale-pack>') < html.indexOf('<script data-matbox-locale-service>'));
    assert.ok(html.indexOf('<script data-matbox-locale-service>') < html.indexOf('<script data-matbox-locale-adapter>'));
    assert.ok(html.indexOf('<script data-matbox-locale-adapter>') < html.indexOf('<script data-matbox-interactive>'));
    assert.match(html, /<base href="(?:\/|https:\/\/[^"<>]+)">/, `${replayFile} has a valid replay resource base`);
    const inlineScript = html.match(/<script data-matbox-interactive>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(inlineScript, `${replayFile} exposes its inline runtime`);
    assert.doesNotThrow(() => new Function(inlineScript), `${replayFile} inline runtime remains valid JavaScript`);
    for (const tag of ['pack', 'service', 'adapter']) {
      const script = html.match(new RegExp(`<script data-matbox-locale-${tag}>([\\s\\S]*?)<\\/script>`))?.[1];
      assert.ok(script, `${replayFile} has ${tag} inline script`);
      assert.doesNotThrow(() => new Function(script), `${replayFile} ${tag} script parses`);
    }
    for (const scriptTag of html.matchAll(/<script\b([^>]*)>/gi)) {
      const attributes = scriptTag[1];
      const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
      assert.ok(
        /data-matbox-(?:locale|interactive|interaction-routes)/.test(attributes)
          || type === 'application/json'
          || type === 'application/ld+json'
          || type === 'application/x-matbox-disabled',
        `${replayFile} does not re-run captured Shopify scripts`,
      );
    }
  }
});

test('build installs observed click redirects as local route aliases', async () => {
  const routes = JSON.parse(await fs.readFile(path.join(stagingDist, 'replay', 'routes.json'), 'utf8'));
  assert.equal(routes['/quote-details'], routes['/quotes']);
  assert.equal(routes['/our-cafes'], routes['/']);
  const home = await fs.readFile(path.join(stagingDist, 'replay', routes['/']), 'utf8');
  assert.match(home, /window\.__matboxInteractionRoutes=/);
  assert.match(home, /"\/quotes":"\/quote-details"/);
  assert.match(home, /"https:\/\/lamericano\.com\.au\/":"\/our-cafes"/);
});

test('build emits a complete component registry and page compositions for every route', async () => {
  const routes = JSON.parse(await fs.readFile(path.join(stagingDist, 'replay', 'routes.json'), 'utf8'));
  const mobileRoutes = JSON.parse(await fs.readFile(path.join(stagingDist, 'replay', 'routes-mobile.json'), 'utf8'));
  const registry = JSON.parse(await fs.readFile(path.join(stagingDist, 'component-library', 'component-registry.json'), 'utf8'));
  const compositions = JSON.parse(await fs.readFile(path.join(stagingDist, 'component-library', 'page-compositions.json'), 'utf8'));
  const report = JSON.parse(await fs.readFile(path.join(stagingDist, 'component-library', 'component-report.json'), 'utf8'));
  const expectedRouteStates = Object.keys(routes).length + Object.keys(mobileRoutes).length;
  assert.equal(compositions.length, expectedRouteStates);
  assert.ok(registry.components.length > 0);
  assert.equal(report.routeCount, expectedRouteStates);
  assert.equal(report.unmappedSectionCount, 0);
  assert.equal(report.componentIdCollisionCount, 0);
  assert.equal(report.reassemblyFailureCount, 0);
  assert.equal(report.coverage, 1);
});
