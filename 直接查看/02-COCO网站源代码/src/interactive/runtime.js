(() => {
  'use strict';

  const VERSION = '1.0.0';
  const CART_KEY = 'matbox-demo-cart-v1';
  const knownRoutes = new Set([
    '/',
    '/collections/bedroom',
    '/collections',
    '/collections/all',
    '/collections/tables',
    '/collections/dining-room',
    '/collections/living-room',
    '/collections/luxury-dining',
  ]);
  const interactionRedirects = window.__matboxInteractionRoutes?.redirects || {};

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const t = (key, params) => window.MatboxLocale?.t(key, params) ?? key;

  function normalizeHref(href) {
    if (!href || href === '#') return null;
    try {
      const url = new URL(href, location.href);
      return knownRoutes.has(url.pathname) ? `${url.pathname}${url.search}${url.hash}` : null;
    } catch {
      return null;
    }
  }

  function interactionRouteOverride(href) {
    if (!href) return null;
    try {
      const url = new URL(href, location.href);
      return interactionRedirects[url.href]
        || interactionRedirects[`${url.pathname}${url.search}`]
        || interactionRedirects[url.pathname]
        || null;
    } catch {
      return interactionRedirects[href] || null;
    }
  }

  function showNotice(message, kind = 'info') {
    let notice = $('[data-matbox-notice]');
    if (!notice) {
      notice = document.createElement('div');
      notice.setAttribute('data-matbox-notice', '');
      notice.setAttribute('role', 'status');
      notice.innerHTML = '<span data-matbox-notice-text></span><button type="button" aria-label="Close">×</button>';
      notice.querySelector('button').addEventListener('click', () => notice.remove());
      document.body.append(notice);
    }
    notice.dataset.kind = kind;
    $('[data-matbox-notice-text]', notice).textContent = message;
    notice.classList.add('is-visible');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => notice?.classList.remove('is-visible'), 5000);
    return notice;
  }

  function readCart() {
    try {
      const value = JSON.parse(localStorage.getItem(CART_KEY) || '{"items":[]}');
      return { items: Array.isArray(value.items) ? value.items : [] };
    } catch {
      return { items: [] };
    }
  }

  function writeCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    renderCart(cart);
  }

  function cartCount(cart) {
    return cart.items.reduce((total, item) => total + Math.max(1, Number(item.quantity) || 1), 0);
  }

  function money(cents) {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  function ensureCartItemsHost(drawer) {
    let host = $('[data-matbox-cart-items]', drawer);
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-matbox-cart-items', '');
      const header = $('.theme-cart-drawer__header', drawer);
      (header?.parentElement || drawer).append(host);
    }
    return host;
  }

  function cartDrawer() {
    return $('[data-cart-drawer],#custom-cart,#cart-drawer');
  }

  function cartTrigger() {
    return $('[data-cart-trigger],#nav-preview-cart,[aria-controls="cart-drawer"]');
  }

  function ensureConsultationModal() {
    let shell = $('[data-consultation-modal]');
    if (shell) return shell;
    shell = document.createElement('div');
    shell.setAttribute('data-consultation-modal', '');
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'matbox-consultation-title');
    shell.hidden = true;
    shell.innerHTML = `
      <button type="button" class="matbox-consultation-backdrop" data-consultation-modal-close aria-label="${t('common.close')}"></button>
      <section class="matbox-consultation-panel">
        <button type="button" class="matbox-consultation-close" data-consultation-modal-close aria-label="${t('common.close')}"></button>
        <h2 id="matbox-consultation-title" data-consultation-title></h2>
        <p data-consultation-body></p>
        <button type="button" class="matbox-consultation-continue" data-consultation-modal-close data-consultation-continue></button>
      </section>`;
    document.body.append(shell);
    return shell;
  }

  function renderConsultationModal() {
    const shell = ensureConsultationModal();
    $('[data-consultation-title]', shell).textContent = t('consultation.title');
    $('[data-consultation-body]', shell).textContent = t('consultation.body');
    $('[data-consultation-continue]', shell).textContent = t('consultation.continue');
    $$('[data-consultation-modal-close]', shell).forEach((node) => node.setAttribute('aria-label', t('common.close')));
    return shell;
  }

  function openConsultationModal() {
    const shell = renderConsultationModal();
    shell.hidden = false;
    shell.classList.add('is-open');
    document.body.classList.add('matbox-consultation-open');
    $('.matbox-consultation-close', shell)?.focus({ preventScroll: true });
  }

  function closeConsultationModal() {
    const shell = $('[data-consultation-modal]');
    if (!shell) return;
    shell.classList.remove('is-open');
    shell.hidden = true;
    document.body.classList.remove('matbox-consultation-open');
  }

  function prepareCocoCartDrawer(drawer = cartDrawer()) {
    if (!drawer || drawer.id !== 'custom-cart') return drawer;
    drawer.classList.add('matbox-coco-cart-drawer');
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', t('cart.title'));
    if (!$('.matbox-coco-cart-panel', drawer)) {
      const panel = document.createElement('div');
      panel.className = 'matbox-coco-cart-panel';
      const close = document.createElement('button');
      close.type = 'button';
      close.setAttribute('data-cart-drawer-close', '');
      close.setAttribute('aria-label', t('common.close'));
      close.className = 'matbox-coco-cart-close';
      close.textContent = '';
      const title = document.createElement('h2');
      title.setAttribute('data-coco-empty-cart-heading', '');
      title.textContent = t('cart.emptyHeading');
      const continueButton = document.createElement('button');
      continueButton.type = 'button';
      continueButton.setAttribute('data-cart-drawer-close', '');
      continueButton.className = 'matbox-coco-cart-continue';
      continueButton.textContent = t('cart.continueShopping');
      panel.append(close, title, continueButton);
      drawer.replaceChildren(panel);
    }
    return drawer;
  }

  function renderCart(cart = readCart()) {
    const count = cartCount(cart);
    $$('[data-cart-trigger]').forEach((trigger) => {
      trigger.setAttribute('data-cart-item-count', String(count));
      trigger.setAttribute('aria-label', t('cart.itemCount', { count }));
    });
    $$('[data-cart-count-value]').forEach((node) => { node.textContent = String(count); });
    const drawer = prepareCocoCartDrawer();
    if (!drawer) return;
    const host = ensureCartItemsHost(drawer);
    host.replaceChildren();
    if (!cart.items.length) {
      if (drawer.id === 'custom-cart') {
        host.hidden = true;
        $('[data-coco-empty-cart-heading]', drawer).textContent = t('cart.emptyHeading');
        $('.matbox-coco-cart-continue', drawer).textContent = t('cart.continueShopping');
      } else {
        const empty = document.createElement('p');
        empty.className = 'matbox-cart-empty';
        empty.textContent = t('cart.empty');
        host.append(empty);
      }
    } else {
      host.hidden = false;
      for (const item of cart.items) {
        const article = document.createElement('article');
        article.className = 'matbox-cart-item';
        article.dataset.cartItemId = String(item.id);
        const image = document.createElement('img');
        image.src = item.image || '';
        image.alt = '';
        const details = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = item.title;
        const price = document.createElement('span');
        price.textContent = `${money(item.priceCents)} × ${item.quantity}`;
        details.append(title, price);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.matboxCartRemove = String(item.id);
        remove.textContent = t('cart.remove');
        article.append(image, details, remove);
        host.append(article);
      }
    }
    $$('.theme-cart-empty', drawer).forEach((node) => { node.hidden = cart.items.length > 0; });
  }

  function setShellOpen(shell, control, open, bodyClass) {
    if (!shell) return;
    shell.classList.remove('is-opening', 'is-closing');
    if (open) {
      shell.style.removeProperty('display');
      $$('[data-localization-drawer-close],[data-localization-drawer-overlay]', shell).forEach((node) => {
        node.style.removeProperty('display');
        node.style.removeProperty('visibility');
        node.style.removeProperty('opacity');
      });
    } else {
      shell.style.setProperty('display', 'none', 'important');
    }
    shell.hidden = !open;
    shell.setAttribute('aria-hidden', String(!open));
    shell.classList.toggle('is-open', open);
    control?.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle(bodyClass, open);
    const dialog = shell.matches('dialog') ? shell : $('dialog', shell);
    if (dialog) {
      dialog.setAttribute('role', 'dialog');
      if (open && !dialog.open) {
        try { dialog.showModal(); } catch { dialog.setAttribute('open', ''); }
      } else if (!open && dialog.open) {
        try { dialog.close(); } catch { dialog.removeAttribute('open'); }
      }
    }
    if (open) (dialog || $('[role="dialog"]', shell))?.focus?.();
  }

  function setupCapturedOverflowLists() {
    $$('overflow-list').forEach((list) => {
      const moreItem = Array.from(list.children).find((item) => item.getAttribute('slot') === 'more');
      const button = moreItem?.querySelector('button');
      if (!moreItem || !button) return;
      const overflowCount = Math.max(0, Number.parseInt(getComputedStyle(list).getPropertyValue('--overflow-count') || '0', 10) || 0);
      moreItem.hidden = overflowCount === 0;
      moreItem.setAttribute('aria-hidden', String(overflowCount === 0));
      button.setAttribute('aria-expanded', 'false');
      button.dataset.matboxOverflowCount = String(overflowCount);
    });
  }

  function closeShell(shellSelector, triggerSelector, bodyClass) {
    setShellOpen($(shellSelector), $(triggerSelector), false, bodyClass);
  }

  function setCocoSlideoutOpen(mode = '') {
    const shell = $('#slide-out');
    if (!shell) return false;
    const normalizedMode = ['login', 'wishlist', 'create-account'].includes(mode) ? mode : 'login';
    $$('.slide-out__content > [class*="slide-out__content--"]', shell).forEach((panel) => {
      const selected = panel.classList.contains(`slide-out__content--${normalizedMode}`);
      panel.classList.toggle('hidden', !selected);
      panel.hidden = !selected;
      panel.setAttribute('aria-hidden', String(!selected));
    });
    shell.classList.remove('hidden');
    shell.style.removeProperty('display');
    shell.hidden = false;
    shell.setAttribute('aria-hidden', 'false');
    shell.classList.add('is-open');
    document.body.classList.add('matbox-slideout-open');
    if (!document.body.dataset.matboxSlideoutOverflow) {
      document.body.dataset.matboxSlideoutOverflow = JSON.stringify({
        value: document.body.style.getPropertyValue('overflow'),
        priority: document.body.style.getPropertyPriority('overflow'),
      });
    }
    document.body.style.setProperty('overflow', 'hidden', 'important');
    $('.slide-out__content', shell)?.setAttribute('role', 'dialog');
    $('.slide-out__content', shell)?.setAttribute('aria-modal', 'true');
    return true;
  }

  function closeCocoSlideout() {
    const shell = $('#slide-out');
    if (!shell) return false;
    shell.classList.add('hidden');
    shell.classList.remove('is-open');
    shell.style.setProperty('display', 'none', 'important');
    shell.hidden = true;
    shell.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('matbox-slideout-open');
    if (document.body.dataset.matboxSlideoutOverflow) {
      try {
        const previous = JSON.parse(document.body.dataset.matboxSlideoutOverflow);
        if (previous.value) document.body.style.setProperty('overflow', previous.value, previous.priority || '');
        else document.body.style.removeProperty('overflow');
      } catch {
        document.body.style.removeProperty('overflow');
      }
      delete document.body.dataset.matboxSlideoutOverflow;
    }
    return true;
  }

  function closeSubscriptionPopup(popup) {
    if (!popup) return;
    const dismissKey = popup.dataset.dismissKey;
    if (popup.dataset.showOnce === 'true' && dismissKey) {
      try { sessionStorage.setItem(`matbox-dismissed:${dismissKey}`, '1'); } catch {}
    }
    popup.hidden = true;
    popup.classList.remove('is-open', 'is-opening', 'is-closing');
    popup.style.setProperty('display', 'none', 'important');
    popup.setAttribute('aria-hidden', 'true');
    for (const root of [document.documentElement, document.body]) {
      root.classList.remove('theme-subscription-popup-lock', 'theme-scroll-lock-active', 'lenis-stopped');
      root.removeAttribute('data-theme-subscription-popup-lock-count');
      root.removeAttribute('data-theme-scroll-lock-count');
      root.style.removeProperty('--theme-scrollbar-compensation');
    }
  }

  function openSubscriptionPopup(popup) {
    if (!popup) return;
    popup.style.removeProperty('display');
    popup.hidden = false;
    popup.classList.remove('is-opening', 'is-closing');
    popup.classList.add('is-open');
    popup.setAttribute('aria-hidden', 'false');
    for (const root of [document.documentElement, document.body]) {
      root.classList.add('theme-subscription-popup-lock', 'theme-scroll-lock-active');
    }
  }

  function selectedBundleItems() {
    return $$('[data-bundle-item].is-matbox-selected').map((item) => ({
      id: item.dataset.selectedVariantId || item.dataset.productId,
      title: item.dataset.bundleProductTitle || 'Furniture item',
      priceCents: Number(item.dataset.selectedPriceCents || 0),
      image: item.dataset.bundleThumbUrl || '',
      quantity: Number(item.dataset.matboxQuantity || 1),
    }));
  }

  function updateBundle() {
    const items = selectedBundleItems();
    const selectedCount = items.reduce((sum, item) => sum + item.quantity, 0);
    $$('[data-bundle-summary-count]').forEach((node) => { node.textContent = String(selectedCount); });
    $$('[data-bundle-summary-total],[data-bundle-summary-final]').forEach((node) => {
      node.textContent = money(items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0));
    });
    $$('[data-bundle-submit]').forEach((button) => {
      button.disabled = items.length === 0;
      button.setAttribute('aria-disabled', String(items.length === 0));
    });
  }

  function toggleBundleItem(button) {
    const item = button.closest('[data-bundle-item]');
    if (!item) return;
    const selected = !item.classList.contains('is-matbox-selected');
    item.classList.toggle('is-matbox-selected', selected);
    item.dataset.matboxQuantity = selected ? (item.dataset.matboxQuantity || '1') : '1';
    const checkbox = $('[data-bundle-include]', item);
    if (checkbox) checkbox.checked = selected;
    const quantity = $('[data-bundle-quantity]', item);
    if (quantity) quantity.hidden = !selected;
    $$('[data-bundle-toggle-label]', button).forEach((label, index) => {
      label.textContent = selected ? (index ? t('bundle.remove') : t('bundle.added')) : (index ? t('bundle.added') : t('bundle.add'));
    });
    const count = $('[data-bundle-qty-count]', item);
    if (count) count.textContent = item.dataset.matboxQuantity;
    updateBundle();
  }

  function changeBundleQuantity(button, delta) {
    const item = button.closest('[data-bundle-item]');
    if (!item) return;
    if (!item.classList.contains('is-matbox-selected')) {
      const toggle = $('[data-bundle-toggle-button]', item);
      if (toggle) toggleBundleItem(toggle);
    }
    const quantity = Math.max(1, Number(item.dataset.matboxQuantity || 1) + delta);
    item.dataset.matboxQuantity = String(quantity);
    const count = $('[data-bundle-qty-count]', item);
    if (count) count.textContent = String(quantity);
    updateBundle();
  }

  function addBundleToCart() {
    const selections = selectedBundleItems();
    if (!selections.length) return showNotice(t('bundle.selectOne'), 'error');
    const cart = readCart();
    for (const selected of selections) {
      const existing = cart.items.find((item) => item.id === selected.id);
      if (existing) existing.quantity += selected.quantity;
      else cart.items.push(selected);
    }
    writeCart(cart);
    showNotice(t('bundle.addedToCart'), 'success');
    openCart();
  }

  function openCart() {
    const trigger = cartTrigger();
    const drawer = prepareCocoCartDrawer();
    renderCart();
    setShellOpen(drawer, trigger, true, 'matbox-cart-open');
  }

  function closeCart() {
    setShellOpen(cartDrawer(), cartTrigger(), false, 'matbox-cart-open');
  }

  function handleTabs(button) {
    const tablist = button.closest('[role="tablist"]') || button.parentElement;
    $$('[role="tab"]', tablist).forEach((tab) => {
      const selected = tab === button;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
      if (panel) panel.hidden = !selected;
    });
  }

  function setupReplayCarousels() {
    const sliders = $$('grid-slider.is-swiper-active,grid-slider[data-slider-mobile],grid-slider[data-slider-desktop]');
    for (const slider of sliders) {
      slider.classList.add('matbox-carousel');
    }
  }

  function setMegaNavigationOpen(item, open) {
    if (!item) return;
    const trigger = $('.menu-title-widget.has-subMenu,.navPages-action.has-subMenu', item);
    const panel = item.querySelector(':scope > .navPage-subMenu');
    if (!trigger || !panel) return;
    item.classList.toggle('matbox-mega-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    if (panel.id) trigger.setAttribute('aria-controls', panel.id);
    panel.setAttribute('aria-hidden', String(!open));
    panel.style.setProperty('display', 'block', 'important');
    panel.style.setProperty('visibility', open ? 'visible' : 'hidden', 'important');
    panel.style.setProperty('opacity', open ? '1' : '0', 'important');
    panel.style.setProperty('pointer-events', open ? 'auto' : 'none', 'important');
  }

  function closeMegaNavigation(except = null) {
    $$('.navPages-item.matbox-mega-open').forEach((item) => {
      if (item !== except) setMegaNavigationOpen(item, false);
    });
  }

  function setupMegaNavigation() {
    $$('.navPages-item').forEach((item) => {
      const trigger = $('.menu-title-widget.has-subMenu,.navPages-action.has-subMenu', item);
      const panel = item.querySelector(':scope > .navPage-subMenu');
      if (!trigger || !panel) return;
      setMegaNavigationOpen(item, false);
      item.addEventListener('mouseenter', () => {
        closeMegaNavigation(item);
        setMegaNavigationOpen(item, true);
      });
      item.addEventListener('mouseleave', () => setMegaNavigationOpen(item, false));
      item.addEventListener('focusin', () => {
        closeMegaNavigation(item);
        setMegaNavigationOpen(item, true);
      });
      item.addEventListener('focusout', (event) => {
        if (!item.contains(event.relatedTarget)) setMegaNavigationOpen(item, false);
      });
    });
  }

  function setFacetDropdownOpen(dropdown, open) {
    if (!dropdown) return;
    const trigger = $('.ss-dropdown-button', dropdown);
    const panel = $('.ss-dropdown-content', dropdown);
    if (!trigger || !panel) return;
    dropdown.classList.toggle('matbox-facet-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('ss-dropdown-open', open);
    panel.classList.toggle('ss-dropdown-closed', !open);
    panel.setAttribute('aria-hidden', String(!open));
  }

  function closeFacetDropdowns(except = null) {
    $$('.ss-dropdown.matbox-facet-open').forEach((dropdown) => {
      if (dropdown !== except) setFacetDropdownOpen(dropdown, false);
    });
  }

  function selectProductSwatch(button) {
    const host = button.closest('.product-card-swatches');
    if (!host) return;
    $$('.product-card-swatch-button', host).forEach((candidate) => {
      const selected = candidate === button;
      candidate.setAttribute('aria-pressed', String(selected));
      $('.product-card-swatch-item', candidate)?.classList.toggle('selected', selected);
    });
  }

  function toggleProductWishlist(button) {
    const selected = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('matbox-wishlist-selected', selected);
    button.setAttribute('aria-label', selected ? 'remove from wishlist' : 'add to wishlist');
    showNotice(selected ? 'Added to wishlist' : 'Removed from wishlist', 'success');
  }

  function setupCocoProductControls() {
    // Captured product option inputs can retain the source site's `required`
    // constraints even though the local replay has no source option service.
    // Disable native constraint blocking so the local submit handler can own
    // validation and persist the cart instead of silently swallowing submits.
    $$('form[data-cart-item-add]').forEach((form) => { form.noValidate = true; });
    $$('.ss-dropdown').forEach((dropdown) => setFacetDropdownOpen(dropdown, false));
    $$('.product-card-swatches').forEach((host) => {
      const buttons = $$('.product-card-swatch-button', host);
      buttons.forEach((button, index) => {
        const selected = $('.product-card-swatch-item', button)?.classList.contains('selected') ?? index === 0;
        button.setAttribute('aria-pressed', String(selected));
      });
    });
    $$('.product-card-wishlist button').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.classList.contains('matbox-wishlist-selected')));
    });
  }

  function revealPrefetchedProducts(button) {
    const commerce = button.closest('#searchspring-category');
    if (!commerce) return;
    const hiddenItems = $$('[data-matbox-load-more-item][hidden]', commerce);
    const batchSize = Math.max(1, Number(commerce.dataset.matboxLoadMoreBatchSize || hiddenItems.length || 1));
    hiddenItems.slice(0, batchSize).forEach((item) => { item.hidden = false; });
    const remaining = $$('[data-matbox-load-more-item][hidden]', commerce);
    if (remaining.length === 0) {
      button.hidden = true;
      button.disabled = true;
      button.setAttribute('aria-hidden', 'true');
      button.setAttribute('aria-disabled', 'true');
    }
    document.body.dataset.matboxLastAction = `load-more:${Date.now()}`;
  }

  function setAccordionOpen(button, open) {
    const selector = button?.getAttribute('data-target') || '';
    const panel = selector.startsWith('#') ? document.getElementById(selector.slice(1)) : null;
    if (!button || !panel) return;
    button.classList.toggle('collapsed', !open);
    button.setAttribute('aria-expanded', String(open));
    panel.classList.toggle('show', open);
    panel.setAttribute('aria-hidden', String(!open));
  }

  function setupCocoAccordions() {
    $$('.accordion-button[data-target]').forEach((button) => {
      setAccordionOpen(button, button.getAttribute('aria-expanded') === 'true');
    });
  }

  function changeProductQuantity(button) {
    const host = button.closest('[data-quantity-change]');
    const input = $('input', host);
    if (!input) return;
    const minimum = Math.max(1, Number(input.min || input.dataset.quantityMin || 1));
    const current = Math.max(minimum, Number(input.value || minimum));
    input.value = String(Math.max(minimum, current + (button.dataset.action === 'inc' ? 1 : -1)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function addProductFormToCart(form) {
    const quantity = Math.max(1, Number($('[name="qty[]"]', form)?.value || 1));
    const title = $('.productView-title')?.textContent.trim() || 'Product';
    const productId = $('[name="product_id"]', form)?.value || location.pathname;
    const priceText = $('[data-product-price-with-tax],.productView-price .price')?.textContent || '$0';
    const priceCents = Math.round(Number(priceText.replace(/[^\d.]/g, '')) * 100) || 0;
    const image = $('.productView-image img,.productView-img-container img')?.currentSrc || '';
    const cart = readCart();
    const existing = cart.items.find((item) => String(item.id) === String(productId));
    if (existing) existing.quantity += quantity;
    else cart.items.push({ id: productId, title, priceCents, image, quantity });
    writeCart(cart);
    showNotice('Added to cart', 'success');
  }

  function setCocoCarouselIndex(control, requestedIndex) {
    const container = control.closest('[id^="bc-carousel-container-"]');
    const bullets = $$('.bc-carousel__bullet', container);
    if (!container || !bullets.length) return;
    const slideCount = bullets.length;
    const index = (requestedIndex + slideCount) % slideCount;
    const viewport = container.querySelector('[id^="bc-carousel-"]:not([id^="bc-carousel-container-"])');
    const track = viewport?.firstElementChild;
    const width = viewport?.getBoundingClientRect().width || container.getBoundingClientRect().width;
    if (track) track.style.setProperty('transform', `translate3d(${-(index + 1) * width}px, 0px, 0px)`, 'important');
    container.dataset.matboxCarouselIndex = String(index);
    bullets.forEach((bullet, bulletIndex) => {
      const active = bulletIndex === index;
      bullet.classList.toggle('bc-carousel__bullet-active', active);
      bullet.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  function setupCocoCarousels() {
    $$('[id^="bc-carousel-container-"]').forEach((container) => {
      const active = $('.bc-carousel__bullet-active', container);
      container.dataset.matboxCarouselIndex = active?.dataset.bulletIndex || '0';
    });
  }

  function moveSlickGallery(button) {
    const slider = button.closest('.slick-slider');
    const track = $('.slick-track', slider);
    const slides = Array.from(track.children).filter((slide) => slide.matches('.slick-slide:not(.slick-cloned):not(.ghost-slide)'));
    if (!slider || !track || !slides.length) return;
    const current = Math.max(0, slides.findIndex((slide) => slide.classList.contains('slick-current')));
    const next = Math.max(0, Math.min(slides.length - 1, current + (button.matches('.slick-next') ? 1 : -1)));
    const width = slides[next]?.getBoundingClientRect().width || slider.getBoundingClientRect().width;
    track.style.setProperty('transform', `translate3d(${-next * width}px, 0px, 0px)`, 'important');
    slides.forEach((slide, index) => {
      const active = index === next;
      slide.classList.toggle('slick-current', active);
      slide.classList.toggle('slick-active', active);
      slide.setAttribute('aria-hidden', String(!active));
      slide.tabIndex = active ? 0 : -1;
    });
    const previous = $('.slick-prev', slider);
    const following = $('.slick-next', slider);
    for (const [control, disabled] of [[previous, next === 0], [following, next === slides.length - 1]]) {
      control?.classList.toggle('slick-disabled', disabled);
      control?.setAttribute('aria-disabled', String(disabled));
    }
    slider.dataset.matboxSlickIndex = String(next);
  }

  function storeNameFromControl(control) {
    const label = control?.getAttribute?.('aria-label') || control?.getAttribute?.('title') || control?.textContent || '';
    return label
      .replace(/^View on the map:\s*['"]?/i, '')
      .replace(/['"]?\s*$/i, '')
      .trim();
  }

  function selectStore(control) {
    const name = storeNameFromControl(control);
    if (!name) return false;
    const normalized = name.toLocaleLowerCase();
    const markers = $$('gmp-advanced-marker');
    let selectedMarker = null;
    for (const marker of markers) {
      const active = storeNameFromControl(marker).toLocaleLowerCase() === normalized;
      marker.classList.toggle('matbox-store-active', active);
      marker.setAttribute('aria-pressed', String(active));
      if (active) selectedMarker = marker;
    }
    for (const button of $$('.storemapper-storelink')) {
      const active = storeNameFromControl(button).toLocaleLowerCase() === normalized;
      button.closest('.strmpr-search-result')?.classList.toggle('matbox-store-active', active);
    }
    document.body.dataset.matboxLastAction = `store:${name}:${Date.now()}`;
    const map = selectedMarker?.closest('gmp-map, .storemapper-map, [class*="storemapper-map"]') || selectedMarker;
    map?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    showNotice(`Showing ${name} on the map`, 'info');
    return true;
  }

  function revealMoreStores(button) {
    const root = button.closest('#storemapper, .storemapper') || document;
    const list = $('.strmpr-search-results', root);
    if (!list) return false;
    const existing = new Set($$('.strmpr-store-name-button', list).map((item) => storeNameFromControl(item).toLocaleLowerCase()));
    let added = 0;
    for (const marker of $$('gmp-advanced-marker', root)) {
      const name = storeNameFromControl(marker);
      if (!name || existing.has(name.toLocaleLowerCase())) continue;
      const item = document.createElement('li');
      item.className = 'strmpr-search-result matbox-generated-store';
      item.dataset.matboxGeneratedStore = 'true';
      item.innerHTML = `<div class="strmpr-field-bucket-general"><div class="strmpr-field-name" role="heading" aria-level="3"><button type="button" class="storemapper-storelink strmpr-store-name-button"></button></div><button type="button" class="storemapper_view strmpr-field-show-on-map storemapper-storelink"></button></div>`;
      const nameButton = $('.strmpr-store-name-button', item);
      const mapButton = $('.strmpr-field-show-on-map', item);
      nameButton.textContent = name;
      mapButton.textContent = 'View On Map';
      mapButton.setAttribute('aria-label', `View on the map: '${name}'`);
      list.append(item);
      existing.add(name.toLocaleLowerCase());
      added += 1;
    }
    button.hidden = true;
    button.setAttribute('aria-expanded', 'true');
    document.body.dataset.matboxLastAction = `stores:show-more:${added}:${Date.now()}`;
    return true;
  }

  function searchStores(button) {
    const root = button.closest('#storemapper, .storemapper') || document;
    const input = $('.strmpr-search-box', root);
    const query = input?.value.trim().toLocaleLowerCase() || '';
    let visible = 0;
    for (const item of $$('.strmpr-search-result', root)) {
      const match = !query || item.textContent.toLocaleLowerCase().includes(query);
      item.hidden = !match;
      if (match) visible += 1;
    }
    const status = $('#storemapper-results-status', root);
    if (status) status.textContent = `${visible} store locations found`;
    document.body.dataset.matboxLastAction = `stores:search:${query || 'all'}:${visible}:${Date.now()}`;
    return true;
  }

  document.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-subscription-popup-close],[data-subscription-popup-dismiss],[data-subscription-popup-overlay]');
    if (!control) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeSubscriptionPopup(control.closest('[data-subscription-popup],.subscription-popup'));
  }, true);

  document.addEventListener('click', (event) => {
    const close = event.target.closest?.('[data-localization-drawer-close],[data-localization-drawer-overlay]');
    if (!close) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    closeShell('[data-localization-drawer]', '[data-localization-drawer-toggle]', 'matbox-localization-open');
  }, true);

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('summary[data-menu-trigger]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const details = trigger.closest('details');
    const shouldOpen = !details?.open;
    $$('[data-menu-trigger]').forEach((other) => {
      const otherDetails = other.closest('details');
      if (otherDetails) otherDetails.open = false;
      other.setAttribute('aria-expanded', 'false');
    });
    if (details) details.open = shouldOpen;
    trigger.setAttribute('aria-expanded', String(shouldOpen));
    setTimeout(() => {
      if (details) details.open = shouldOpen;
      trigger.setAttribute('aria-expanded', String(shouldOpen));
    }, 0);
  }, true);

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('button[onclick*="location.href"]');
    if (!button) return;
    const destination = button.getAttribute('onclick')?.match(/location\.href\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    if (!destination || !destination.startsWith('/')) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    location.href = destination;
  }, true);

  document.addEventListener('click', (event) => {
    const target = event.target.closest('a,button,summary,[role="button"],input[type="button"],input[type="submit"],gmp-advanced-marker');
    if (!target) return;

    if (target.matches('#show-password')) {
      event.preventDefault();
      const input = document.querySelector('[data-testid="password-input"]');
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      target.setAttribute('aria-pressed', String(show));
      target.querySelector('[role="img"]')?.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      document.body.dataset.matboxLastAction = `password-visibility:${show ? 'shown' : 'hidden'}:${Date.now()}`;
      return;
    }

    if (target.matches('gmp-advanced-marker,.storemapper-storelink')) {
      event.preventDefault();
      selectStore(target);
      return;
    }
    if (target.matches('.strmpr-view-more-stores-button')) {
      event.preventDefault();
      revealMoreStores(target);
      return;
    }
    if (target.matches('.strmpr-search-button')) {
      event.preventDefault();
      searchStores(target);
      return;
    }
    if (target.matches('.gm-fullscreen-control')) {
      event.preventDefault();
      const map = target.closest('.strmpr-map');
      const open = target.getAttribute('aria-pressed') !== 'true';
      map?.classList.toggle('matbox-map-fullscreen', open);
      target.setAttribute('aria-pressed', String(open));
      document.body.dataset.matboxLastAction = `map:fullscreen:${open}:${Date.now()}`;
      return;
    }
    if (target.matches('[aria-label="地图镜头控件"]')) {
      event.preventDefault();
      const open = target.getAttribute('aria-expanded') !== 'true';
      target.setAttribute('aria-expanded', String(open));
      document.body.dataset.matboxLastAction = `map:camera:${open}:${Date.now()}`;
      showNotice('Map camera controls', 'info');
      return;
    }
    if (target.matches('[aria-label="键盘快捷键"]')) {
      event.preventDefault();
      document.body.dataset.matboxLastAction = `map:keyboard:${Date.now()}`;
      showNotice('Use the arrow keys to move around the map', 'info');
      return;
    }

    if (target.matches('.article-vote-up,.article-vote-down')) {
      event.preventDefault();
      const votes = target.closest('.article-votes');
      const helpful = target.matches('.article-vote-up');
      $$('.article-vote', votes).forEach((button) => {
        const selected = button === target;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      let status = $('[role="status"]', votes);
      if (!status) {
        status = document.createElement('small');
        status.setAttribute('role', 'status');
        status.className = 'matbox-article-vote-status';
        votes?.append(status);
      }
      status.textContent = 'Thank you for your feedback.';
      document.body.dataset.matboxLastAction = `article-vote:${helpful ? 'helpful' : 'not-helpful'}:${Date.now()}`;
      return;
    }

    if (target.matches('.ss-no-results button') && target.textContent.trim() === 'Refresh the page') {
      event.preventDefault();
      document.body.dataset.matboxLastAction = `collection-refresh:unavailable:${Date.now()}`;
      showNotice('Products are unavailable in this captured collection.', 'error');
      return;
    }

    if (target.matches('[data-test-id="hero-image-button"][role="button"]')) {
      event.preventDefault();
      const declaredTarget = target.getAttribute('data-matbox-action-target');
      const capturedTargets = {
        '/blog/coco-republic-x-business-pleasure-co': '/collections/business-pleasure',
        '/blog/create-the-perfect-holiday-bar-cabinet': '/living/storage/bars',
      };
      const destination = declaredTarget || capturedTargets[location.pathname];
      if (destination) location.href = destination;
      else {
        document.body.dataset.matboxLastAction = `content-cta:unavailable:${Date.now()}`;
        showNotice('This content action is unavailable in the captured page.', 'error');
      }
      return;
    }

    if (target.matches('.wizard-stepper__btn[data-step],.wizard-nav__btn--next,.wizard-nav__btn--prev')) {
      event.preventDefault();
      const active = $('.wizard-step.is-active[data-step]');
      const current = Number(active?.dataset.step || 1);
      const requested = target.matches('.wizard-stepper__btn')
        ? Number(target.dataset.step || current)
        : current + (target.matches('.wizard-nav__btn--next') ? 1 : -1);
      const steps = $$('.wizard-step[data-step]');
      const maximum = Math.max(1, ...steps.map((step) => Number(step.dataset.step || 1)));
      const next = Math.min(maximum, Math.max(1, requested));
      steps.forEach((step) => step.classList.toggle('is-active', Number(step.dataset.step) === next));
      $$('.wizard-stepper__item[data-step]').forEach((item) => {
        const selected = Number(item.dataset.step) === next;
        item.classList.toggle('is-active', selected);
        item.classList.toggle('is-complete', Number(item.dataset.step) < next);
      });
      $$('.wizard-stepper__btn[data-step]').forEach((button) => {
        if (Number(button.dataset.step) === next) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
      const fill = $('#wizardStepperBarFill');
      if (fill) fill.style.width = `${maximum > 1 ? ((next - 1) / (maximum - 1)) * 100 : 100}%`;
      document.body.dataset.matboxLastAction = `trade-wizard:step-${next}:${Date.now()}`;
      return;
    }

    if (target.matches('.grid-slider__btn--next,.grid-slider__btn--prev')) {
      const slider = target.closest('grid-slider.matbox-carousel');
      if (slider) {
        event.preventDefault();
        const viewport = $('.grid-slider__swiper', slider);
        const card = $('.grid-slider__item', slider);
        const distance = (card?.getBoundingClientRect().width || 0) + (Number(slider.dataset.gap) || 20);
        const items = $$('.grid-slider__item', slider);
        const perView = window.innerWidth >= 1000 ? Number(slider.dataset.slidesDesktop || 4) : Number(slider.dataset.slidesMobile || 1.4);
        const maxIndex = Math.max(0, items.length - Math.floor(perView));
        const current = Number(slider.dataset.matboxIndex || 0);
        const next = Math.max(0, Math.min(maxIndex, current + (target.matches('.grid-slider__btn--next') ? 1 : -1)));
        slider.dataset.matboxIndex = String(next);
        viewport?.scrollTo({ left: next * distance, behavior: 'auto' });
        return;
      }
    }

    if (target.matches('[data-drawer-menu-toggle]')) {
      event.preventDefault();
      setShellOpen($('[data-drawer-menu]'), target, true, 'matbox-drawer-menu-open');
      return;
    }
    if (target.matches('[data-drawer-menu-close],[data-drawer-menu-overlay]')) {
      event.preventDefault();
      closeShell('[data-drawer-menu]', '[data-drawer-menu-toggle]', 'matbox-drawer-menu-open');
      return;
    }
    if (target.matches('[data-search-drawer-toggle]')) {
      event.preventDefault();
      setShellOpen($('[data-search-drawer]'), target, true, 'matbox-search-open');
      return;
    }
    if (target.matches('[data-search-drawer-close],[data-search-drawer-overlay]')) {
      event.preventDefault();
      closeShell('[data-search-drawer]', '[data-search-drawer-toggle]', 'matbox-search-open');
      return;
    }
    if (target.matches('[data-localization-drawer-toggle]')) {
      event.preventDefault();
      setShellOpen($('[data-localization-drawer]'), target, true, 'matbox-localization-open');
      return;
    }
    if (target.matches('[data-localization-drawer-close],[data-localization-drawer-overlay]')) {
      event.preventDefault();
      closeShell('[data-localization-drawer]', '[data-localization-drawer-toggle]', 'matbox-localization-open');
      return;
    }
    if (target.closest('[data-consultation-modal-close]')) {
      event.preventDefault();
      event.stopPropagation();
      closeConsultationModal();
      return;
    }
    const slideoutTrigger = target.closest('[data-slideout]');
    if (slideoutTrigger) {
      event.preventDefault();
      event.stopPropagation();
      setCocoSlideoutOpen(slideoutTrigger.dataset.slideout || 'login');
      return;
    }
    if (target.matches('#slide-out--close')) {
      event.preventDefault();
      event.stopPropagation();
      closeCocoSlideout();
      return;
    }
    if (target.closest('[data-cart-trigger],#nav-preview-cart')) {
      event.preventDefault();
      openCart();
      return;
    }
    if (target.closest('[aria-controls="cart-drawer"],[data-testid="cart-drawer-trigger"]')) {
      event.preventDefault();
      openCart();
      return;
    }
    if (target.closest('[data-cart-drawer-close],[data-cart-drawer-overlay]')) {
      event.preventDefault();
      closeCart();
      return;
    }
    if (target.matches('[data-subscription-popup-close],[data-subscription-popup-dismiss]')) {
      event.preventDefault();
      const popup = target.closest('[data-subscription-popup],.subscription-popup');
      closeSubscriptionPopup(popup);
      return;
    }
    if (target.matches('[data-bundle-toggle-button]')) {
      event.preventDefault();
      toggleBundleItem(target);
      return;
    }
    if (target.matches('[data-bundle-qty-increase],[data-bundle-qty-decrease]')) {
      event.preventDefault();
      changeBundleQuantity(target, target.matches('[data-bundle-qty-increase]') ? 1 : -1);
      return;
    }
    if (target.matches('[data-bundle-submit]')) {
      event.preventDefault();
      addBundleToCart();
      return;
    }
    if (target.matches('[data-matbox-cart-remove]')) {
      event.preventDefault();
      const cart = readCart();
      cart.items = cart.items.filter((item) => String(item.id) !== target.dataset.matboxCartRemove);
      writeCart(cart);
      return;
    }
    if (target.matches('.ss-load-more[data-matbox-load-more="true"]')) {
      event.preventDefault();
      revealPrefetchedProducts(target);
      return;
    }
    if (target.matches('.ss-dropdown-button')) {
      event.preventDefault();
      const dropdown = target.closest('.ss-dropdown');
      const open = !dropdown?.classList.contains('matbox-facet-open');
      closeFacetDropdowns(dropdown);
      setFacetDropdownOpen(dropdown, open);
      return;
    }
    if (target.matches('.ss-dropdown-close,.ss-dropdown-filter-button')) {
      event.preventDefault();
      setFacetDropdownOpen(target.closest('.ss-dropdown'), false);
      return;
    }
    if (target.matches('.ss-dropdown-reset-button')) {
      event.preventDefault();
      const dropdown = target.closest('.ss-dropdown');
      $$('input[type="checkbox"]', dropdown).forEach((input) => { input.checked = false; });
      $$('input[type="range"]', dropdown).forEach((input) => {
        input.value = input.hasAttribute('aria-valuemin') && input === dropdown.querySelector('input[type="range"]')
          ? input.min
          : input.max;
        input.setAttribute('aria-valuenow', input.value);
      });
      dropdown?.classList.add('matbox-facet-reset');
      return;
    }
    if (target.matches('.product-card-swatch-button')) {
      event.preventDefault();
      selectProductSwatch(target);
      return;
    }
    if (target.matches('.product-card-wishlist button,[data-wishlist] button')) {
      event.preventDefault();
      toggleProductWishlist(target);
      return;
    }
    if (target.matches('[data-testid="cancel-button"]') && location.pathname === '/auth/v3/password/forgot') {
      event.preventDefault();
      location.href = '/hc/en-us/signin';
      return;
    }
    if (target.matches('.accordion-button[data-target]')) {
      event.preventDefault();
      setAccordionOpen(target, target.getAttribute('aria-expanded') !== 'true');
      return;
    }
    if (target.matches('.options-modal-button')) {
      event.preventDefault();
      const open = target.getAttribute('aria-expanded') !== 'true';
      target.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('matbox-product-options-open', open);
      const options = $('.productView-options');
      options?.setAttribute('aria-hidden', String(!open));
      if (open) options?.scrollIntoView({ block: 'start', behavior: 'auto' });
      return;
    }
    if (target.matches('.swatch-button.select-option')) {
      event.preventDefault();
      const modal = $('#fabric-modal');
      if (!modal) return;
      $$('.swatch-button.select-option').forEach((button) => button.setAttribute('aria-expanded', 'true'));
      modal.hidden = false;
      modal.style.display = 'block';
      modal.setAttribute('aria-hidden', 'false');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.classList.add('matbox-product-options-open');
      return;
    }
    if (target.closest('[data-fabric-modal-close],.fabric-modal-close-icon')) {
      event.preventDefault();
      const modal = target.closest('#fabric-modal,.fabric-modal');
      $$('.swatch-button.select-option').forEach((button) => button.setAttribute('aria-expanded', 'false'));
      if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.remove('matbox-product-options-open');
      return;
    }
    if (target.matches('#view-in-showroom-button,#view-in-store-button') || target.matches('#view-in-showroom-link-customize')) {
      event.preventDefault();
      const drawer = $('#view-in-store-drawer');
      if (!drawer) return;
      drawer.hidden = false;
      drawer.classList.add('is-open');
      drawer.setAttribute('aria-hidden', 'false');
      target.setAttribute('aria-expanded', 'true');
      document.body.classList.add('matbox-view-in-store-open');
      return;
    }
    if (target.closest('#vis-drawer-close,.vis-drawer__overlay')) {
      event.preventDefault();
      const drawer = target.closest('#view-in-store-drawer');
      drawer?.classList.remove('is-open');
      drawer?.setAttribute('aria-hidden', 'true');
      $$('#view-in-showroom-button,#view-in-store-button,#view-in-showroom-link-customize')
        .forEach((button) => button.setAttribute('aria-expanded', 'false'));
      document.body.classList.remove('matbox-view-in-store-open');
      return;
    }
    if (target.matches('.position-toggle-btn')) {
      event.preventDefault();
      const open = !target.classList.contains('active');
      target.classList.toggle('active', open);
      target.setAttribute('aria-pressed', String(open));
      target.setAttribute('aria-label', open ? 'Open position' : 'Closed position');
      const viewer = target.parentElement?.querySelector('cylindo-viewer,#cylindoView') || $('#cylindoView');
      viewer?.setAttribute('data-matbox-position', open ? 'open' : 'closed');
      return;
    }
    if (target.matches('button') && /^OUR GUIDE TO\s+/i.test(target.textContent.trim())) {
      event.preventDefault();
      const href = target.closest('a[href]')?.getAttribute('href');
      if (!href) return;
      const targetUrl = new URL(href, location.href);
      location.href = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
      return;
    }
    if (target.matches('[data-quantity-change] [data-action="inc"],[data-quantity-change] [data-action="dec"]')) {
      event.preventDefault();
      changeProductQuantity(target);
      return;
    }
    if (target.matches('.bc-carousel__arrow--left,.bc-carousel__arrow--right,.bc-carousel__bullet')) {
      event.preventDefault();
      const container = target.closest('[id^="bc-carousel-container-"]');
      const current = Number(container?.dataset.matboxCarouselIndex || 0);
      const requested = target.matches('.bc-carousel__bullet')
        ? Number(target.dataset.bulletIndex || 0)
        : current + (target.matches('.bc-carousel__arrow--right') ? 1 : -1);
      setCocoCarouselIndex(target, requested);
      return;
    }
    if (target.matches('.slick-prev,.slick-next')) {
      event.preventDefault();
      moveSlickGallery(target);
      return;
    }
    if (target.matches('input[type="submit"]') && !target.form) {
      event.preventDefault();
      document.body.dataset.matboxLastAction = `${target.value || 'submit'}:${Date.now()}`;
      showNotice('This action is available in the local demo', 'info');
      return;
    }
    if (target.matches('.payButton,.ja-button')) {
      event.preventDefault();
      document.body.dataset.matboxLastAction = `${target.textContent || target.value || 'action'}:${Date.now()}`;
      showNotice('This action is available in the local demo', 'info');
      return;
    }
    if (target.matches('[role="tab"]')) handleTabs(target);
    if (target.matches('summary')) {
      setTimeout(() => target.setAttribute('aria-expanded', String(Boolean(target.closest('details')?.open))), 0);
    }

    const anchor = target.closest('a[href]');
    if (!anchor || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const rawHref = anchor.getAttribute('href') || '';
    if (rawHref === '#' || rawHref.endsWith('/#')) {
      event.preventDefault();
      return;
    }
    const routeOverride = interactionRouteOverride(rawHref);
    if (routeOverride) {
      event.preventDefault();
      location.href = routeOverride;
      return;
    }
    const local = normalizeHref(rawHref);
    if (local) {
      event.preventDefault();
      location.href = local;
      return;
    }
    let url;
    try { url = new URL(anchor.href, location.href); } catch { return; }
    // Uncaptured storefront content must remain navigable. The browser follows
    // the original Shopify URL instead of silently turning the link into a
    // no-op. Production builds must capture these routes and fail their route
    // coverage gate before publishing; this live fallback is POC-only.
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches('[data-matbox-mattress-configuration]')) {
      event.preventDefault();
      const options = new FormData(form);
      form.querySelector('output').textContent = `${options.get('size')} · Left: ${options.get('leftComfort')} · Right: ${options.get('rightComfort')}`;
      document.body.dataset.matboxLastAction = `mattress-review:complete:${Date.now()}`;
      return;
    }
    if (form.matches('[data-cart-item-add]')) {
      event.preventDefault();
      addProductFormToCart(form);
      return;
    }
    const isNewsletter = form.matches('[data-newsletter-validate],.subscription-popup__form,.footer__newsletter-form');
    const isSearch = form.matches('[role="search"],[data-header-search-form]');
    if (!isNewsletter && !isSearch) return;
    event.preventDefault();
    const input = form.querySelector(isSearch ? 'input[type="search"],input[name="q"]' : 'input[type="email"]');
    if (!input?.value.trim()) {
      showNotice(t(isSearch ? 'notice.enterSearch' : 'notice.enterEmail'), 'error');
      input?.focus();
      return;
    }
    showNotice(isSearch ? t('notice.search', { query: input.value.trim() }) : t('notice.newsletter'), 'success');
  });

  document.addEventListener('submit', (event) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    document.body.dataset.matboxLastForm = `${event.target.action || location.pathname}:${Date.now()}`;
    showNotice('Form submitted in the local demo', 'success');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMegaNavigation();
    closeShell('[data-drawer-menu]', '[data-drawer-menu-toggle]', 'matbox-drawer-menu-open');
    closeShell('[data-search-drawer]', '[data-search-drawer-toggle]', 'matbox-search-open');
    closeShell('[data-localization-drawer]', '[data-localization-drawer-toggle]', 'matbox-localization-open');
    closeCart();
    closeCocoSlideout();
    closeConsultationModal();
  });

  function initialize() {
    closeCocoSlideout();
    prepareCocoCartDrawer();
    closeCart();
    renderConsultationModal();
    closeConsultationModal();
    setupReplayCarousels();
    setupMegaNavigation();
    setupCocoProductControls();
    setupCapturedOverflowLists();
    setupCocoAccordions();
    setupCocoCarousels();
    const subscriptionPopup = $('[data-subscription-popup]');
    let subscriptionDismissed = false;
    if (subscriptionPopup?.dataset.showOnce === 'true' && subscriptionPopup.dataset.dismissKey) {
      try {
        if (sessionStorage.getItem(`matbox-dismissed:${subscriptionPopup.dataset.dismissKey}`) === '1') {
          subscriptionDismissed = true;
          closeSubscriptionPopup(subscriptionPopup);
        }
      } catch {}
    }
    if (subscriptionPopup && !subscriptionDismissed) openSubscriptionPopup(subscriptionPopup);

    renderCart();
    updateBundle();
    window.MatboxLocale?.subscribe(() => {
      renderCart();
      updateBundle();
      renderConsultationModal();
    });
    window.MatboxInteractive = Object.freeze({
      version: VERSION,
      normalizeHref,
      readCart,
      showNotice,
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
