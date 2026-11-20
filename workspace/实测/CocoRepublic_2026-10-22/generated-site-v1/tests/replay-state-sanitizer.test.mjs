import test from 'node:test';
import assert from 'node:assert/strict';
import { hideEmptyCommerceSkeletons, releaseResponsiveFrozenHeights, restoreInteractiveScrollbars, restoreResponsiveAutoSizedCardGridItems, restoreResponsiveFullWidthLayoutBoxes, restoreResponsivePageContainers, stripCaptureRevealStyles } from '../scripts/lib/replay-state-sanitizer.mjs';

test('empty async commerce skeletons are hidden in frozen replay output', () => {
  const html = '<!doctype html><html><head></head><body><div id="searchspring-category" data-matbox-initial-product-count="0" data-matbox-final-product-count="0"><div class="product-grid"><div class="product-card"><div class="product-card-image skeleton">&nbsp;</div></div></div></div><p>Category description</p></body></html>';
  const result = hideEmptyCommerceSkeletons(html);
  assert.match(result, /data-matbox-empty-commerce-skeleton/);
  assert.match(result, /#searchspring-category\[data-matbox-empty-commerce-skeleton\]/);
  assert.match(result, /Category description/);
});

test('real products are not hidden even when stale counters report zero', () => {
  const html = '<!doctype html><html><head></head><body><div id="searchspring-category" data-matbox-initial-product-count="0" data-matbox-final-product-count="0"><article class="product-card"><a href="/products/bed"><h3>Real bed</h3></a></article></div></body></html>';
  assert.equal(hideEmptyCommerceSkeletons(html), html);
});

test('an intentional empty-state message is not hidden', () => {
  const html = '<!doctype html><html><head></head><body><div id="searchspring-category" data-matbox-initial-product-count="0" data-matbox-final-product-count="0"><p class="no-results">No products found</p></div></body></html>';
  assert.equal(hideEmptyCommerceSkeletons(html), html);
});

test('capture-width layout boxes become fluid while genuinely narrower content containers stay fixed', () => {
  const html = '<div data-matbox-frozen-layout-box="true" style="box-sizing:border-box!important;width:1425px !important;height:639px!important"><div data-matbox-frozen-layout-box="true" style="width:1200px !important"></div></div><div data-matbox-frozen-card-grid-box="true" style="width:1440px !important"></div>';
  const result = restoreResponsiveFullWidthLayoutBoxes(html);
  assert.match(result, /width:100% !important[^>]+data-matbox-responsive-full-width="true"/);
  assert.match(result, /data-matbox-responsive-width="fluid"/);
  assert.match(result, /data-matbox-captured-parent-width="1440"/);
  assert.match(result, /data-matbox-width-ratio="0\.989583"/);
  assert.match(result, /width:1200px !important/);
  assert.doesNotMatch(result, /width:1425px !important/);
  assert.doesNotMatch(result, /width:1440px !important/);
});

test('padded full-width component boxes from real 1440 captures become fluid', () => {
  const html = '<div data-matbox-frozen-card-grid-box="true" style="width:1401px !important"></div><div data-matbox-frozen-layout-box="true" style="width:1377px !important"></div>';
  const result = restoreResponsiveFullWidthLayoutBoxes(html, { captureWidth: 1440 });
  assert.doesNotMatch(result, /width:(?:1401|1377)px !important/);
  assert.equal((result.match(/width:100% !important/g) || []).length, 2);
});

test('legacy card-grid widgets fill their parent even when captured below viewport threshold', () => {
  const html = '<div class="card-grid-widget slides-3" data-matbox-frozen-card-grid-box="true" style="width:1166.5px !important"></div><div data-matbox-frozen-layout-box="true" style="width:1166.5px !important"></div>';
  const result = restoreResponsiveFullWidthLayoutBoxes(html, { captureWidth: 1440 });
  assert.match(result, /class="card-grid-widget slides-3"[^>]+width:100% !important/);
  assert.match(result, /data-matbox-frozen-layout-box="true"[^>]+width:1166\.5px !important/);
});

test('auto-sized card-grid items are not constrained by screenshot fallback intrinsic pixels', () => {
  const html = '<html><head></head><body><div class="card-grid-widget slides-8" data-matbox-frozen-card-grid-box="true"><div class="cat-cards"><div class="category-block"><img data-matbox-browser-frozen-image="true"></div></div></div></body></html>';
  const result = restoreResponsiveAutoSizedCardGridItems(html);
  assert.match(result, /data-matbox-responsive-auto-sized-card-grid-items/);
  assert.match(result, /frozen-card-grid-box[^}]+category-block\{width:100%!important\}/);
  assert.match(result, /category-block img\{width:100%!important;height:auto!important\}/);
});

test('legacy frozen flow containers use minimum height so responsive children cannot overlap later sections', () => {
  const html = '<section data-matbox-frozen-main-region="true" style="box-sizing:border-box!important;height:715.422px !important"><div data-matbox-frozen-card-grid-box="true" style="width:100%!important;height:634.734px !important"></div></section><div data-matbox-frozen-layout-box="true" style="height:400px!important"></div>';
  const result = releaseResponsiveFrozenHeights(html);
  assert.match(result, /frozen-main-region[^>]+min-height:715\.422px !important/);
  assert.match(result, /frozen-card-grid-box[^>]+min-height:634\.734px !important/);
  assert.doesNotMatch(result, /frozen-main-region[^>]+(?<!min-)height:/);
  assert.doesNotMatch(result, /frozen-card-grid-box[^>]+(?<!min-)height:/);
  assert.match(result, /frozen-layout-box[^>]+height:400px!important/);
  assert.equal(releaseResponsiveFrozenHeights(result), result);
});

test('explicit responsive metadata wins over legacy viewport-width guessing', () => {
  const html = '<div data-matbox-frozen-layout-box="true" data-matbox-responsive-width="fluid" data-matbox-captured-width="900" data-matbox-captured-parent-width="900" data-matbox-width-ratio="1" style="width:900px !important"></div><div data-matbox-frozen-layout-box="true" data-matbox-responsive-width="constrained" data-matbox-captured-width="1400" data-matbox-captured-parent-width="1400" data-matbox-width-ratio="1" style="width:1400px !important"></div>';
  const result = restoreResponsiveFullWidthLayoutBoxes(html, { captureWidth: 1440 });
  assert.match(result, /data-matbox-responsive-width="fluid"[^>]+width:100% !important/);
  assert.match(result, /data-matbox-responsive-width="constrained"[^>]+width:1400px !important/);
});

test('desktop page containers are released from captured max width', () => {
  const html = '<html><head></head><body><main><div class="container container-plp-landing">Content</div></main></body></html>';
  const result = restoreResponsivePageContainers(html);
  assert.match(result, /data-matbox-responsive-page-containers/);
  assert.match(result, /\.container-plp-landing/);
  assert.match(result, /main \.container:not\(\.top_level_container\)/);
  assert.doesNotMatch(result, /main \.top_level_container/);
  assert.match(result, /\.page-layout-hero-wrap/);
  assert.match(result, /max-width:none!important/);
});

test('capture-only hidden scrollbars are restored in the interactive replay', () => {
  const html = '<html style="overflow:visible auto!important;scrollbar-width:none!important"><head><style data-matbox-live-hidden-scrollbar>html{scrollbar-width:none!important}html::-webkit-scrollbar{display:none!important}</style><style data-matbox-hidden-scrollbar>html{scrollbar-width:none!important}</style></head><body>Page</body></html>';
  const result = restoreInteractiveScrollbars(html);
  assert.doesNotMatch(result, /data-matbox-(?:live-)?hidden-scrollbar/);
  assert.doesNotMatch(result, /scrollbar-width:\s*none/i);
  assert.match(result, /overflow:visible auto!important/);
  assert.match(result, />Page</);
});

test('capture-only forced visibility is removed without deleting real inline styles', () => {
  const html = '<div id="menu" style="display: flex !important; visibility: visible !important; opacity: 1 !important; color: red;"></div><p style="display:block!important;visibility:visible!important;opacity:1!important"></p>';
  const result = stripCaptureRevealStyles(html);
  assert.doesNotMatch(result, /display:\s*(?:block|flex)\s*!important/i);
  assert.doesNotMatch(result, /visibility:\s*visible\s*!important/i);
  assert.doesNotMatch(result, /opacity:\s*1\s*!important/i);
  assert.match(result, /style="color: red;"/);
  assert.doesNotMatch(result, /<p style=/);
});
