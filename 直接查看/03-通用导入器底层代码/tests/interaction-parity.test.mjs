import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyControl,
  inferInteractionEffect,
  controlFingerprint,
  compareInteractionInventories,
  isInteractionContentReady,
  isInteractionPageReady,
  mergeInteractionReports,
  partitionInteractionRoutes,
} from '../scripts/lib/interaction-parity.mjs';

test('interaction routes are distributed across bounded workers without loss or duplication', () => {
  const routes = Array.from({ length: 17 }, (_, index) => `/route-${index}`);
  const shards = partitionInteractionRoutes(routes, 8);
  assert.equal(shards.length, 8);
  assert.deepEqual(shards.flat().sort(), [...routes].sort());
  assert.equal(new Set(shards.flat()).size, routes.length);
  assert.ok(Math.max(...shards.map((shard) => shard.length)) - Math.min(...shards.map((shard) => shard.length)) <= 1);
  assert.equal(partitionInteractionRoutes(['/one'], 8).length, 1);
});

test('worker interaction reports merge into one complete release gate', () => {
  const merged = mergeInteractionReports([
    { comparedControlCount: 2, sourceControlCount: 2, localControlCount: 2, routeResults: [{ route: '/a', pass: true }], failures: [] },
    { comparedControlCount: 1, sourceControlCount: 1, localControlCount: 1, routeResults: [{ route: '/b', pass: false }], failures: [{ route: '/b', type: 'effect-mismatch' }] },
  ], ['/a', '/b']);
  assert.equal(merged.routeCount, 2);
  assert.equal(merged.comparedControlCount, 3);
  assert.equal(merged.pass, false);
  assert.equal(merged.failures.length, 1);
  const incomplete = mergeInteractionReports([{
    comparedControlCount: 2, sourceControlCount: 2, localControlCount: 2, routeResults: [{ route: '/a', pass: true }], failures: [],
  }], ['/a', '/b']);
  assert.equal(incomplete.pass, false);
  assert.equal(incomplete.failures.at(-1).type, 'missing-route-audit');
});

test('interaction audit accepts an interactive commerce page without waiting forever for third-party resources', () => {
  assert.equal(isInteractionPageReady({ readyState: 'loading', bodyTextLength: 1000 }), false);
  assert.equal(isInteractionPageReady({ readyState: 'interactive', bodyTextLength: 1000 }), true);
  assert.equal(isInteractionPageReady({ readyState: 'complete', bodyTextLength: 1000 }), true);
  assert.equal(isInteractionPageReady({ readyState: 'interactive', bodyTextLength: 0 }), false);
});

test('commerce interaction audit waits for the asynchronous product grid', () => {
  assert.equal(isInteractionContentReady({ bodyTextLength: 1000, controlCount: 10, commercePresent: false, productCount: 0 }), true);
  assert.equal(isInteractionContentReady({ bodyTextLength: 1000, controlCount: 10, commercePresent: true, productCount: 0 }), false);
  assert.equal(isInteractionContentReady({ bodyTextLength: 1000, controlCount: 10, commercePresent: true, productCount: 1 }), true);
  assert.equal(isInteractionContentReady({ bodyTextLength: 1000, controlCount: 0, commercePresent: false, productCount: 0 }), false);
});

test('every visible control receives a deterministic safe-click, navigation, or boundary classification', () => {
  assert.equal(classifyControl({ tag: 'button', type: 'button', text: 'SOFAS' }), 'safe-click');
  assert.equal(classifyControl({ tag: 'a', href: 'https://source.example/sofas' }), 'navigation');
  assert.equal(classifyControl({ tag: 'button', type: 'submit', text: 'Pay now', formAction: '/checkout' }), 'boundary-only');
  assert.equal(classifyControl({ tag: 'div', role: 'button', text: 'Open menu' }), 'safe-click');
  assert.equal(classifyControl({ tag: 'canvas', text: '' }), 'unclassified');
});

test('a sign-in link with a slideout contract is executed as a stateful click instead of blocked', () => {
  assert.equal(classifyControl({
    tag: 'a',
    text: 'Sign In',
    href: 'https://www.cocorepublic.com.au/login.php',
    slideout: 'login',
  }), 'safe-click');
});

test('interaction effects are inferred from the observed result rather than the link destination', () => {
  assert.equal(inferInteractionEffect({
    control: { tag: 'a', href: '/login.php', slideout: 'login' },
    before: { url: 'https://example.test/dining/', visiblePanels: 0 },
    after: { url: 'https://example.test/dining/', visiblePanels: 1, surfaceKind: 'drawer' },
  }), 'drawer');
  assert.equal(inferInteractionEffect({
    control: { tag: 'a', href: '/sofas/' },
    before: { url: 'https://example.test/dining/' },
    after: { url: 'https://example.test/sofas/' },
  }), 'navigation');
  assert.equal(inferInteractionEffect({
    control: { tag: 'button' },
    before: { visiblePanels: 0 },
    after: { visiblePanels: 1, surfaceKind: 'modal' },
  }), 'modal');
  assert.equal(inferInteractionEffect({
    control: { tag: 'button' },
    before: { visiblePanels: 0 },
    after: { visiblePanels: 1, surfaceKind: 'mega-menu' },
  }), 'mega-menu');
});

test('control fingerprints ignore source origin while preserving route, semantics, and occurrence', () => {
  const source = controlFingerprint({
    tag: 'a', text: 'Standard Sofas', ariaLabel: '', href: 'https://www.cocorepublic.com.au/sofas/standard/', occurrence: 2,
  });
  const local = controlFingerprint({
    tag: 'a', text: 'Standard Sofas', ariaLabel: '', href: 'http://127.0.0.1:4173/sofas/standard', occurrence: 2,
  });
  assert.equal(source, local);
});

test('interaction parity fails missing controls, unclassified controls, source escapes, and mismatched effects', () => {
  const source = [
    { fingerprint: 'menu', classification: 'safe-click', effect: { expanded: 'true', visiblePanelsDelta: 1 } },
    { fingerprint: 'sofas', classification: 'navigation', effect: { path: '/sofas' } },
    { fingerprint: 'pay', classification: 'boundary-only', effect: { blocked: true } },
    { fingerprint: 'mystery', classification: 'unclassified', effect: {} },
  ];
  const local = [
    { fingerprint: 'menu', classification: 'safe-click', effect: { expanded: 'false', visiblePanelsDelta: 0 } },
    { fingerprint: 'sofas', classification: 'navigation', effect: { path: 'https://www.cocorepublic.com.au/sofas' } },
    { fingerprint: 'extra', classification: 'safe-click', effect: { pressed: 'true' } },
  ];

  const result = compareInteractionInventories({ source, local, sourceOrigin: 'https://www.cocorepublic.com.au' });
  assert.equal(result.pass, false);
  assert.deepEqual(new Set(result.failures.map((failure) => failure.type)), new Set([
    'effect-mismatch',
    'source-origin-escape',
    'missing-local-control',
    'unclassified-control',
    'unexpected-local-control',
  ]));
});

test('interaction parity accepts equivalent local navigation and observable state changes', () => {
  const source = [
    { fingerprint: 'menu', classification: 'safe-click', effect: { expanded: 'true', visiblePanelsDelta: 1 } },
    { fingerprint: 'sofas', classification: 'navigation', effect: { path: '/sofas' } },
    { fingerprint: 'pay', classification: 'boundary-only', effect: { blocked: true } },
  ];
  const local = [
    { fingerprint: 'menu', classification: 'safe-click', effect: { expanded: 'true', visiblePanelsDelta: 1 } },
    { fingerprint: 'sofas', classification: 'navigation', effect: { path: '/sofas' } },
    { fingerprint: 'pay', classification: 'boundary-only', effect: { blocked: true } },
  ];
  const result = compareInteractionInventories({ source, local, sourceOrigin: 'https://www.cocorepublic.com.au' });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.equal(result.comparedCount, 3);
});

test('interaction parity leaves drawer geometry to the visual gate', () => {
  const common = {
    effectType: 'drawer',
    urlBefore: '/',
    urlAfter: '/',
    visiblePanelsDelta: 1,
    surfaceKind: 'drawer',
    bodyOverflow: 'hidden',
  };
  const source = [{
    fingerprint: 'login',
    classification: 'safe-click',
    effect: { ...common, surface: { kind: 'drawer', text: 'SIGN IN Email Password', rect: { x: -255, y: 0, width: 1920, height: 4286 } } },
  }];
  const local = [{
    fingerprint: 'login',
    classification: 'safe-click',
    effect: { ...common, surface: { kind: 'drawer', text: 'SIGN IN Email Password', rect: { x: -255, y: 0, width: 1905, height: 3887 } } },
  }];
  assert.equal(compareInteractionInventories({ source, local }).pass, true);
});

test('interaction parity leaves opened panel copy to the post-click visual gate', () => {
  const common = { effectType: 'modal', urlBefore: '/', urlAfter: '/', visiblePanelsDelta: 1, surfaceKind: 'modal' };
  const source = [{ fingerprint: 'consultation', classification: 'navigation', effect: { ...common, surface: { kind: 'modal', text: 'Schedule event' } } }];
  const local = [{
    fingerprint: 'consultation',
    classification: 'navigation',
    effect: {
      ...common,
      expanded: null,
      pressed: null,
      checked: null,
      selectionChanged: false,
      valueChanged: false,
      bodyOverflow: 'hidden',
      surface: { kind: 'modal', text: 'Book a consultation' },
    },
  }];
  assert.equal(compareInteractionInventories({ source, local }).pass, true);
});

test('interaction parity ignores implementation-specific body overflow once the same drawer opens', () => {
  const common = {
    effectType: 'drawer',
    urlBefore: 'https://example.test/',
    urlAfter: 'https://example.test/',
    visiblePanelsDelta: 1,
    surfaceKind: 'drawer',
    surface: { kind: 'drawer', text: 'YOUR CART IS EMPTY CONTINUE SHOPPING' },
  };
  const source = { fingerprint: 'cart', classification: 'navigation', effect: { ...common, bodyOverflow: 'visible' } };
  const local = { fingerprint: 'cart', classification: 'navigation', effect: { ...common, bodyOverflow: 'hidden' } };
  assert.equal(compareInteractionInventories({ source: [source], local: [local] }).pass, true);
});

test('interaction parity treats equivalent visible panel changes as equal even when local ARIA is more complete', () => {
  const source = [
    { fingerprint: 'filter', classification: 'safe-click', effect: { expanded: null, visiblePanelsDelta: 1, openDetailsDelta: 0 } },
  ];
  const local = [
    { fingerprint: 'filter', classification: 'safe-click', effect: { expanded: 'true', visiblePanelsDelta: 1, openDetailsDelta: 0 } },
  ];
  const result = compareInteractionInventories({ source, local });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});

test('interaction parity compares the user-visible selection change instead of implementation-specific ARIA', () => {
  const source = [
    { fingerprint: 'swatch', classification: 'safe-click', effect: { pressed: null, selectionChanged: true, visiblePanelsDelta: 0 } },
  ];
  const local = [
    { fingerprint: 'swatch', classification: 'safe-click', effect: { pressed: 'true', selectionChanged: true, visiblePanelsDelta: 0 } },
  ];
  const result = compareInteractionInventories({ source, local });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});

test('interaction parity reports a drawer changed into navigation as an effect type mismatch', () => {
  const source = [{
    fingerprint: 'header-sign-in',
    classification: 'safe-click',
    effect: {
      effectType: 'drawer',
      urlBefore: '/dining/',
      urlAfter: '/dining/',
      visiblePanelsDelta: 1,
    },
  }];
  const local = [{
    fingerprint: 'header-sign-in',
    classification: 'safe-click',
    effect: {
      effectType: 'navigation',
      urlBefore: '/dining/',
      urlAfter: '/login.php',
      path: '/login.php',
    },
  }];

  const result = compareInteractionInventories({ source, local });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'effect-type-mismatch',
    fingerprint: 'header-sign-in',
    sourceEffectType: 'drawer',
    localEffectType: 'navigation',
    sourceControl: source[0],
    localControl: local[0],
  }]);
});

test('audit-only viewport query parameters do not create mobile interaction mismatches', () => {
  const source = [{
    fingerprint: 'mobile-menu', classification: 'safe-click',
    effect: { effectType: 'drawer', urlBefore: 'https://source.test/', urlAfter: 'https://source.test/', visiblePanelsDelta: 1 },
  }];
  const local = [{
    fingerprint: 'mobile-menu', classification: 'safe-click',
    effect: { effectType: 'drawer', urlBefore: 'http://127.0.0.1:4173/?matbox-viewport=mobile', urlAfter: 'http://127.0.0.1:4173/?matbox-viewport=mobile', visiblePanelsDelta: 1 },
  }];
  const result = compareInteractionInventories({ source, local, sourceOrigin: 'https://source.test' });
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test('volatile Cloudflare challenge tokens do not create external navigation mismatches', () => {
  const source = [{
    fingerprint: 'contact', classification: 'navigation',
    effect: { effectType: 'navigation', urlBefore: '/', urlAfter: 'https://help.test/hc/en-us?__cf_chl_rt_tk=source-token', path: 'https://help.test/hc/en-us?__cf_chl_rt_tk=source-token' },
  }];
  const local = [{
    fingerprint: 'contact', classification: 'navigation',
    effect: { effectType: 'navigation', urlBefore: '/', urlAfter: 'https://help.test/hc/en-us?__cf_chl_rt_tk=local-token', path: 'https://help.test/hc/en-us?__cf_chl_rt_tk=local-token' },
  }];
  assert.equal(compareInteractionInventories({ source, local }).pass, true);
});

test('volatile marketing attribution parameters do not create local navigation mismatches', () => {
  const source = [{
    fingerprint: 'sale', classification: 'navigation',
    effect: {
      effectType: 'navigation', urlBefore: '/',
      urlAfter: 'https://source.test/black-friday/?_gl=token&_gcl_au=123&_ga=456&_ga_SITE=789',
      path: 'https://source.test/black-friday/?_gl=token&_gcl_au=123&_ga=456&_ga_SITE=789',
    },
  }];
  const local = [{
    fingerprint: 'sale', classification: 'navigation',
    effect: { effectType: 'navigation', urlBefore: '/', urlAfter: 'http://127.0.0.1/black-friday', path: 'http://127.0.0.1/black-friday' },
  }];
  assert.equal(compareInteractionInventories({ source, local }).pass, true);
});

test('body scroll locking alone is not treated as a user-visible interaction mismatch', () => {
  const common = { effectType: 'no-op', urlBefore: '/', urlAfter: '/', visiblePanelsDelta: 0, openDetailsDelta: 0 };
  const source = [{ fingerprint: 'social', classification: 'navigation', effect: { ...common, bodyOverflow: 'hidden' } }];
  const local = [{ fingerprint: 'social', classification: 'navigation', effect: { ...common, bodyOverflow: 'visible' } }];
  assert.equal(compareInteractionInventories({ source, local }).pass, true);
});

test('Calendly controls accept the source modal and its same-site navigation fallback as equivalent', () => {
  const modal = {
    fingerprint: 'consultation', classification: 'navigation', calendlyBound: true,
    effect: { effectType: 'modal', urlBefore: '/', urlAfter: '/', visiblePanelsDelta: 1, surfaceKind: 'modal' },
  };
  const fallback = {
    fingerprint: 'consultation', classification: 'navigation', calendlyBound: true,
    effect: { effectType: 'navigation', urlBefore: '/', urlAfter: '/complimentary-interior-design', path: '/complimentary-interior-design' },
  };
  assert.equal(compareInteractionInventories({ source: [modal], local: [fallback] }).pass, true);
  assert.equal(compareInteractionInventories({ source: [fallback], local: [modal] }).pass, true);
});

test('declared interaction redirects verify an external source target against its local replacement', () => {
  const source = [{
    fingerprint: 'cafes', classification: 'navigation', href: 'https://lamericano.com.au/',
    effect: { effectType: 'navigation', urlBefore: '/', urlAfter: 'https://lamericano.com.au/', path: 'https://lamericano.com.au/' },
  }];
  const local = [{
    fingerprint: 'cafes', classification: 'navigation', href: 'https://lamericano.com.au/',
    effect: { effectType: 'navigation', urlBefore: '/', urlAfter: 'http://127.0.0.1/our-cafes', path: 'http://127.0.0.1/our-cafes' },
  }];
  const result = compareInteractionInventories({
    source, local,
    interactionRedirects: { 'https://lamericano.com.au/': '/our-cafes' },
  });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
});

test('third-party login redirects remain equivalent when their next parameter is the intended external target', () => {
  const source = [{
    fingerprint: 'instagram', classification: 'navigation',
    effect: {
      effectType: 'navigation', urlBefore: '/',
      urlAfter: 'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Fcocorepublic%2F&is_from_rle',
      path: 'https://www.instagram.com/accounts/login/?next=https%3A%2F%2Fwww.instagram.com%2Fcocorepublic%2F&is_from_rle',
    },
  }];
  const local = [{
    fingerprint: 'instagram', classification: 'navigation',
    effect: {
      effectType: 'navigation', urlBefore: '/',
      urlAfter: 'https://www.instagram.com/cocorepublic/', path: 'https://www.instagram.com/cocorepublic/',
    },
  }];
  assert.equal(compareInteractionInventories({ source, local }).pass, true);
});
