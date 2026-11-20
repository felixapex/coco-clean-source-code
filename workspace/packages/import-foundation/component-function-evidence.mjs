const GENERIC_SOURCE_NAME = /^(?:div|main|p|h[1-6]|section|block|widget|container|wrapper|module|component|top-level-container)(?:[-_].*)?$/i;
const WHOLE_PAGE_CONTAINERS = new Map([
  ['top-level-container', { typeId: 'page-container', displayName: '页面容器' }],
  ['main', { typeId: 'page-main', displayName: '页面主内容' }],
]);

const DEFINITIONS = [
  definition('announcement-bar', '公告栏', ['announcement-bar', 'announcement'], ['announcement-bar', 'announcement', 'marquee']),
  definition('site-header', '站点页头', ['site-header', 'header', 'header-section'], ['site-header', 'header-section', '<header']),
  definition('site-footer', '站点页脚', ['site-footer', 'section-footer', 'footer'], ['site-footer', 'section-footer', 'group-footer', 'data-section-type="footer"', "data-section-type='footer'", '<footer']),
  definition('subscription-popup', '订阅弹窗', ['subscription-popup', 'newsletter-popup'], ['subscription-popup', 'newsletter-popup', 'aria-modal', 'role="dialog"', "role='dialog'", 'type="email"', "type='email'"]),
  definition('email-signup', '邮件订阅', ['email-signup', 'newsletter', 'subscribe'], ['email-signup', 'newsletter', 'type="email"', "type='email'"]),
  definition('cart-drawer', '购物车抽屉', ['cart-drawer', 'cart-drawer-section'], ['cart-drawer', 'mini-cart', 'aria-modal', 'role="dialog"', "role='dialog'"]),
  definition('collection-header', '分类页头', ['plp-header', 'collection-header', 'category-header'], ['plp-header', 'collection-header', 'category-header']),
  definition('breadcrumbs', '面包屑导航', ['breadcrumbs', 'breadcrumb'], ['breadcrumbs', 'aria-label="breadcrumb"', "aria-label='breadcrumb'"]),
  definition('promotion-strip', '促销信息条', ['subcategory-below-description-global', 'promotion-strip', 'promo-strip'], ['subcategory-below-description', 'promotion-strip', 'promo-strip', 'instock-strip']),
  definition('hero-banner', '首屏横幅', ['hero-banner', 'hero', 'image-banner'], ['hero-banner', 'image-banner', 'banner-media', 'hero__media']),
  definition('video-banner', '视频首屏', ['hero-banner-video', 'video-banner', 'video-hero'], ['hero-banner-video', 'video-banner', '<video', 'video-hero', 'hero-widget', 'home-hero']),
  definition('slideshow', '轮播横幅', ['slideshow', 'carousel', 'slider'], ['slideshow', 'carousel', 'swiper', 'splide', 'slide', 'previous slide', 'next slide']),
  definition('featured-collection', '精选商品系列', ['featured-collection'], ['featured-collection', 'product-card', 'product-grid']),
  definition('product-grid', '商品网格', ['product-grid', 'featured-products', 'searchspring-search'], ['product-grid', 'product-card', 'product-item', 'featured-products', 'searchspring']),
  definition('sticky-add-to-cart', '悬浮加购条', ['sticky-add', 'sticky-add-to-cart'], ['sticky-add', 'add-to-cart']),
  definition('product-detail', '商品详情', ['product-detail', 'product-view', 'main-product', 'product-information'], ['product-detail', 'productview', 'product-info', 'product-form', 'add-to-cart']),
  definition('product-recommendations', '商品推荐', ['product-recommendations', 'section-product-recommendations', 'recently-viewed'], ['product-recommendations', 'recently-viewed', 'product-card']),
  definition('collection-list', '商品系列列表', ['collection-list', 'shop-by-collection', 'selection'], ['collection-list', 'collection-card', 'shop-by-collection', 'selection-card', 'card-grid-widget', 'cat-cards', 'category-block']),
  definition('product-bundle', '组合商品', ['product-bundle', 'bundle'], ['product-bundle', 'bundle-item', 'bundle-product']),
  definition('image-with-text', '图文并排', ['image-with-text', 'text-with-image', 'media-with-content'], ['image-with-text', 'text-with-image', 'media-with-content']),
  definition('rich-text', '富文本', ['rich-text', 'rich-content', 'manifesto', 'category-description-bottom', 'full-plp-bottom', 'blog-intro', 'page-content'], ['rich-text', 'rich-content', 'rte', 'category-description-bottom', 'full-plp-bottom', 'blog-intro', 'page-content']),
  definition('heading', '标题', ['heading', 'page-heading'], ['page-heading', '<h1', '<h2', '<h3']),
  definition('text', '正文文字', ['text', 'paragraph', 'u-text-align-center', 'p'], ['u-textaligncenter', 'paragraph', '<p']),
  definition('multicolumn', '多列内容', ['multicolumn', 'multi-column'], ['multicolumn', 'multi-column', 'feature-card', 'offer-widget', 'offers', 'class="offer"', "class='offer'"]),
  definition('testimonial', '客户评价', ['testimonial', 'testimonials'], ['testimonial', 'review-card', 'quote-card', '<blockquote']),
  definition('featured-blog', '精选博客', ['featured-blog', 'blog-posts'], ['featured-blog', 'article-card', 'blog-card']),
  definition('editorial-grid', '编辑内容网格', ['editorial-grid', 'editorial-row'], ['editorial-row', 'editorial-block']),
  definition('video', '视频', ['video', 'inline-video'], ['inline-video', 'video-viewport', '<video']),
  definition('job-listings', '招聘职位列表', ['job-listings', 'job-search'], ['ja-job-search', 'ja-job-list', 'class="job"', "class='job'"]),
  definition('application-form', '申请表单', ['application-form'], ['bccomplexobject', 'bcform', 'blueconictextarea']),
  definition('loading-state', '加载状态', ['loading-state', 'lookup-hidden'], ['lookup-hidden', 'loader', 'processing']),
  definition('wishlist-empty-state', '空愿望单提示', ['wishlist-empty-state'], ['wishlist is currently empty', 'continue shopping']),
  definition('image-comparison', '图片对比', ['image-comparison', 'before-after'], ['image-comparison', 'before-after', 'comparison-slider']),
  definition('editorial-scroll', '滚动图文画廊', ['editorial-scroll', 'lifestyle-scroll'], ['editorial-scroll', 'editorial-card', 'data-editorial-scroll']),
  definition('social-media-collage', '社交媒体拼图', ['social-media-collage'], ['social-media-collage', 'smc-card', 'instagram']),
  definition('ticker', '滚动文字', ['ticker'], ['ticker', 'marquee']),
  definition('collapsible-content', '折叠内容', ['collapsible-content', 'faq', 'accordion'], ['collapsible-content', 'accordion', '<details', '<summary']),
  definition('search-form', '搜索表单', ['search-form'], ['search-form', 'search.php', 'type="search"', "type='search'"]),
  definition('contact-form', '联系表单', ['contact-form'], ['contact-form', '<textarea', 'name="message"', "name='message'"]),
  definition('search-results', '搜索结果', ['search-results', 'searchspring-search'], ['search-results', 'searchspring', 'type="search"', "type='search'"]),
  definition('pagination', '分页导航', ['pagination'], ['pagination', 'previous page', 'next page']),
  definition('timeline', '时间轴', ['timeline', 'process-timeline'], ['timeline', 'timeline-item', 'timeline-step']),
  definition('specifications', '规格参数', ['specifications', 'product-specifications'], ['specifications', 'specification-item', 'spec-table']),
  definition('alert-modal', '提示弹窗', ['alert-modal'], ['alert-modal', 'modal--alert', 'alert-icon']),
  definition('toast-notification', '通知提示', ['booking-toast', 'toast-notification'], ['booking-toast', 'role="status"', "role='status'"]),
  definition('cart-empty-state', '空购物车提示', ['cart-empty', 'panel'], ['your cart is empty', 'continue shopping']),
  definition('modal', '通用弹窗', ['modal', 'panel'], ['modal', 'aria-modal', 'role="dialog"', "role='dialog'"]),
  definition('spacer', '间距', ['spacer'], ['spacer']),
  definition('logo', '品牌标志', ['logo'], ['logo', 'site-logo']),
];

function definition(typeId, displayName, sourceAliases, markupTokens) {
  return {
    typeId,
    displayName,
    sourceAliases,
    markupTokens,
  };
}

function normalize(value) {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function sourceMatches(sourceName, alias) {
  return sourceName === alias || sourceName.startsWith(`${alias}-`) || sourceName.startsWith(`section-${alias}`);
}

function sourceMatchSpecificity(sourceName, aliases) {
  return Math.max(0, ...aliases.map((alias) => {
    if (sourceName === alias) return 1000 + alias.length;
    if (sourceName.startsWith(`${alias}-`)) return alias.length;
    if (sourceName.startsWith(`section-${alias}`)) return alias.length;
    return 0;
  }));
}

function structuralMarkup(markup) {
  return [...String(markup ?? '').matchAll(/<[^>]+>/g)]
    .map((match) => match[0].toLowerCase().replaceAll('_', '-'))
    .join(' ');
}

function rootOpening(markup) {
  return String(markup ?? '').match(/<[^>]+>/)?.[0]?.toLowerCase().replaceAll('_', '-') ?? '';
}

function containsToken(haystack, token) {
  return haystack.includes(token.toLowerCase());
}

function pageShellDetected(structure) {
  return /<header\b/.test(structure) && /<main\b/.test(structure) && /<footer\b/.test(structure);
}

export function inferComponentFunctionEvidence(input) {
  const sourceComponentName = normalize(input?.sourceComponentName);
  const markup = String(input?.sourceMarkup ?? '');
  const structure = structuralMarkup(markup);
  const root = rootOpening(markup);
  const genericSource = !sourceComponentName || GENERIC_SOURCE_NAME.test(sourceComponentName);

  const visibleText = markup
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/(?:\bmodal--alert\b|\bid=["']alert-modal["']|\balert-icon\b)/i.test(structure)) {
    return directEvidence('提示弹窗', 'alert-modal', 'alert-dialog-markup');
  }
  if (/(?:\bcococlub-form\b|\bcococlub-form-wrap\b|\bclub-sign-up\b)/i.test(`${structure} ${markup}`)) {
    return directEvidence('邮件订阅', 'email-signup', 'embedded-club-signup');
  }
  if (sourceComponentName === 'panel' && /your cart is empty/i.test(visibleText)) {
    return directEvidence('空购物车提示', 'cart-empty-state', 'empty-cart-copy');
  }
  if (genericSource && /(?:\bid=["']sd-image-|\bclass=["'][^"']*\bsd-image-)/i.test(structure)) {
    return directEvidence('图片', 'image', 'page-builder-image');
  }
  if (genericSource && /(?:sd-simple-button|\bbuttonlink\b)/i.test(structure)) {
    return directEvidence('按钮', 'button', 'page-builder-button');
  }
  if (genericSource && /(?:widget-cta-image|cta-column)/i.test(structure)) {
    return directEvidence('图文并排', 'image-with-text', 'page-builder-image-with-text');
  }
  if (genericSource && /(?:\bwidget-panels\b|\boffer-widget\b|\bclass=["'][^"']*\boffers\b)/i.test(structure)) {
    return directEvidence('多列内容', 'multicolumn', 'page-builder-panels');
  }
  if (genericSource && /(?:hero-widget|inner-hero|home-hero|page-layout-hero|hero-section)/i.test(structure)) {
    return /<video\b/i.test(markup)
      ? directEvidence('视频首屏', 'video-banner', 'page-builder-video-hero')
      : directEvidence('首屏横幅', 'hero-banner', 'page-builder-hero');
  }
  if (/(?:\bclp-header\b|\bcr-clp-header-)/i.test(structure)) {
    return directEvidence('分类页头', 'collection-header', 'collection-landing-header');
  }
  if (/\binstock-strip\b/i.test(structure)) {
    return directEvidence('促销信息条', 'promotion-strip', 'instock-promotion-strip');
  }
  if (/\beditorial-row\b/i.test(structure) && /\beditorial-block\b/i.test(structure)) {
    return directEvidence('编辑内容网格', 'editorial-grid', 'editorial-row-grid');
  }
  if (/(?:\binline-video-|\bvideo-viewport\b)/i.test(structure)) {
    return directEvidence('视频', 'video', 'inline-video');
  }
  if (/\bcr-video-wrap-/i.test(structure) && /(?:\bvideo-widget-|data-matbox-frozen-iframe)/i.test(structure)) {
    return directEvidence('视频', 'video', 'frozen-embedded-video');
  }
  if (/#player-/i.test(markup) && /data-matbox-frozen-iframe/i.test(markup)) {
    return directEvidence('视频', 'video', 'frozen-player-frame');
  }
  if (/\bja-job-search\b/i.test(structure) && /\bja-job-list\b/i.test(structure)) {
    return directEvidence('招聘职位列表', 'job-listings', 'job-search-list');
  }
  if (/(?:\bbccomplexobject\b|\bbcform\b)/i.test(structure)) {
    return directEvidence('申请表单', 'application-form', 'structured-application-form');
  }
  if (/\bdesign-application-form\b/i.test(structure)) {
    return directEvidence('设计预约表单', 'appointment-form', 'design-appointment-form');
  }
  if (sourceComponentName === 'lookup-hidden' && /processing/i.test(visibleText)) {
    return directEvidence('加载状态', 'loading-state', 'processing-loader');
  }
  if (sourceComponentName === 'panel' && /wishlist is currently empty/i.test(visibleText)) {
    return directEvidence('空愿望单提示', 'wishlist-empty-state', 'empty-wishlist-copy');
  }
  if (/\bhero-wrapper\b/i.test(root) && /\bhero-+media\b/i.test(structure)) {
    return directEvidence('首屏横幅', 'hero-banner', 'shopify-hero-wrapper');
  }
  if (/\bcustom-section-content\b/i.test(structure)
    && /\bimage-block(?:-+image)?\b/i.test(structure)
    && /\btext-block\b/i.test(structure)) {
    return directEvidence('图文并排', 'image-with-text', 'custom-image-text-section');
  }
  if (/(?:\bcard-slider-header-wrap\b|\bclp-grid\b)/i.test(structure)
    && /(?:\bcard-grid-widget\b|\bshop-block\b|\bclp-tile\b|\bclp-cat-name\b)/i.test(structure)) {
    return directEvidence('商品系列列表', 'collection-list', 'category-card-list');
  }
  if (/\bpeace-of-mind-banner\b/i.test(structure) && /<picture\b/i.test(markup)) {
    return directEvidence('图片横幅', 'image-banner', 'linked-picture-banner');
  }
  const hasMediaOrControl = /<(?:img|picture|video|audio|iframe|canvas|svg|input|button|select|textarea|form)\b/i.test(markup);
  const repeatedCardLinks = (markup.match(/<a\b/gi)?.length ?? 0) >= 2
    && /(?:card-grid-widget|cat-cards|category-block|collection-card|selection-card)/i.test(structure);
  if (genericSource && visibleText.length > 0 && !hasMediaOrControl && !repeatedCardLinks) {
    if (/<h[1-6]\b/i.test(markup) && /<p\b/i.test(markup)) return directEvidence('富文本', 'rich-text', 'page-builder-rich-text');
    if (/<h[1-6]\b/i.test(markup) && !/<p\b/i.test(markup)) return directEvidence('标题', 'heading', 'page-builder-heading');
    return directEvidence('正文文字', 'text', 'page-builder-text');
  }
  const spacerOnly = GENERIC_SOURCE_NAME.test(sourceComponentName)
    && /(?:^|[-_])spacer(?:[-_]|$)/i.test(structure)
    && visibleText.length === 0
    && !/<(?:img|video|iframe|canvas|svg|input|button|form)\b/i.test(markup);
  if (spacerOnly) {
    return {
      actualFunctionName: '间距',
      actualFunctionTypeId: 'spacer',
      acceptedAliases: [],
      evidenceConfidence: 0.88,
      ambiguityReason: null,
      nameDecisionEvidence: [{ kind: 'markup', value: 'spacer-only' }],
    };
  }
  const backgroundImageOnly = GENERIC_SOURCE_NAME.test(sourceComponentName)
    && visibleText.length === 0
    && /background-image\s*:[^;}]*url\(\s*["']?[^"')\s][^)]*\)/i.test(markup)
    && !/<(?:img|picture|video|audio|iframe|canvas|svg|input|button|select|textarea|form|a)\b/i.test(markup);
  if (backgroundImageOnly) {
    return {
      actualFunctionName: '图片横幅',
      actualFunctionTypeId: 'image-banner',
      acceptedAliases: [],
      evidenceConfidence: 0.88,
      ambiguityReason: null,
      nameDecisionEvidence: [{ kind: 'markup', value: 'css-background-image-only' }],
    };
  }

  if (GENERIC_SOURCE_NAME.test(sourceComponentName) && pageShellDetected(structure)) {
    return {
      actualFunctionName: '页面容器',
      actualFunctionTypeId: 'page-container',
      acceptedAliases: [],
      evidenceConfidence: 0.35,
      ambiguityReason: 'multiple-component-functions-detected',
      nameDecisionEvidence: [{ kind: 'ambiguity', value: 'header+main+footer' }],
    };
  }

  const wholePageContainer = WHOLE_PAGE_CONTAINERS.get(sourceComponentName);
  if (wholePageContainer) {
    return {
      actualFunctionName: wholePageContainer.displayName,
      actualFunctionTypeId: wholePageContainer.typeId,
      acceptedAliases: [],
      evidenceConfidence: 0.35,
      ambiguityReason: 'whole-page-container',
      nameDecisionEvidence: [{ kind: 'container-boundary', value: sourceComponentName }],
    };
  }

  const scored = DEFINITIONS.map((item) => {
    const nameMatched = item.sourceAliases.some((alias) => sourceMatches(sourceComponentName, alias));
    const rootHits = item.markupTokens.filter((token) => containsToken(root, token));
    const allMarkupHits = item.markupTokens.filter((token) => containsToken(structure, token));
    const markupHits = item.typeId === 'spacer' && !nameMatched ? rootHits : allMarkupHits;
    return {
      ...item,
      nameMatched,
      rootHits,
      markupHits,
      nameSpecificity: sourceMatchSpecificity(sourceComponentName, item.sourceAliases),
      score: (nameMatched ? 2 : 0) + rootHits.length * 4 + markupHits.length * 1.5,
    };
  }).filter((item) => item.markupHits.length > 0 || item.nameMatched)
    .sort((left, right) => right.score - left.score || right.rootHits.length - left.rootHits.length);

  const sourceSupported = scored.filter((item) => item.nameMatched && item.markupHits.length > 0)
    .sort((left, right) => right.nameSpecificity - left.nameSpecificity || right.score - left.score);
  const winner = sourceSupported[0] ?? scored[0];
  if (!winner || winner.markupHits.length === 0) {
    return {
      actualFunctionName: '通用容器',
      actualFunctionTypeId: 'generic-container',
      acceptedAliases: [],
      evidenceConfidence: 0.3,
      ambiguityReason: 'insufficient-functional-evidence',
      nameDecisionEvidence: [],
    };
  }

  const runnerUp = scored[1];
  const sourceIsGeneric = genericSource;
  if (sourceIsGeneric && runnerUp && runnerUp.score === winner.score && runnerUp.markupHits.length > 0) {
    return {
      actualFunctionName: '待核对组件',
      actualFunctionTypeId: 'ambiguous-component',
      acceptedAliases: [],
      evidenceConfidence: 0.4,
      ambiguityReason: 'multiple-component-functions-detected',
      nameDecisionEvidence: [winner.typeId, runnerUp.typeId].map((value) => ({ kind: 'candidate', value })),
    };
  }

  let evidenceConfidence = 0.72;
  if (winner.rootHits.length > 0 && winner.nameMatched) evidenceConfidence = 0.97;
  else if (winner.rootHits.length > 0) evidenceConfidence = 0.88;
  else if (winner.markupHits.length >= 2 && winner.nameMatched) evidenceConfidence = 0.93;
  else if (winner.markupHits.length >= 1 && winner.nameMatched) evidenceConfidence = 0.9;
  else if (winner.markupHits.length >= 3) evidenceConfidence = 0.86;
  else if (winner.markupHits.length >= 2) evidenceConfidence = 0.82;
  else if (winner.nameMatched) evidenceConfidence = 0.76;
  else evidenceConfidence = 0.62;

  return {
    actualFunctionName: winner.displayName,
    actualFunctionTypeId: winner.typeId,
    acceptedAliases: winner.nameMatched ? [sourceComponentName] : [],
    evidenceConfidence,
    ambiguityReason: null,
    nameDecisionEvidence: [
      ...(winner.nameMatched ? [{ kind: 'source-name', value: sourceComponentName }] : []),
      ...winner.rootHits.map((value) => ({ kind: 'root-markup', value })),
      ...winner.markupHits.map((value) => ({ kind: 'markup', value })),
    ],
  };
}

function directEvidence(actualFunctionName, actualFunctionTypeId, value) {
  return {
    actualFunctionName,
    actualFunctionTypeId,
    acceptedAliases: [],
    evidenceConfidence: 0.95,
    ambiguityReason: null,
    nameDecisionEvidence: [{ kind: 'markup', value }],
  };
}

