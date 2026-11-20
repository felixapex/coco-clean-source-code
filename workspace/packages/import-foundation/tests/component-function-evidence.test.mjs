import assert from 'node:assert/strict';
import test from 'node:test';

import { inferComponentFunctionEvidence } from '../component-function-evidence.mjs';

test('identifies a hero banner only when the source name and markup support the same function', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'hero_banner',
    sourceMarkup: '<section class="hero-banner"><picture><img src="hero.jpg"></picture><h1>New collection</h1><a class="button" href="/products">Shop</a></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'hero-banner');
  assert.equal(evidence.actualFunctionName, '首屏横幅');
  assert.ok(evidence.evidenceConfidence >= 0.9);
  assert.ok(evidence.nameDecisionEvidence.some((item) => item.kind === 'markup'));
});

test('identifies a slideshow from carousel structure and controls', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'slideshow',
    sourceMarkup: '<section class="slideshow carousel"><div class="slide"></div><div class="slide"></div><button aria-label="Previous slide"></button><button aria-label="Next slide"></button></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'slideshow');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('uses observed form behavior when the source name is generic', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'section-23369189458141',
    sourceMarkup: '<section><form class="contact-form"><input name="email"><textarea name="message"></textarea><button type="submit">Send</button></form></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'contact-form');
  assert.equal(evidence.actualFunctionName, '联系表单');
  assert.ok(evidence.evidenceConfidence >= 0.8);
});

test('prefers strong dialog evidence over a conflicting source name', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'footer',
    sourceMarkup: '<aside role="dialog" aria-modal="true" class="subscription-popup"><form><input type="email"><button>Subscribe</button></form></aside>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'subscription-popup');
  assert.ok(evidence.evidenceConfidence >= 0.8);
  assert.ok(!evidence.acceptedAliases.includes('footer'));
});

test('keeps an ambiguous generic container below the automatic naming threshold', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'top-level-container',
    sourceMarkup: '<div class="page"><header class="site-header"></header><main><section class="hero-banner"></section></main><footer class="site-footer"></footer></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'page-container');
  assert.ok(evidence.evidenceConfidence < 0.7);
  assert.equal(evidence.ambiguityReason, 'multiple-component-functions-detected');
});

test('keeps an empty generic element below the automatic naming threshold', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'generic-container');
  assert.ok(evidence.evidenceConfidence < 0.7);
});

test('never promotes a known whole-page container from one nested product grid', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'top-level-container',
    sourceMarkup: '<div class="page"><main><div class="product-grid"><article class="product-card"></article></div></main></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'page-container');
  assert.ok(evidence.evidenceConfidence < 0.7);
  assert.equal(evidence.ambiguityReason, 'whole-page-container');
});

test('never promotes a main page wrapper from a nested slideshow', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'main',
    sourceMarkup: '<main><section class="slideshow"><div class="slide"></div><button aria-label="Next slide"></button></section></main>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'page-main');
  assert.ok(evidence.evidenceConfidence < 0.7);
  assert.equal(evidence.ambiguityReason, 'whole-page-container');
});

test('keeps a site header type when the header contains a nested cart drawer', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'header',
    sourceMarkup: '<header class="site-header"><nav></nav><aside class="cart-drawer" role="dialog"></aside></header>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'site-header');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('keeps a site footer type when the footer contains nested collapsible menus', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'footer',
    sourceMarkup: '<footer class="site-footer"><details class="accordion"><summary>Help</summary></details></footer>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'site-footer');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('uses the more specific video banner type instead of its hero prefix', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'hero-banner-video',
    sourceMarkup: '<section class="hero-banner-video"><video autoplay muted></video><h1>Collection</h1></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'video-banner');
});

test('keeps featured products as a product grid even when its cards use a carousel', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'featured-products',
    sourceMarkup: '<section class="featured-products"><div class="carousel"><article class="product-card"></article><button aria-label="Next slide"></button></div></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'product-grid');
});

test('keeps a product detail component when its media gallery is a carousel', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'product-view',
    sourceMarkup: '<div class="productView"><div class="carousel"><img src="product.jpg"><button aria-label="Next slide"></button></div><form class="product-form"><button class="add-to-cart">Buy</button></form></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'product-detail');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('recognizes sticky add to cart independently from nested product card markup', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'sticky-add',
    sourceMarkup: '<div id="sticky-add"><div class="product-card"><button class="add-to-cart">Add to cart</button></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'sticky-add-to-cart');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('normalizes Shopify underscore ids when corroborating a video banner', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'hero-banner-video',
    sourceMarkup: '<section id="shopify-section-template__hero_banner_video" class="shopify-section--hero-banner"><div class="hero__media"></div></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'video-banner');
});

test('corroborates featured products from the root section class', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'featured-products',
    sourceMarkup: '<section id="shopify-section-template__featured_products" class="section-featured-products"><div class="grid-slider"><article></article></div></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'product-grid');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('corroborates a footer carried by a div section wrapper', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'footer',
    sourceMarkup: '<div id="shopify-section-sections__footer" class="shopify-section-group-footer-group" data-section-type="footer"><details><summary>Help</summary></details></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'site-footer');
});

test('keeps alert dialogs distinct from generic modal components', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'alert-modal',
    sourceMarkup: '<div id="alert-modal" class="modal modal--alert"><div class="alert-icon"></div><button>OK</button></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'alert-modal');
  assert.equal(evidence.actualFunctionName, '提示弹窗');
});

test('recognizes a selection-card grid as a collection list', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'selection',
    sourceMarkup: '<section class="section-selection"><article class="selection-card"><a href="/collections/dining">View Collection</a></article></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'collection-list');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('recognizes editorial scroll cards as their own functional component', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'editorial-scroll',
    sourceMarkup: '<section class="editorial-scroll-section"><div data-editorial-scroll><article class="editorial-scroll__card"></article></div></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'editorial-scroll');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('recognizes a social media collage instead of its nested heading header', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'social-media-collage',
    sourceMarkup: '<section class="section-social-media-collage"><header class="section__header"></header><div class="section-social-media-collage__grid"></div></section>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'social-media-collage');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('recognizes a collection header from a PLP header with collection navigation', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'plp-header',
    sourceMarkup: '<div id="plp-header" class="has-image"><nav class="breadcrumbs">Home / Sofas</nav><img src="sofas.jpg"><h1>Standard Sofas</h1><a href="/sofas/fabric">Fabric Sofas</a></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'collection-header');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('recognizes a promotional strip from its source region and CTA', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'subcategory-below-description-global',
    sourceMarkup: '<div class="subcategory-below-description--global"><div class="instock-strip"><strong>Ready for Christmas</strong><a href="/in-stock">Shop available now</a></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'promotion-strip');
  assert.ok(evidence.evidenceConfidence >= 0.9);
});

test('does not classify a content layout as a spacer because it contains an internal spacer widget', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div data-layout-id="layout"><div class="sd-spacer-123"></div><div class="offer-widget"><article class="offer">Design service</article><article class="offer">Trade program</article></div></div>',
  });

  assert.notEqual(evidence.actualFunctionTypeId, 'spacer');
});

test('recognizes a generic page-builder video hero from functional classes', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div data-layout-id="layout"><div class="hero-widget home-hero"><video autoplay muted></video><div class="slides-8"><a>Collection</a></div></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'video-banner');
});

test('recognizes a category card grid as a collection list', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div data-layout-id="layout"><div class="card-grid-widget cat-cards"><a class="category-block" href="/sofas">Sofas</a><a class="category-block" href="/bedroom">Bedroom</a></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'collection-list');
});

test('recognizes an offer card group as multicolumn content', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div data-layout-id="layout"><div class="offer-widget offers"><article class="offer">Design services</article><article class="offer">Trade program</article></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'multicolumn');
});

test('recognizes pagination and collection description sections', () => {
  const pagination = inferComponentFunctionEvidence({
    sourceComponentName: 'pagination',
    sourceMarkup: '<nav class="pagination"><a aria-label="Previous page">Previous</a><a aria-label="Next page">Next</a></nav>',
  });
  const description = inferComponentFunctionEvidence({
    sourceComponentName: 'category-description-bottom',
    sourceMarkup: '<div class="category-description-bottom"><p>Explore the complete collection.</p></div>',
  });

  assert.equal(pagination.actualFunctionTypeId, 'pagination');
  assert.equal(description.actualFunctionTypeId, 'rich-text');
});

test('recognizes a standalone page heading', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'page-heading',
    sourceMarkup: '<h1 class="page-heading">My account</h1>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'heading');
});

test('keeps breadcrumb navigation distinct from a collection header', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'nav',
    sourceMarkup: '<nav aria-label="Breadcrumb"><ol class="breadcrumbs"><li>Home</li><li>Error</li></ol></nav>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'breadcrumbs');
});

test('recognizes a search form instead of treating every form as a contact form', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'form',
    sourceMarkup: '<form class="form" action="/search.php"><label>Search keyword</label><input type="search"><button>Search</button></form>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'search-form');
});

test('recognizes standalone explanatory text', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'u-text-align-center',
    sourceMarkup: '<p class="u-textAlignCenter">The page has moved.</p>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'text');
});

test('recognizes a page-builder layout containing only a spacer as a spacer', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div data-layout-id="layout"><div class="sd-spacer-123"></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'spacer');
});

test('recognizes an unnamed page-builder widget containing only a spacer as a spacer', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'widget',
    sourceMarkup: '<div data-widget-id="example"><style>.sd-spacer-example{height:4px}</style><div class="sd-spacer-example"></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'spacer');
});

test('recognizes page-builder image, button, image-with-text, panel, and hero widgets by their functional markup', () => {
  const cases = [
    ['<div data-widget-id="image"><div id="sd-image-image"><img src="x.jpg"></div></div>', 'image'],
    ['<div data-widget-id="button"><div class="sd-button-button"><a id="sd-simple-button-editable-button" role="button">Shop</a></div></div>', 'button'],
    ['<div data-widget-id="cta"><div class="widget-cta-image"><div class="text-wrap"><h2>Story</h2></div><div class="image-wrap"><img src="x.jpg"></div></div></div>', 'image-with-text'],
    ['<div data-widget-id="panels"><div class="widget-panels two-panels"><div class="panel">One</div><div class="panel">Two</div></div></div>', 'multicolumn'],
    ['<div data-widget-id="hero"><div class="hero-widget inner-hero"><img src="x.jpg"><h1>Title</h1></div></div>', 'hero-banner'],
    ['<div data-widget-id="video"><div class="hero-widget home-hero"><video></video><h1>Title</h1></div></div>', 'video-banner'],
  ];
  for (const [sourceMarkup, expected] of cases) {
    const evidence = inferComponentFunctionEvidence({ sourceComponentName: 'widget', sourceMarkup });
    assert.equal(evidence.actualFunctionTypeId, expected);
  }
});

test('recognizes unnamed page-builder prose widgets as editable text instead of ambiguous containers', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'widget',
    sourceMarkup: '<div data-widget-id="copy"><h2>Materials</h2><p>Crafted for everyday use.</p></div>',
  });
  assert.equal(evidence.actualFunctionTypeId, 'rich-text');
});

test('recognizes linked rich text, CTA columns, empty cart panels, and status toasts', () => {
  const cases = [
    ['widget', '<div data-widget-id="copy"><p>Read the <a href="/guide">guide</a>.</p></div>', 'text'],
    ['widget', '<div data-widget-id="column"><div class="cta-column__content"><img class="cta-column__image"><p>Description</p></div></div>', 'image-with-text'],
    ['panel', '<div class="panel"><p>Your cart is empty.</p><a>Continue shopping</a></div>', 'cart-empty-state'],
    ['booking-toast', '<div class="booking-toast" role="status" aria-live="polite"></div>', 'toast-notification'],
  ];
  for (const [sourceComponentName, sourceMarkup, expected] of cases) {
    assert.equal(inferComponentFunctionEvidence({ sourceComponentName, sourceMarkup }).actualFunctionTypeId, expected);
  }
});

test('specific homepage function evidence overrides a generic source wrapper name', () => {
  const cases = [
    ['modal', '<div id="alert-modal" class="modal modal--alert"><div class="alert-icon"></div><button>OK</button></div>', 'alert-modal'],
    ['light-grey-full', '<div id="cococlub-form-wrap" class="light-grey-full"><form class="cococlub-form"><p>Join our home club</p><a href="/club-sign-up"><input value="Sign Up"></a></form></div>', 'email-signup'],
  ];
  for (const [sourceComponentName, sourceMarkup, expected] of cases) {
    assert.equal(inferComponentFunctionEvidence({ sourceComponentName, sourceMarkup }).actualFunctionTypeId, expected);
  }
});

test('recognizes remaining Coco functional families from observed markup', () => {
  const cases = [
    ['widget', '<div class="cr-clp-header-x clp-header"><div class="desk-image"></div><a href="/beds">Beds</a><a href="/dressers">Dressers</a></div>', 'collection-header'],
    ['widget', '<div class="instock-strip"><span class="instock-strip__title">Ready for Christmas</span><a class="instock-strip__cta">Shop now</a></div>', 'promotion-strip'],
    ['widget', '<div class="editorial-row grid-1-1-1"><article class="editorial-block"><h3>Story</h3><p>Copy</p></article><article class="editorial-block"><h3>Story two</h3></article></div>', 'editorial-grid'],
    ['widget', '<div class="cr-video-wrap-x"><div class="inline-video-x video-viewport"><video controls></video></div></div>', 'video'],
    ['widget', '<div id="video-widget-x" class="cr-video-wrap-x"><div class="container-x"><img data-matbox-frozen-iframe="true" src="/frame.png"></div></div>', 'video'],
    ['widget', '<div class="container-x"><style>#player-x{position:absolute}</style><img data-matbox-frozen-iframe="true" src="/frame.png"></div>', 'video'],
    ['widget', '<div class="ja-job-search"><form class="ja-form"></form><div class="ja-job-list"><article class="job"><h3 class="title">Designer</h3></article></div></div>', 'job-listings'],
    ['widget', '<div class="bccomplexobject bcForm"><form><input name="firstName"><textarea name="message"></textarea><button>Apply</button></form></div>', 'application-form'],
    ['widget', '<form id="design-application-form" class="form design-form"><p class="form-title">Register For A Design Appointment</p><input name="firstName"><button>Book</button></form>', 'appointment-form'],
    ['lookup-hidden', '<div id="loading-test" class="lookup-hidden loader">Processing...</div>', 'loading-state'],
    ['panel', '<div class="panel">Your wishlist is currently empty. <a href="/">Continue shopping</a></div>', 'wishlist-empty-state'],
    ['hero-vcxett', '<section class="shopify-section hero-wrapper section-wrapper"><div class="hero"><div class="hero__media"><img src="/hero.jpg"></div><h1>Services</h1></div></section>', 'hero-banner'],
    ['section-f-bnwkh', '<section class="shopify-section section-wrapper"><div class="custom-section-content"><div class="image-block"><img class="image-block__image" src="/service.jpg"></div><div class="group-block"><div class="text-block"><h2>Discovery call</h2><p>We begin with a conversation.</p></div></div></div></section>', 'image-with-text'],
    ['widget', '<div class="card-slider-header-wrap"><div class="card-grid-widget shop-cards"><a class="shop-block">Sofas</a><a class="shop-block">Living</a></div></div>', 'collection-list'],
    ['widget', '<div class="clp-grid"><a class="clp-tile"><span class="clp-cat-name">Sofas</span></a><a class="clp-tile"><span class="clp-cat-name">Living</span></a></div>', 'collection-list'],
    ['widget', '<div class="peace-of-mind-banner"><a class="peace-of-mind-link"><picture><img src="/peace.jpg"></picture></a></div>', 'image-banner'],
  ];

  for (const [sourceComponentName, sourceMarkup, expected] of cases) {
    const evidence = inferComponentFunctionEvidence({ sourceComponentName, sourceMarkup });
    assert.equal(evidence.actualFunctionTypeId, expected, `${sourceComponentName} should be ${expected}`);
  }
});

test('recognizes a CSS background-only page-builder region as an image banner', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'div',
    sourceMarkup: '<div data-layout-id="layout"><style>[data-layout-id="layout"]::after { background-image: url("image.jpg"); background-size: cover; }</style><div data-sub-layout="column"></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'image-banner');
});

test('recognizes a PLP landing container as the product grid it contains', () => {
  const evidence = inferComponentFunctionEvidence({
    sourceComponentName: 'container-plp-landing',
    sourceMarkup: '<div class="container container-plp-landing"><div class="ss-facets"></div><div id="searchspring-category"><article class="product-card"></article></div></div>',
  });

  assert.equal(evidence.actualFunctionTypeId, 'product-grid');
});
