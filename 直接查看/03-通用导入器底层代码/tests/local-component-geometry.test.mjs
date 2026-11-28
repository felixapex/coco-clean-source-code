import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPageComponents } from '../scripts/lib/component-registry.mjs';
import {
  applyMeasuredImageGeometry,
  hasCompleteImageGeometryEvidence,
  applyMeasuredComponentGeometry,
  IMAGE_GEOMETRY_ATTRIBUTE_NAMES,
  compactComponentGeometryMeasurementExpression,
  markedComponentGeometryMeasurementExpression,
  markImageGeometryTargets,
  markComponentGeometryTargets,
  shouldSkipGeometryEnrichment,
  stripImageGeometryEvidence,
  stripComponentGeometryEvidence,
} from '../scripts/lib/local-component-geometry.mjs';

const GEOMETRY = [
  ['x', '0'],
  ['y', '120'],
  ['width', '1440'],
  ['height', '720'],
  ['parent-width', '1440'],
  ['parent-height', '900'],
  ['display', 'grid'],
  ['flex-direction', 'row'],
  ['grid-columns', '720px 720px'],
  ['gap', '24px'],
  ['justify-content', 'normal'],
  ['align-items', 'center'],
  ['viewport', 'desktop'],
  ['viewport-width', '1440'],
  ['viewport-height', '900'],
  ['visible', 'true'],
];

function measuredOpening(key) {
  return `<section data-matbox-geometry-key="${key}" ${GEOMETRY.map(([name, value]) => `data-matbox-component-${name}="${value}"`).join(' ')}>`;
}

test('geometry enrichment changes only inert component evidence attributes', () => {
  const source = '<!doctype html><html><body><main><section class="hero"><h1>Hero</h1></section><section class="cards"><a href="/chairs">Chairs</a></section></main></body></html>';
  const marked = markComponentGeometryTargets(source);
  assert.equal(marked.targets.length, 2);
  assert.match(marked.html, /data-matbox-geometry-key="geometry-1"/);
  assert.match(marked.html, /data-matbox-geometry-key="geometry-2"/);

  const measured = marked.targets.reduce(
    (html, target) => html.replace(
      new RegExp(`<section[^>]*data-matbox-geometry-key="${target.key}"[^>]*>`),
      measuredOpening(target.key),
    ),
    marked.html,
  );
  const enriched = applyMeasuredComponentGeometry(source, measured, marked.targets);

  assert.equal(stripComponentGeometryEvidence(enriched), source);
  assert.equal((enriched.match(/data-matbox-component-width=/g) || []).length, 2);
  const extracted = extractPageComponents(enriched, '/');
  assert.equal(extracted.components.length, 2);
  assert.ok(extracted.components.every((component) => component.sourceGeometry?.viewport === 'desktop'));
});

test('geometry enrichment fails closed when any measured target is absent', () => {
  const source = '<main><section class="hero">Hero</section></main>';
  const marked = markComponentGeometryTargets(source);
  assert.throws(
    () => applyMeasuredComponentGeometry(source, '<main></main>', marked.targets),
    /missing measured geometry/i,
  );
});

test('browser measurement explicitly covers every marked component root', () => {
  assert.match(markedComponentGeometryMeasurementExpression, /data-matbox-geometry-key/);
  for (const [name] of GEOMETRY) {
    assert.match(markedComponentGeometryMeasurementExpression, new RegExp(`data-matbox-component-${name}`));
  }
});

test('browser measurement treats ancestor-hidden and fully clipped descendants as not visible', () => {
  assert.match(markedComponentGeometryMeasurementExpression, /elementHasVisiblePaint/);
  assert.match(markedComponentGeometryMeasurementExpression, /current\.hidden/);
  assert.match(markedComponentGeometryMeasurementExpression, /hasAttribute\('inert'\)/);
  assert.match(markedComponentGeometryMeasurementExpression, /getAttribute\('aria-hidden'\)/);
  assert.match(markedComponentGeometryMeasurementExpression, /Number\(currentStyle\.opacity \|\| 1\) <= 0/);
  assert.match(markedComponentGeometryMeasurementExpression, /clipsAxis\(currentStyle\.overflowX\)/);
  assert.match(markedComponentGeometryMeasurementExpression, /clipsAxis\(currentStyle\.overflowY\)/);
  assert.match(markedComponentGeometryMeasurementExpression, /visibleWidth <= 0 \|\| visibleHeight <= 0/);
  assert.match(markedComponentGeometryMeasurementExpression, /let ancestor = image\.parentElement/);
});

test('compact browser measurement returns component and image geometry without serializing the whole page', () => {
  assert.match(compactComponentGeometryMeasurementExpression, /data-matbox-geometry-key/);
  assert.match(compactComponentGeometryMeasurementExpression, /data-matbox-image-geometry-key/);
  for (const name of IMAGE_GEOMETRY_ATTRIBUTE_NAMES) {
    assert.match(compactComponentGeometryMeasurementExpression, new RegExp(name));
  }
  assert.doesNotMatch(compactComponentGeometryMeasurementExpression, /documentElement\.outerHTML/);
});

test('image geometry enrichment binds every source image to its measured DOM node', () => {
  const source = '<section><picture><img src="/hero.webp" alt="Hero"></picture><img src="/card.webp" loading="lazy"></section>';
  const marked = markImageGeometryTargets(source);
  assert.equal(marked.targets.length, 2);
  assert.match(marked.html, /data-matbox-image-geometry-key="image-geometry-1"/);
  assert.match(marked.html, /data-matbox-image-geometry-key="image-geometry-2"/);

  const values = {
    'intrinsic-width': '2400',
    'intrinsic-height': '1200',
    'rendered-width': '1200',
    'rendered-height': '600',
    'container-width': '1200',
    'container-height': '600',
    visible: 'true',
    'object-fit': 'cover',
    'object-position': '25% 50%',
    viewport: 'desktop',
    'viewport-width': '1908',
    'viewport-height': '1000',
    'overflow-px': '0',
  };
  let measured = marked.html;
  for (const target of marked.targets) {
    const attributes = IMAGE_GEOMETRY_ATTRIBUTE_NAMES
      .map((name) => `${name}="${values[name.replace('data-matbox-image-', '')]}"`)
      .join(' ');
    measured = measured.replace(
      new RegExp(`<img\\b[^>]*data-matbox-image-geometry-key="${target.key}"[^>]*>`),
      (opening) => opening.replace(/>$/, ` ${attributes}>`),
    );
  }

  const enriched = applyMeasuredImageGeometry(source, measured, marked.targets);
  assert.equal(stripImageGeometryEvidence(enriched), source);
  assert.equal((enriched.match(/data-matbox-image-intrinsic-width=/g) || []).length, 2);
  assert.match(enriched, /data-matbox-image-object-fit="cover"/);
  assert.match(enriched, /data-matbox-image-viewport-width="1908"/);
});

test('image geometry enrichment fails closed when count or binding is missing', () => {
  const source = '<section><img src="/one.webp"><img src="/two.webp"></section>';
  const marked = markImageGeometryTargets(source);
  assert.throws(
    () => applyMeasuredImageGeometry(source, marked.html.replace(/<img\b[^>]*image-geometry-2[^>]*>/i, ''), marked.targets),
    /missing measured image geometry/i,
  );
});

test('legacy preflight skips only when every image has complete geometry evidence', () => {
  const completeAttributes = IMAGE_GEOMETRY_ATTRIBUTE_NAMES.map((name) => {
    const value = name.endsWith('-visible') ? 'true'
      : name.endsWith('-object-fit') ? 'cover'
        : name.endsWith('-object-position') ? '50% 50%'
          : name.endsWith('-viewport') ? 'desktop'
            : '100';
    return `${name}="${value}"`;
  }).join(' ');
  assert.equal(hasCompleteImageGeometryEvidence('<section>No images</section>'), true);
  assert.equal(hasCompleteImageGeometryEvidence('<!-- <img src="/commented.webp"> -->'), true);
  assert.equal(hasCompleteImageGeometryEvidence('<img src="/legacy.webp">'), false);
  assert.equal(hasCompleteImageGeometryEvidence(`<img src="/one.webp" ${completeAttributes}>`), true);
  assert.equal(
    hasCompleteImageGeometryEvidence(`<img src="/one.webp" ${completeAttributes}><img src="/two.webp">`),
    false,
  );
});

test('forced geometry enrichment remeasures pages that already have complete evidence', () => {
  const completeAttributes = IMAGE_GEOMETRY_ATTRIBUTE_NAMES.map((name) => {
    const value = name.endsWith('-visible') ? 'true'
      : name.endsWith('-object-fit') ? 'cover'
        : name.endsWith('-object-position') ? '50% 50%'
          : name.endsWith('-viewport') ? 'desktop'
            : '100';
    return `${name}="${value}"`;
  }).join(' ');
  const html = `<section data-matbox-component-width="100"><img src="/one.webp" ${completeAttributes}></section>`;
  assert.equal(shouldSkipGeometryEnrichment(html), true);
  assert.equal(shouldSkipGeometryEnrichment(html, { force: true }), false);
});

test('image targets include only live DOM images, not inert source text', () => {
  const source = [
    '<!-- <img src="/commented.webp"> -->',
    '<script type="application/x-matbox-disabled">const sample = `<img src="/script.webp">`;</script>',
    '<style>.sample{content:"<img src=/style.webp>"}</style>',
    '<template><img src="/template.webp"></template>',
    '<noscript><img src="/noscript.webp"></noscript>',
    '<img src="/live.webp">',
  ].join('');
  const marked = markImageGeometryTargets(source);
  assert.equal(marked.targets.length, 1);
  assert.match(marked.html, /<img src="\/live\.webp" data-matbox-image-geometry-key="image-geometry-1">/);
  assert.doesNotMatch(marked.html, /commented\.webp" data-matbox-image-geometry-key/);
});
