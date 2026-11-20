import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { auditedRoutePathname, classifyResponsiveFailures, findDuplicateTextOverlaps, findSectionRightGaps, overlapRatio } from '../scripts/lib/responsive-layout-gate.mjs';

test('responsive readiness compares the pathname when a captured route contains a query', () => {
  assert.equal(auditedRoutePathname('/search.php?search_query=aster'), '/search.php');
  assert.equal(auditedRoutePathname('/dining/'), '/dining');
});

test('an authored centered max-width container is not mistaken for a broken right-side gap', () => {
  const failures = classifyResponsiveFailures({
    width: 2560,
    metrics: {
      scrollWidth: 2560,
      mediaGaps: [],
      primaryContentGap: 0,
      largeRightGaps: [],
      rightGapCandidates: [{
        tag: 'DIV',
        className: 'container container-plp-landing',
        computedMaxWidth: '1808px',
        width: 1808,
        height: 900,
        parent: { width: 2560 },
        parentLeftGap: 376,
        parentRightGap: 376,
        parentWidthRatio: 0.706,
        frozenComponent: false,
      }],
      duplicateOverlaps: [],
    },
  });

  assert.deepEqual(failures, []);
});

test('an asymmetric fixed-width page region fails on a wider viewport', () => {
  const failures = classifyResponsiveFailures({
    width: 2560,
    metrics: {
      scrollWidth: 2560,
      mediaGaps: [],
      primaryContentGap: 0,
      largeRightGaps: [],
      rightGapCandidates: [{
        tag: 'DIV',
        className: 'page-layout',
        computedMaxWidth: '1808px',
        width: 1808,
        height: 900,
        parent: { width: 2560 },
        parentLeftGap: 0,
        parentRightGap: 752,
        parentWidthRatio: 0.706,
        frozenComponent: false,
      }],
      duplicateOverlaps: [],
    },
  });

  assert.deepEqual(failures, ['fixed-page-width:1']);
});

test('normal cards inside a responsive grid do not count as fixed page width', () => {
  const failures = classifyResponsiveFailures({
    width: 1920,
    metrics: {
      scrollWidth: 1920,
      mediaGaps: [],
      primaryContentGap: 0,
      largeRightGaps: [],
      rightGapCandidates: [{
        tag: 'ARTICLE',
        className: 'product-card',
        computedMaxWidth: '420px',
        width: 420,
        height: 500,
        parent: { width: 1800 },
        parentLeftGap: 0,
        parentRightGap: 1380,
        parentWidthRatio: 0.233,
        frozenComponent: false,
      }],
      duplicateOverlaps: [],
    },
  });

  assert.deepEqual(failures, []);
});

test('partial duplicate text collision is measurable below the old 65 percent threshold', () => {
  assert.equal(overlapRatio(
    { left: 0, top: 0, right: 500, bottom: 80, width: 500, height: 80 },
    { left: 350, top: 10, right: 850, bottom: 90, width: 500, height: 80 },
  ) > 0.15, true);
});

test('duplicate text detection finds spatially overlapping copies without comparing unrelated text', () => {
  const items = Array.from({ length: 5000 }, (_, index) => ({
    text: `unique-${index}`,
    rect: { left: 0, right: 100, top: index * 20, bottom: index * 20 + 10, width: 100, height: 10 },
    html: `<span>unique-${index}</span>`,
  }));
  items.push(
    { text: 'sale', rect: { left: 10, right: 110, top: 20, bottom: 50, width: 100, height: 30 }, html: '<span>Sale</span>' },
    { text: 'sale', rect: { left: 20, right: 120, top: 25, bottom: 55, width: 100, height: 30 }, html: '<span>Sale</span>' },
  );
  const overlaps = findDuplicateTextOverlaps(items);
  assert.equal(overlaps.length, 1);
  assert.equal(overlaps[0].text, 'sale');
});

test('section gap detection prefilters unrelated content instead of scanning the whole page for every section', () => {
  let containmentChecks = 0;
  const node = () => ({ contains: () => { containmentChecks += 1; return false; } });
  const contentRects = Array.from({ length: 5000 }, (_, index) => ({
    node: node(),
    rect: { left: 20, right: 420, top: index * 30, bottom: index * 30 + 20, width: 400, height: 20 },
  }));
  contentRects.push(
    { node: node(), rect: { left: 0, right: 700, top: 100, bottom: 500, width: 700, height: 400 } },
    { node: node(), rect: { left: 699, right: 1440, top: 120, bottom: 480, width: 741, height: 360 } },
  );

  const gaps = findSectionRightGaps(contentRects, 1440);

  assert.equal(gaps.length, 0);
  assert.ok(containmentChecks < 10, `expected a prefiltered comparison set, got ${containmentChecks} containment checks`);
});

test('the responsive audit produces named desktop and mobile geometry evidence', async () => {
  const source = await fs.readFile(path.resolve(import.meta.dirname, '..', 'scripts', 'audit-responsive-layout.mjs'), 'utf8');
  assert.match(source, /name:\s*'mobile',\s*width:\s*390,[\s\S]*?mobile:\s*true/);
  assert.match(source, /name:\s*'desktop'/);
  assert.match(source, /viewport:\s*profile\.name/);
  assert.match(source, /mobile:\s*profile\.mobile/);
  assert.match(source, /MATBOX_DIST_DIR/);
  assert.match(source, /MATBOX_AUDIT_TRACE/);
  assert.match(source, /stage:\s*'navigate'/);
  assert.match(source, /stage:\s*'ready'/);
  assert.match(source, /stage:\s*'metrics'/);
  assert.match(source, /Promise\.race\(\[document\.fonts\?\.ready/);
  assert.match(source, /setTimeout\(resolve,\s*1500\)/);
});
