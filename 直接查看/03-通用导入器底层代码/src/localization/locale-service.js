// Shared browser contract. Store-specific packs and DOM adapters live with each site.
(() => {
  'use strict';

  const config = window.MatboxLocalePacks;
  const defaultLocale = config.defaultLocale;
  const supported = new Set(config.supportedLocales);
  const storageKey = 'matbox-locale';
  const listeners = new Set();
  const missing = new Map();
  const valid = (value) => supported.has(value);
  const urlLocale = new URL(location.href).searchParams.get('lang');
  let savedLocale;
  try { savedLocale = localStorage.getItem(storageKey); } catch {}
  let locale = valid(urlLocale) ? urlLocale : valid(savedLocale) ? savedLocale : defaultLocale;

  function syncDocument(replace = false) {
    document.documentElement.lang = locale;
    const url = new URL(location.href);
    if (locale === defaultLocale && !url.searchParams.has('lang')) return;
    url.searchParams.set('lang', locale);
    if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState'](history.state, '', url);
  }

  function substitute(value, params = {}) {
    return String(value).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key) =>
      Object.hasOwn(params, key) ? String(params[key]) : match);
  }

  function lookup(source, key, field, params) {
    const local = field ? source[locale]?.[key]?.[field] : source[locale]?.[key];
    const fallback = field ? source[defaultLocale]?.[key]?.[field] : source[defaultLocale]?.[key];
    if (local === undefined && locale !== defaultLocale) missing.set(`${key}${field ? `.${field}` : ''}`, { locale, key, field: field || null, path: location.pathname });
    return substitute(local ?? fallback ?? key, params);
  }

  function setLocale(nextLocale) {
    if (!valid(nextLocale)) return false;
    locale = nextLocale;
    try { localStorage.setItem(storageKey, locale); } catch {}
    syncDocument();
    missing.clear();
    listeners.forEach((listener) => listener(locale));
    return true;
  }

  window.addEventListener('popstate', () => {
    const next = new URL(location.href).searchParams.get('lang');
    locale = valid(next) ? next : defaultLocale;
    document.documentElement.lang = locale;
    listeners.forEach((listener) => listener(locale));
  });
  syncDocument(true);

  window.MatboxLocale = Object.freeze({
    getLocale: () => locale,
    setLocale,
    t: (key, params) => lookup(config.messages, key, null, params),
    getContent: (id, field, params) => lookup(config.content, id, field, params),
    formatNumber: (value) => new Intl.NumberFormat(locale).format(value),
    formatMoney: (value, currency) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getMissingTranslations: () => Array.from(missing.values()),
    getSupportedLocales: () => [...supported],
  });
})();
