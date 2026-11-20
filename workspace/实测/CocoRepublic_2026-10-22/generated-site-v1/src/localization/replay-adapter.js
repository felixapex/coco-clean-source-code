(() => {
  'use strict';

  const locale = window.MatboxLocale;
  const sourceText = new WeakMap();
  const sourceAttributes = new WeakMap();
  const sourceBlocks = new WeakMap();
  const uiBindings = new Map([
    ['Home', 'nav.home'], ['Shop All', 'nav.shopAll'], ['Collections', 'nav.collections'],
    ['About', 'nav.about'], ['Journal', 'nav.journal'], ['Contact', 'nav.contact'],
    ['Bedroom', 'nav.bedroom'], ['Tables', 'nav.tables'], ['Dining Room', 'nav.diningRoom'],
    ['Living Room', 'nav.livingRoom'], ['Chairs', 'nav.chairs'],
    ['View Collection', 'action.viewCollection'], ['VIEW COLLECTION', 'action.viewCollection'],
    ['NEW COLLECTION', 'action.newCollection'], ['Discover our collection', 'action.discoverCollection'],
    ['Read story', 'action.readStory'], ['READ STORY', 'action.readStory'],
    ['Region & language', 'locale.title'], ['Region', 'locale.region'], ['Language', 'locale.language'],
    ['Filter', 'filter.filter'], ['Sort by', 'filter.sortBy'],
    ['Your cart', 'cart.title'], ['Your cart is currently empty.', 'cart.empty'], ['Remove', 'cart.remove'],
    ['Add to bundle', 'bundle.add'], ['Added to bundle', 'bundle.added'],
  ]);
  const contentBindings = new Map([
    ['Make Your House', 'majestic.home.heroLead'],
    ['Feel Like Home', 'majestic.home.heroTitle'],
    ['Thoughtfully designed pieces made with premium materials, crafted for comfort, built to last, and styled to feel like home.', 'majestic.home.heroDescription'],
    ['Spaces That Define Your Home', 'majestic.home.spacesHeading'],
    ['Spaces That Tell Your Story', 'majestic.home.editorialHeading'],
    ['Subscribe to our newsletter', 'majestic.home.newsletterHeading'],
    ['Your bundle', 'majestic.home.bundleHeading'],
  ]);
  let lastTranslated = 0;
  let ready = false;
  const originalTitle = document.title;

  function localizeText() {
    let count = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,textarea,code')) continue;
      const original = sourceText.get(node) ?? node.nodeValue;
      const plain = original.trim();
      const uiKey = uiBindings.get(plain);
      const contentId = contentBindings.get(plain);
      const literalExists = Object.values(window.MatboxLocalePacks.literal || {}).some((pack) => Object.hasOwn(pack, plain));
      const bundleMatch = plain.match(/^Add to bundle (.+)$/);
      const productCountMatch = plain.match(/^(\d+) products?$/i);
      const productRangeMatch = plain.match(/^(\d+) of (\d+) products?$/i);
      let literal = locale.getLocale() === 'en' && literalExists ? plain : window.MatboxLocalePacks.literal?.[locale.getLocale()]?.[plain];
      if (bundleMatch && locale.getLocale() !== 'en') {
        const product = window.MatboxLocalePacks.literal?.[locale.getLocale()]?.[bundleMatch[1]] || bundleMatch[1];
        literal = `将 ${product} 加入组合`;
      }
      if (productCountMatch && locale.getLocale() !== 'en') literal = `${productCountMatch[1]} 件商品`;
      if (productRangeMatch && locale.getLocale() !== 'en') literal = `已显示 ${productRangeMatch[1]} / ${productRangeMatch[2]} 件商品`;
      if (!uiKey && !contentId && !literalExists && !bundleMatch && !productCountMatch && !productRangeMatch) continue;
      if (!sourceText.has(node)) sourceText.set(node, original);
      const translated = literal ?? (uiKey ? locale.t(uiKey) : locale.getContent(contentId, 'text'));
      const next = original.replace(plain, translated);
      if (node.nodeValue !== next) node.nodeValue = next;
      count++;
    }
    lastTranslated = count;
  }

  function localizeBlocks() {
    for (const block of document.querySelectorAll('.testimonial-spotlight__quote')) {
      if (!sourceBlocks.has(block)) sourceBlocks.set(block, { html: block.innerHTML, text: block.textContent.replace(/\s+/g, ' ').trim() });
      const source = sourceBlocks.get(block);
      if (locale.getLocale() === 'en') block.innerHTML = source.html;
      else {
        const translation = window.MatboxLocalePacks.blocks?.[locale.getLocale()]?.[source.text];
        if (translation) {
          const paragraph = document.createElement('p');
          paragraph.textContent = translation;
          block.replaceChildren(paragraph);
        }
      }
    }
  }

  function localizeAttributes() {
    for (const element of document.querySelectorAll('[alt],[aria-label],[placeholder]')) {
      let originals = sourceAttributes.get(element);
      if (!originals) { originals = {}; sourceAttributes.set(element, originals); }
      for (const attribute of ['alt', 'aria-label', 'placeholder']) {
        if (!element.hasAttribute(attribute)) continue;
        if (!(attribute in originals)) originals[attribute] = element.getAttribute(attribute);
        const original = originals[attribute];
        const key = uiBindings.get(original);
        const contentId = contentBindings.get(original);
        const literalExists = Object.values(window.MatboxLocalePacks.literal || {}).some((pack) => Object.hasOwn(pack, original));
        const literal = locale.getLocale() === 'en' && literalExists ? original : window.MatboxLocalePacks.literal?.[locale.getLocale()]?.[original];
        if (!key && !contentId && !literalExists) continue;
        const translated = literal ?? (key ? locale.t(key) : locale.getContent(contentId, 'text'));
        if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
      }
    }
  }

  function ensureLanguageOptions() {
    const panel = document.querySelector('[data-localization-tab-panel="language"]');
    if (!panel) return;
    const english = panel.querySelector('[name="locale_code"][value="en"]');
    if (!english) return;
    if (!panel.querySelector('[name="locale_code"][value="zh-CN"]')) {
      const item = english.closest('li').cloneNode(true);
      const option = item.querySelector('[name="locale_code"]');
      option.value = 'zh-CN';
      option.classList.remove('is-selected');
      option.setAttribute('aria-selected', 'false');
      item.querySelector('.localization-drawer__option-name').textContent = '简体中文';
      english.closest('li').after(item);
    }
    for (const option of panel.querySelectorAll('[name="locale_code"]')) {
      const available = locale.getSupportedLocales().includes(option.value);
      option.disabled = !available;
      option.closest('li').hidden = !available;
      if (!available) option.closest('li').style.display = 'none';
      const selected = option.value === locale.getLocale();
      option.classList.toggle('is-selected', selected);
      option.setAttribute('aria-selected', String(selected));
    }
    const displayNames = new Intl.DisplayNames([locale.getLocale()], { type: 'region' });
    for (const option of document.querySelectorAll('[name="country_code"]')) {
      const name = option.querySelector('.localization-drawer__option-name');
      if (!name) continue;
      if (!name.dataset.matboxSourceText) name.dataset.matboxSourceText = name.textContent.trim();
      name.textContent = locale.getLocale() === 'en' ? name.dataset.matboxSourceText : (displayNames.of(option.value) || name.dataset.matboxSourceText);
    }
  }

  function updateSwitcher() {
    const chinese = locale.getLocale() === 'zh-CN';
    const label = chinese ? '简体中文' : 'English';
    for (const trigger of document.querySelectorAll('[data-localization-drawer-toggle]')) {
      trigger.setAttribute('aria-label', `${chinese ? '美国' : 'United States'} (USD $) / ${label}`);
      const secondary = trigger.querySelector('.localization-switcher__label-secondary');
      if (secondary) secondary.textContent = chinese ? 'USD / 中文' : 'USD / EN';
      const footer = trigger.matches('.footer__localization-trigger') && trigger.querySelector('.localization-switcher__label-primary');
      if (footer) footer.textContent = `${chinese ? '美国' : 'United States'} (USD $) / ${label}`;
    }
  }

  function apply() {
    if (!document.body) return;
    ensureLanguageOptions();
    localizeBlocks();
    localizeText();
    localizeAttributes();
    updateSwitcher();
    document.title = locale.getLocale() === 'zh-CN' ? `家居商店 | ${originalTitle}` : originalTitle;
    ready = true;
  }

  function untranslatedVisible() {
    if (locale.getLocale() === 'en') return [];
    const allowed = new Set(window.MatboxLocalePacks.protectedLatin || []);
    const values = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      const text = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (!element || !text || !/[A-Za-z]{2}/.test(text) || /[\u3400-\u9fff]/.test(text)) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (element.hidden || style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height) continue;
      if (allowed.has(text) || /^@/.test(text) || /^© \d{4}, Majestic$/.test(text) || /^\$[\d,.]+ USD$/.test(text)) continue;
      values.add(text);
    }
    return [...values].sort();
  }

  document.addEventListener('click', (event) => {
    const option = event.target.closest('[data-localization-tab-panel="language"] [name="locale_code"]');
    if (!option) return;
    event.preventDefault();
    if (locale.setLocale(option.value)) {
      const drawer = document.querySelector('[data-localization-drawer]');
      if (drawer) {
        drawer.hidden = true;
        drawer.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.remove('matbox-localization-open');
    }
  }, true);

  document.addEventListener('submit', (event) => {
    if (!event.target.matches('form[action*="/localization"]')) return;
    event.preventDefault();
    event.stopPropagation();
    const code = event.submitter?.value;
    if (event.submitter?.name === 'locale_code' && code) locale.setLocale(code);
  }, true);

  locale.subscribe(apply);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();

  window.MatboxReplayLocale = Object.freeze({
    apply,
    get ready() { return ready; },
    report() { return { status: 'partial-demo', locale: locale.getLocale(), translatedNodes: lastTranslated, missing: locale.getMissingTranslations(), untranslatedVisible: untranslatedVisible() }; },
  });
})();
