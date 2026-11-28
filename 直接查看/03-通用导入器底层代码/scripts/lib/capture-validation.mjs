export { auditPublishedSiteHtml } from './published-site-audit.mjs';
export { collectExternalMediaReferences, collectExternalMediaUrls, decodeCachedResourceText, sanitizePublishedHtml } from './published-site-sanitizer.mjs';

export function validateCapturedHtml(value, options = {}) {
  const html = String(value || '');
  const mode = options.mode === 'published' ? 'published' : 'source';
  const assetResolver = typeof options.assetResolver === 'function' ? options.assetResolver : () => false;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '';
  const baseHref = html.match(/<base\s+[^>]*href=["']([^"']+)/i)?.[1] || '';
  const failures = [];
  if (!html || html.includes('\0')) failures.push('invalid-html-bytes');
  if (mode === 'source' && !/^https:\/\//i.test(baseHref)) failures.push('missing-document-base');
  if (mode === 'published' && baseHref !== '/') failures.push('missing-published-base');
  const hasExternalStylesheet = [...html.matchAll(/<link\b[^>]*>/gi)].some(([tag]) => {
    if (!/\brel=["'][^"']*\bstylesheet\b/i.test(tag)) return false;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim() || '';
    if (!href || /^(?:data:|blob:)/i.test(href)) return false;
    if (mode === 'published' && /^\/component-library\/assets\//i.test(href)) return false;
    return true;
  });
  if (hasExternalStylesheet) failures.push('external-stylesheet-not-frozen');
  if (mode === 'published') {
    const isExternal = (url) => /^(?:https?:)?\/\//i.test(String(url || '').trim());
    const activeResourceAttributes = ['src', 'poster', 'data-src', 'data-lazy-src', 'data-original'];
    const responsiveResourceAttributes = ['srcset', 'data-srcset', 'data-lazy-srcset'];
    const failureSet = new Set();
    for (const attribute of activeResourceAttributes) {
      const pattern = new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*["']([^"']+)["']`, 'gi');
      for (const match of html.matchAll(pattern)) {
        if (isExternal(match[1])) failureSet.add(`external-published-resource:${attribute}`);
      }
    }
    for (const attribute of responsiveResourceAttributes) {
      const pattern = new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*["']([^"']+)["']`, 'gi');
      for (const match of html.matchAll(pattern)) {
        const candidates = String(match[1] || '').split(',').map((part) => part.trim().split(/\s+/)[0]);
        if (candidates.some(isExternal)) failureSet.add(`external-published-resource:${attribute}`);
      }
    }
    for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
      const href = tag[0].match(/(?:^|\s)href\s*=\s*["']([^"']+)["']/i)?.[1];
      if (isExternal(href)) failureSet.add('external-published-resource:href');
    }
    for (const match of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
      if (isExternal(match[2])) failureSet.add('external-published-resource:css-url');
    }
    failures.push(...failureSet);
    const assetReferences = [...new Set(
      [...html.matchAll(/(?:href|src|poster)\s*=\s*["'](\/component-library\/assets\/[^"']+)["']/gi)]
        .map((match) => match[1]),
    )];
    for (const href of assetReferences) {
      if (!assetResolver(href)) failures.push(`unresolved-published-asset:${href}`);
    }
  }
  if (/\.myshopify\.com(?:\/|$)/i.test(baseHref) && !/shopify-section-/i.test(html)) failures.push('missing-shopify-section');
  if (/<(?:div|section)[^>]+id=["']searchspring-category["'][^>]*>\s*<\/(?:div|section)>/i.test(html)) failures.push('commerce-content-not-ready');
  const unprefetchedLoadMore = [...html.matchAll(/<button\b[^>]*>/gi)].some(([tag]) => (
    /class=["'][^"']*\bss-load-more\b/i.test(tag)
    && !/data-matbox-load-more=["']true["']/i.test(tag)
    && !/\bhidden(?:\s|=|>)/i.test(tag)
    && !/aria-hidden=["']true["']/i.test(tag)
  ));
  if (unprefetchedLoadMore) failures.push('load-more-not-prefetched');
  if (/just a moment|checking your browser|verify (?:that )?you are human|请稍候|正在验证/i.test(`${title} ${html.slice(0, 5000)}`)) failures.push('source-verification-challenge');
  if (/something went wrong|too many requests|temporarily unavailable|access denied/i.test(title)) failures.push('error-page');
  return { pass: failures.length === 0, failures };
}

export function validateCapturedPage(result, options = {}) {
  const html = String(result?.renderedDocument?.html || '');
  const failures = [...validateCapturedHtml(html, options).failures];
  const interactionCount = result?.interactiveElements?.length || 0;
  const completeSparseForm = /<form\b/i.test(html)
    && /<input\b[^>]*(?:\btype=["'](?:email|password)["']|\bautocomplete=["']email["'])/i.test(html)
    && /<(?:button|input)\b[^>]*(?:type=["']submit["']|>\s*(?:sign in|submit))/i.test(html)
    && interactionCount >= 3;
  if (interactionCount < 10 && !completeSparseForm) failures.push('interaction-inventory-too-small');
  if ((result?.metadata?.visualReadiness?.pendingImages || 0) > 0) failures.push('pending-images');
  if ((result?.metadata?.visualReadiness?.failedImages || 0) > 0) failures.push('failed-images');
  if ((result?.metadata?.visualReadiness?.pendingBackgroundImages || 0) > 0) failures.push('pending-background-images');
  if ((result?.metadata?.visualReadiness?.failedBackgroundImages || 0) > 0) failures.push('failed-background-images');
  if ((result?.metadata?.visualReadiness?.pendingStylesheets || 0) > 0) failures.push('pending-stylesheets');
  if ((result?.metadata?.visualReadiness?.failedStylesheets || 0) > 0) failures.push('failed-stylesheets');
  if ((result?.metadata?.visualReadiness?.uncapturedStylesheets || 0) > 0) failures.push('uncaptured-stylesheets');
  if ((result?.metadata?.visualReadiness?.failedFonts || 0) > 0) failures.push('failed-fonts');
  if ((result?.metadata?.visualReadiness?.uncapturedFonts || 0) > 0) failures.push('uncaptured-fonts');
  if ((result?.metadata?.visualReadiness?.horizontalOverflowPx || 0) > 2) failures.push('horizontal-overflow');
  return { pass: failures.length === 0, failures };
}
