import { browserImageReadinessPolicySource } from './image-readiness-policy.mjs';

const imageReadinessPolicySource = browserImageReadinessPolicySource();

export const stableStateExpression = `(async () => {
  const shouldPromoteDeferredImage = ${imageReadinessPolicySource};
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await pause(800);
  const interactionAudit = Boolean(window.__matboxInteractionAudit);
  const commerceWaitMs = interactionAudit ? 1500 : 20000;
  let commerceRoot = document.querySelector('#searchspring-category');
  const isLocalReplay = ['localhost', '127.0.0.1'].includes(location.hostname);
  const isProductDetailPage = document.body?.classList.contains('page_type-product')
    || Boolean(document.querySelector('[data-product-view], .productView, [itemtype="https://schema.org/Product"]'));
  const forceCommerceExpansion = document.documentElement.hasAttribute('data-matbox-test-expand-commerce');
  const expectsCommerce = forceCommerceExpansion || Boolean(document.querySelector(
    'script[src*="searchspring" i], link[href*="searchspring" i], [id*="searchspring" i], [class*="searchspring" i]'
  ));
  let loadMoreClicks = 0;
  let initialProductCount = commerceRoot?.querySelectorAll('.product-card').length || 0;
  if (!isProductDetailPage && ((!isLocalReplay && expectsCommerce) || forceCommerceExpansion)) {
    const commerceStartedAt = performance.now();
    while (!commerceRoot && performance.now() - commerceStartedAt < commerceWaitMs) {
      await pause(250);
      commerceRoot = document.querySelector('#searchspring-category');
    }
    while (commerceRoot && commerceRoot.childElementCount === 0 && performance.now() - commerceStartedAt < commerceWaitMs) {
      await pause(250);
    }
    let lastProductCount = -1;
    let stableProductSamples = 0;
    while (commerceRoot && performance.now() - commerceStartedAt < commerceWaitMs) {
      const productCount = commerceRoot.querySelectorAll('.product-card').length;
      const loadMore = commerceRoot.querySelector('.ss-load-more');
      const loadMoreStyle = loadMore ? getComputedStyle(loadMore) : null;
      const loadMoreRect = loadMore?.getBoundingClientRect();
      const loadMoreReady = !loadMore || (
        !loadMore.disabled
        && loadMore.getAttribute('aria-disabled') !== 'true'
        && loadMoreStyle?.display !== 'none'
        && loadMoreStyle?.visibility === 'visible'
        && (loadMoreRect?.width || 0) > 1
        && (loadMoreRect?.height || 0) > 1
      );
      const busy = commerceRoot.getAttribute('aria-busy') === 'true'
        || Boolean(commerceRoot.querySelector('[aria-busy="true"], .ss-loading, .loading, .skeleton'));
      if (!busy && loadMoreReady && productCount > 0) {
        stableProductSamples = productCount === lastProductCount ? stableProductSamples + 1 : 0;
      } else {
        stableProductSamples = 0;
      }
      lastProductCount = productCount;
      if (stableProductSamples >= 3 && performance.now() - commerceStartedAt >= 1500) break;
      await pause(250);
    }
    // Searchspring can mount the grid after this hook begins.  The initial
    // products are the cards present after the widget has mounted, not the
    // zero-card placeholder that existed at hook entry.
    initialProductCount = commerceRoot?.querySelectorAll('.product-card').length || 0;
  }
  if (commerceRoot) commerceRoot.setAttribute('data-matbox-initial-product-count', String(initialProductCount));
  const shouldExpandCommerce = !isProductDetailPage && commerceRoot && (
    !isLocalReplay || forceCommerceExpansion
  ) && !window.__matboxUseTrustedClick;
  const maxLoadMoreRounds = 1;
  if (shouldExpandCommerce) {
    const expansionStartedAt = performance.now();
    for (let round = 0; round < maxLoadMoreRounds; round += 1) {
      if (performance.now() - expansionStartedAt > 8000) break;
      const loadMore = commerceRoot.querySelector('.ss-load-more');
      if (!loadMore || loadMore.disabled || loadMore.getAttribute('aria-disabled') === 'true') break;
      const style = getComputedStyle(loadMore);
      const rect = loadMore.getBoundingClientRect();
      if (style.display === 'none' || style.visibility !== 'visible' || rect.width <= 1 || rect.height <= 1) break;
      const beforeCount = commerceRoot.querySelectorAll('.product-card').length;
      loadMore.scrollIntoView({ block: 'center', behavior: 'auto' });
      await paint();
      loadMore.click();
      const roundStartedAt = performance.now();
      let progressed = false;
      while (performance.now() - roundStartedAt < 6000) {
        await pause(100);
        const nextButton = commerceRoot.querySelector('.ss-load-more');
        const nextCount = commerceRoot.querySelectorAll('.product-card').length;
        if (nextCount > beforeCount || !nextButton) {
          progressed = true;
          break;
        }
      }
      if (!progressed) break;
      loadMoreClicks += 1;
      await pause(200);
    }
  }
  const prefetchedProductCards = commerceRoot
    ? Array.from(commerceRoot.querySelectorAll('.product-card')).slice(initialProductCount)
    : [];
  if (prefetchedProductCards.length > 0) {
    for (const card of prefetchedProductCards) {
      card.hidden = true;
      card.setAttribute('data-matbox-load-more-item', '');
    }
    commerceRoot.setAttribute('data-matbox-load-more-batch-size', String(prefetchedProductCards.length));
    const loadMore = commerceRoot.querySelector('.ss-load-more');
    if (loadMore) loadMore.setAttribute('data-matbox-load-more', 'true');
  }
  const finalProductCount = commerceRoot?.querySelectorAll('.product-card').length || 0;
  for (const image of document.images) {
    image.loading = 'eager';
    const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
    const frozen = image.hasAttribute('data-matbox-image-intrinsic-width')
      || image.hasAttribute('data-matbox-browser-frozen-image')
      || image.hasAttribute('data-matbox-browser-screenshot-image');
    if (shouldPromoteDeferredImage({
      allowNetwork: !document.documentElement.hasAttribute('data-matbox-source-client-width'),
      currentSource: image.getAttribute('src'),
      deferredSource: deferred,
      frozen,
    })) image.src = deferred;
    if (image.classList.contains('lazyload') && (deferred || image.currentSrc || image.getAttribute('src'))) {
      image.classList.remove('lazyload', 'lazyloading');
      image.classList.add('lazyloaded');
    }
  }
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
  document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
  // Interaction parity needs an inventory of controls across the whole page,
  // not only those mounted in the initial viewport.  Reveal/lazy-load each
  // viewport before inventorying controls, then restore the top position so
  // every subsequent trusted click still starts from the same clean state.
  let interactionAuditScrollSweep = 0;
  let interactionAuditStableControlCount = 0;
  if (interactionAudit) {
    const controlSelector = 'a[href],button,input[type="button"],input[type="submit"],input[type="checkbox"],input[type="radio"],input[type="range"],summary,[role="button"],select';
    let previousControlCount = -1;
    for (let pass = 0; pass < 4; pass += 1) {
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      const step = Math.max(240, Math.floor(innerHeight * 0.8));
      const positions = [];
      for (let y = 0; y < maxScrollY; y += step) positions.push(y);
      positions.push(maxScrollY);
      for (const y of positions) {
        scrollTo(0, y);
        interactionAuditScrollSweep += 1;
        await paint();
        await pause(50);
      }
      scrollTo(0, 0);
      await paint();
      await pause(200);
      interactionAuditStableControlCount = document.querySelectorAll(controlSelector).length;
      if (pass >= 2 && interactionAuditStableControlCount === previousControlCount) break;
      previousControlCount = interactionAuditStableControlCount;
    }
    scrollTo(0, 0);
    await paint();
  }
  const startedAt = performance.now();
  let lastMutationAt = startedAt;
  let mutationCount = 0;
  const observer = new MutationObserver((records) => {
    mutationCount += records.length;
    lastMutationAt = performance.now();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  // The capture engine performs the full lazy-load scroll sweep immediately
  // after this hook. Here we only wait for the current DOM burst to settle so
  // every route is not scanned twice before a single screenshot is taken.
  while (performance.now() - startedAt < 1500 && performance.now() - lastMutationAt < 350) await pause(50);
  observer.disconnect();
  scrollTo(0, 0);
  await paint();
  await pause(100);
  return {
    mutationCount,
    waitedMs: Math.round(performance.now() - startedAt),
    loadMoreClicks,
    initialProductCount,
    finalProductCount,
    interactionAuditScrollSweep,
    interactionAuditStableControlCount,
  };
})()`;

export const afterTrustedCommerceClickExpression = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const commerceRoot = document.querySelector('#searchspring-category');
  if (!commerceRoot) return { progressed: false, reason: 'missing-commerce-root' };
  const initialProductCount = Number(commerceRoot.getAttribute('data-matbox-initial-product-count') || 0);
  const startedAt = performance.now();
  let finalProductCount = commerceRoot.querySelectorAll('.product-card').length;
  while (performance.now() - startedAt < 8000) {
    finalProductCount = commerceRoot.querySelectorAll('.product-card').length;
    if (finalProductCount > initialProductCount || !commerceRoot.querySelector('.ss-load-more')) break;
    await pause(100);
  }
  const prefetchedProductCards = Array.from(commerceRoot.querySelectorAll('.product-card')).slice(initialProductCount);
  for (const card of prefetchedProductCards) {
    card.hidden = true;
    card.setAttribute('data-matbox-load-more-item', '');
  }
  if (prefetchedProductCards.length > 0) {
    commerceRoot.setAttribute('data-matbox-load-more-batch-size', String(prefetchedProductCards.length));
    const loadMore = commerceRoot.querySelector('.ss-load-more');
    if (loadMore) loadMore.setAttribute('data-matbox-load-more', 'true');
  }
  commerceRoot.setAttribute('data-matbox-trusted-click-result', prefetchedProductCards.length > 0 ? 'progressed' : 'no-progress');
  commerceRoot.setAttribute('data-matbox-final-product-count', String(finalProductCount));
  return {
    progressed: prefetchedProductCards.length > 0,
    initialProductCount,
    finalProductCount,
  };
})()`;

export const closeDelayedPopupExpression = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const controls = Array.from(document.querySelectorAll('[data-subscription-popup-close], [data-subscription-popup-dismiss], .fancybox-close'));
  for (const close of controls) close.click();
  if (controls.length) await pause(250);
  document.querySelectorAll('[data-subscription-popup], .subscription-popup, .fancybox-wrap, .fancybox-overlay').forEach((node) => {
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('display', 'none', 'important');
  });
  document.documentElement.classList.remove('fancybox-lock', 'fancybox-margin', 'theme-subscription-popup-lock', 'theme-scroll-lock-active', 'lenis-stopped');
  document.body?.classList.remove('fancybox-lock', 'fancybox-margin', 'theme-subscription-popup-lock', 'theme-scroll-lock-active', 'lenis-stopped');
  document.documentElement.style.removeProperty('overflow');
  document.body?.style.removeProperty('overflow');
  return true;
})()`;

export const afterSettleStateExpression = `(async () => {
  const shouldPromoteDeferredImage = ${imageReadinessPolicySource};
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await (${closeDelayedPopupExpression});
  const startedAt = performance.now();
  const minimumDelayedMountMs = 2500;
  const maximumDelayedMountMs = 6000;
  const interactionSelector = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[tabindex]';
  const interactionSignature = () => Array.from(document.querySelectorAll(interactionSelector))
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0
        && element.getClientRects().length > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && !element.closest('[hidden],[aria-hidden="true"]');
    })
    .map((element) => [
      element.tagName.toLowerCase(),
      element.id || '',
      element.getAttribute('role') || '',
      element.getAttribute('type') || '',
      element.getAttribute('href') || '',
      element.getAttribute('aria-controls') || '',
    ].join('|'))
    .sort()
    .join('\\n');
  let lastMutationAt = startedAt;
  let mutationCount = 0;
  let previousInteractionSignature = '';
  let stableInteractionSamples = 0;
  const observer = new MutationObserver((records) => {
    mutationCount += records.length;
    lastMutationAt = performance.now();
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  // Do not save the page merely because the DOM was briefly quiet. Delayed
  // search, recommendations, header and footer controls must remain identical
  // for consecutive samples after the minimum mount window.
  while (performance.now() - startedAt < maximumDelayedMountMs) {
    await pause(250);
    await (${closeDelayedPopupExpression});
    const signature = interactionSignature();
    stableInteractionSamples = signature === previousInteractionSignature
      ? stableInteractionSamples + 1
      : 0;
    previousInteractionSignature = signature;
    const elapsed = performance.now() - startedAt;
    const mutationQuiet = performance.now() - lastMutationAt >= 500;
    if (elapsed >= minimumDelayedMountMs && mutationQuiet && stableInteractionSamples >= 3) break;
  }
  await (${closeDelayedPopupExpression});
  observer.disconnect();
  for (const image of document.images) {
    image.loading = 'eager';
    const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
    const frozen = image.hasAttribute('data-matbox-image-intrinsic-width')
      || image.hasAttribute('data-matbox-browser-frozen-image')
      || image.hasAttribute('data-matbox-browser-screenshot-image');
    if (shouldPromoteDeferredImage({
      allowNetwork: !document.documentElement.hasAttribute('data-matbox-source-client-width'),
      currentSource: image.getAttribute('src'),
      deferredSource: deferred,
      frozen,
    })) image.src = deferred;
    if (image.classList.contains('lazyload') && (deferred || image.currentSrc || image.getAttribute('src'))) {
      image.classList.remove('lazyload', 'lazyloading');
      image.classList.add('lazyloaded');
    }
  }
  scrollTo(0, 0);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return {
    mutationCount,
    waitedMs: Math.round(performance.now() - startedAt),
    stableInteractionSamples,
    interactionCount: document.querySelectorAll(interactionSelector).length,
  };
})()`;
