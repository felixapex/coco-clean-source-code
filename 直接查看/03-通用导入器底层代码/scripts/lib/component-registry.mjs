import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildImportFoundationRecords as buildSharedImportFoundationRecords,
  createImportFoundationAccumulator as createSharedImportFoundationAccumulator,
} from '../../src/import-foundation/registry-adapter.mjs';
import { convertMarkupToEditableSection } from './editable-component-contract.mjs';

function hash(value, length = 12) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function kebab(value) {
  return String(value || 'generic')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'generic';
}

function sourceType(sectionId) {
  const marker = sectionId.lastIndexOf('__');
  return kebab(marker >= 0 ? sectionId.slice(marker + 2) : sectionId);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function assetExtension(mimeType) {
  return ({
    'text/css': 'css',
    'application/font-woff': 'woff',
    'application/font-woff2': 'woff2',
    'application/x-font-opentype': 'otf',
    'application/x-font-truetype': 'ttf',
    'font/otf': 'otf',
    'font/ttf': 'ttf',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/svg+xml': 'svg',
    'image/webp': 'webp',
  })[mimeType] || 'bin';
}

function decodeDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const metadata = dataUrl.slice(5, comma);
  const mimeType = (metadata.split(';')[0] || 'application/octet-stream').toLowerCase();
  if (mimeType !== 'text/css' && !/^(?:image|font)\//.test(mimeType) && !/^application\/(?:font|x-font-)/.test(mimeType)) return null;
  const payload = dataUrl.slice(comma + 1);
  try {
    const buffer = /;base64(?:;|$)/i.test(metadata)
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

function registerAsset(dataUrl, assetsByHref) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded) return null;
  const assetId = hash(`${decoded.mimeType}\n${dataUrl}`, 24);
  const extension = assetExtension(decoded.mimeType);
  const href = `/component-library/assets/${assetId}.${extension}`;
  if (!assetsByHref.has(href)) {
    assetsByHref.set(href, {
      assetId,
      href,
      mimeType: decoded.mimeType,
      extension,
      byteLength: decoded.buffer.length,
      buffer: decoded.buffer,
    });
  }
  return href;
}

function externalizePageAssets(html, assetsByHref) {
  let output = String(html || '').replace(/\b(src|poster)\s*=\s*(["'])(data:[^"']+)\2/gi, (full, attribute, quote, dataUrl) => {
    const href = registerAsset(dataUrl, assetsByHref);
    return href ? `${attribute}=${quote}${href}${quote}` : full;
  });
  output = output.replace(/\bhref\s*=\s*(["'])(data:text\/css[^"']+)\1/gi, (full, quote, dataUrl) => {
    const href = registerAsset(dataUrl, assetsByHref);
    return href ? `href=${quote}${href}${quote}` : full;
  });
  output = output.replace(/url\(\s*(["'])(data:[^"']+)\1\s*\)/gi, (full, quote, dataUrl) => {
    const href = registerAsset(dataUrl, assetsByHref);
    return href ? `url(${quote}${href}${quote})` : full;
  });
  output = output.replace(/url\(\s*(data:[^)\s"']+)\s*\)/gi, (full, dataUrl) => {
    const href = registerAsset(dataUrl, assetsByHref);
    return href ? `url("${href}")` : full;
  });
  return output;
}

export function normalizeReplayBase(html) {
  const source = String(html || '');
  if (/<base\b[^>]*>/i.test(source)) return source.replace(/<base\b[^>]*>/i, '<base href="/">');
  return source.replace(/<head\b([^>]*)>/i, '<head$1><base href="/">');
}

function normalizeRoutePath(pathname) {
  const value = String(pathname || '/').replace(/\/{2,}/g, '/');
  return value === '/' ? '/' : value.replace(/\/$/, '');
}

function canonicalStorefrontHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function zendeskRelatedArticleRoute(target) {
  if (!/\/hc\/[^/]+\/related\/click$/i.test(target.pathname)) return null;
  const signedPayload = target.searchParams.get('data') || '';
  const encodedPayload = signedPayload.split('--', 1)[0];
  if (!encodedPayload) return null;
  try {
    const decoded = Buffer.from(encodedPayload, 'base64').toString('utf8');
    return decoded.match(/\/hc\/[a-z]{2}(?:-[a-z]{2})?\/articles\/[A-Za-z0-9_-]+/i)?.[0] || null;
  } catch {
    return null;
  }
}

function embeddedAbsoluteUrl(rawHref) {
  const decodedSpaces = String(rawHref || '').replace(/%20/gi, ' ');
  const match = decodedSpaces.match(/^\/?(https?):\/+(.+)$/i)
    || decodedSpaces.match(/(?:^|\/)\s+(https?):\/+(.+)$/i);
  if (!match) return null;
  try { return new URL(`${match[1]}://${match[2]}`); } catch { return null; }
}

export function replaySourceOrigin(html) {
  const source = String(html || '');
  const baseHref = source.match(/<base\b[^>]*href=["']([^"']+)/i)?.[1] || '';
  const referenceHref = source.match(/<meta\s+name=["']matbox-reference-url["']\s+content=["']([^"']+)["']/i)?.[1] || '';
  const value = baseHref === '/' ? referenceHref : baseHref;
  if (!value) return '';
  try { return new URL(value).origin; } catch { return ''; }
}

export function localizeCapturedRouteLinks(html, {
  sourceOrigin,
  capturedOrigins = [],
  capturedRoutes = [],
  localizeAllSourceLinks = false,
} = {}) {
  const sourceUrl = new URL(sourceOrigin);
  const origin = sourceUrl.origin;
  const sourceHost = canonicalStorefrontHost(sourceUrl.hostname);
  const knownOrigins = new Set([origin, ...capturedOrigins].map((value) => {
    try { return new URL(value).origin; } catch { return ''; }
  }).filter(Boolean));
  const knownRoutes = new Set(capturedRoutes.map(normalizeRoutePath));
  return String(html || '').replace(/\bhref\s*=\s*(["'])([^"']+)\1/gi, (full, quote, rawHref) => {
    if (/^(?:#|mailto:|tel:|sms:|javascript:|data:)/i.test(rawHref)) return full;
    const decodedHref = rawHref.replaceAll('&amp;', '&');
    const embeddedTarget = embeddedAbsoluteUrl(decodedHref);
    let target;
    try { target = embeddedTarget || new URL(decodedHref, origin); } catch { return full; }
    const isSourceStorefront = target.origin === origin
      || (/^https?:$/.test(target.protocol) && canonicalStorefrontHost(target.hostname) === sourceHost);
    const cleanedPathname = target.pathname.replace(/(?:(?:%7C)|\|)+$/gi, '') || '/';
    const targetRoute = normalizeRoutePath(cleanedPathname);
    const isCapturedSourceRoute = knownOrigins.has(target.origin)
      && (localizeAllSourceLinks || knownRoutes.has(targetRoute));
    if (!isSourceStorefront && !isCapturedSourceRoute) return embeddedTarget ? `href=${quote}${target.href}${quote}` : full;
    const relatedArticleRoute = zendeskRelatedArticleRoute(target);
    if (relatedArticleRoute && (localizeAllSourceLinks || knownRoutes.has(normalizeRoutePath(relatedArticleRoute)))) {
      return `href=${quote}${normalizeRoutePath(relatedArticleRoute)}${quote}`;
    }
    const nestedTarget = embeddedAbsoluteUrl(`${target.pathname}${target.search}${target.hash}`);
    if (nestedTarget) return `href=${quote}${nestedTarget.href}${quote}`;
    const route = targetRoute;
    if (!localizeAllSourceLinks && !knownRoutes.has(route)) return full;
    return `href=${quote}${route}${target.search}${target.hash}${quote}`;
  });
}

export function restoreFrozenVideoBackgrounds(html) {
  // The capture step has already replaced each video with the exact painted
  // frame used by the source screenshot.  Keep that image intact: converting
  // it to an empty div discards its `src` after asset externalisation and
  // leaves every frozen-video hero blank in the published replay.
  return String(html || '');
}

export function externalizePageAssetBundle(pages) {
  const assetsByHref = new Map();
  const normalizedPages = pages.map((page) => ({ ...page, html: externalizePageAssets(page.html, assetsByHref) }));
  return {
    pages: normalizedPages,
    assets: [...assetsByHref.values()].sort((a, b) => a.href.localeCompare(b.href)),
  };
}

export function hydratePageAssetsForValidation(html, assets = []) {
  const byHref = new Map((assets || []).filter((asset) => asset?.href && asset?.buffer).map((asset) => [asset.href, asset]));
  const dataByHref = new Map();
  const asDataUrl = (mimeType, buffer) => `data:${mimeType || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;

  for (const [href, asset] of byHref) {
    if (String(asset.mimeType).toLowerCase() === 'text/css') continue;
    dataByHref.set(href, asDataUrl(asset.mimeType, asset.buffer));
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [href, asset] of byHref) {
      if (String(asset.mimeType).toLowerCase() !== 'text/css') continue;
      let css = Buffer.from(asset.buffer).toString('utf8');
      for (const [assetHref, dataUrl] of dataByHref) css = css.split(assetHref).join(dataUrl);
      dataByHref.set(href, asDataUrl('text/css', Buffer.from(css, 'utf8')));
    }
  }
  let output = String(html || '');
  for (const [href, dataUrl] of dataByHref) output = output.split(href).join(dataUrl);
  return output;
}

function attributeNames(markup) {
  return unique([...markup.matchAll(/\s([:@a-zA-Z_][\w:.-]*)\s*(?:=|(?=\s|>))/g)].map((match) => match[1].toLowerCase())).sort();
}

function structuralSignature(markup, type) {
  const tags = [...markup.matchAll(/<([a-zA-Z][\w:-]*)\b/g)].map((match) => match[1].toLowerCase());
  const classes = unique([...markup.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gi)]
    .flatMap((match) => match[2].split(/\s+/))
    .filter((name) => name && !/^(?:is-|has-|active|open|hidden)/.test(name)))
    .sort();
  const interactiveRoles = unique([...markup.matchAll(/<(a|button|summary|form|input|select|textarea)\b/gi)].map((match) => match[1].toLowerCase())).sort();
  return JSON.stringify({ type, tags, classes, attributes: attributeNames(markup), interactiveRoles });
}

const VOID_ELEMENTS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const SUPPORT_ONLY_ELEMENTS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'template']);

function genericSectionType(opening, tag, index) {
  const id = opening.match(/\sid\s*=\s*(["'])([^"']+)\1/i)?.[2];
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const classNames = opening.match(/\bclass\s*=\s*(["'])([^"']+)\1/i)?.[2]
    ?.split(/\s+/)
    .map(kebab)
    .filter((name) => name && !/^(?:container|wrapper|row|column|grid|section)$/.test(name));
  if (classNames?.[0]) return classNames[0];
  if (id && !/^\d+$/.test(id) && !uuidLike.test(id)) return kebab(id.replace(/^shopify-section-/, ''));
  if (/\bdata-widget-id\s*=/i.test(opening)) return 'widget';
  return kebab(tag) || `region-${index + 1}`;
}

function directElementOpenings(html, container) {
  const containerTag = container.tag;
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;
  tokenPattern.lastIndex = container.index + container.opening.length;
  const openings = [];
  let depth = 0;
  let activeDirect = null;
  for (let match = tokenPattern.exec(html); match; match = tokenPattern.exec(html)) {
    if (!match[1]) continue;
    const tag = match[1].toLowerCase();
    const closing = /^<\//.test(match[0]);
    if (closing) {
      if (depth === 0 && tag === containerTag) break;
      if (depth === 1 && activeDirect) {
        activeDirect.endIndex = tokenPattern.lastIndex;
        activeDirect = null;
      }
      depth = Math.max(0, depth - 1);
      continue;
    }
    const selfClosing = /\/\s*>$/.test(match[0]) || VOID_ELEMENTS.has(tag);
    if (depth === 0) {
      const type = genericSectionType(match[0], tag, openings.length);
      const entry = {
        index: match.index,
        tag,
        sourceSectionId: `generic-${openings.length + 1}__${type}`,
        opening: match[0],
      };
      if (selfClosing) entry.endIndex = tokenPattern.lastIndex;
      else activeDirect = entry;
      openings.push(entry);
    }
    if (!selfClosing) depth += 1;
  }
  return openings;
}

function elementEndIndex(html, entry) {
  if (Number.isInteger(entry?.endIndex)) return entry.endIndex;
  if (!entry?.tag || !Number.isInteger(entry?.index)) return null;
  if (/\/\s*>$/.test(entry.opening) || VOID_ELEMENTS.has(entry.tag)) {
    return entry.index + entry.opening.length;
  }
  const tokenPattern = new RegExp(`<\\/?${entry.tag}\\b[^>]*>`, 'gi');
  tokenPattern.lastIndex = entry.index + entry.opening.length;
  let depth = 1;
  for (let match = tokenPattern.exec(html); match; match = tokenPattern.exec(html)) {
    if (/^<\//.test(match[0])) depth -= 1;
    else if (!/\/\s*>$/.test(match[0])) depth += 1;
    if (depth === 0) return tokenPattern.lastIndex;
  }
  return null;
}

function isIgnoredGenericOpening(html, entry) {
  if (SUPPORT_ONLY_ELEMENTS.has(entry.tag)) return true;
  const id = entry.opening.match(/\sid\s*=\s*(["'])([^"']+)\1/i)?.[2]?.toLowerCase();
  const classes = entry.opening.match(/\bclass\s*=\s*(["'])([^"']+)\1/i)?.[2]
    ?.toLowerCase()
    .split(/\s+/)
    .filter(Boolean) ?? [];
  if (id === 'searchspring-product' || classes.includes('sr-only')) return true;
  const type = sourceType(entry.sourceSectionId);
  const widgetCandidate = type === 'widget';
  const emptyLayoutCandidate = type === 'div'
    || widgetCandidate
    || type === 'clearfix'
    || type === 'clp-header'
    || type === 'full-plp-top'
    || type === 'page-content'
    || type === 'page-type-interior-design'
    || /\bdata-content-region\s*=/i.test(entry.opening);
  if (!emptyLayoutCandidate || !Number.isInteger(entry.endIndex)) return false;
  const markup = html.slice(entry.index, entry.endIndex);
  const inner = markup
    .slice(entry.opening.length)
    .replace(new RegExp(`<\\/${entry.tag}\\s*>\\s*$`, 'i'), '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (inner.length === 0) return true;
  if (widgetCandidate && /(?:^|[-_])spacer(?:[-_]|$)/i.test(inner)) return false;
  const contentWithoutSupport = inner
    .replace(/<(?:script|style|noscript|template)\b[\s\S]*?<\/(?:script|style|noscript|template)>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const visibleText = contentWithoutSupport
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasRenderedNode = /<(?:img|picture|video|audio|iframe|canvas|svg|input|button|select|textarea|form|a)\b/i.test(contentWithoutSupport);
  const hasNestedElement = /<[a-zA-Z][\w:-]*\b/i.test(contentWithoutSupport);
  const hasVisualBackground = /background(?:-image)?\s*:[^;}]*?(?:url\(|gradient\()/i.test(markup);
  if (widgetCandidate && visibleText.length === 0 && !hasRenderedNode && !hasNestedElement) return true;
  return visibleText.length === 0 && !hasRenderedNode && !hasVisualBackground;
}

function hasNamespacedSemanticChildren(html, entry) {
  const children = directElementOpenings(html, entry)
    .filter((child) => !isIgnoredGenericOpening(html, child));
  if (children.length < 3) return false;

  const semanticTypes = children.map((child, index) => genericSectionType(child.opening, child.tag, index));
  if (semanticTypes.some((type) => ['div', 'section', 'article', 'widget', 'generic'].includes(type))) return false;
  const namespaces = semanticTypes.map((type) => type.match(/^([a-z][a-z0-9]{1,11})-/)?.[1]);
  return namespaces.every(Boolean) && new Set(namespaces).size === 1;
}

function isNamespacedMultiSectionContainer(html, entry) {
  const type = genericSectionType(entry.opening, entry.tag, 0);
  const isCustomWidget = /\bdata-widget-id\s*=/i.test(entry.opening);

  if (isCustomWidget && hasNamespacedSemanticChildren(html, entry)) return true;
  if (!isCustomWidget) {
    return /-page$/.test(type) && hasNamespacedSemanticChildren(html, entry);
  }

  const children = directElementOpenings(html, entry)
    .filter((child) => !isIgnoredGenericOpening(html, child));
  if (children.length !== 1) return false;
  const childType = genericSectionType(children[0].opening, children[0].tag, 0);
  return /-page$/.test(childType) && hasNamespacedSemanticChildren(html, children[0]);
}

function isTransparentGenericWrapper(html, entry) {
  if (/\bdata-content-region\s*=\s*(["'])[^"']+\1/i.test(entry.opening)) return true;
  if (/\bdata-(?:layout-id|sub-layout-container|sub-layout)\s*=/i.test(entry.opening)
    && !/\bdata-widget-id\s*=/i.test(entry.opening)) return true;
  if (isNamespacedMultiSectionContainer(html, entry)) return true;
  const type = sourceType(entry.sourceSectionId);
  if (['top-level-container', 'top-level', 'main', 'page', 'page-content', 'content-wrapper', 'container-plp-landing', 'clp-header'].includes(type)) return true;
  const classes = entry.opening.match(/\bclass\s*=\s*(["'])([^"']+)\1/i)?.[2]
    ?.toLowerCase()
    .split(/\s+/)
    .filter(Boolean) ?? [];
  return classes.length > 0 && classes.every((name) => [
    'container', 'wrapper', 'main', 'full', 'page', 'page-content', 'content', 'top_level_container',
  ].includes(name));
}

function expandGenericSectionOpenings(html, container, depth = 0) {
  const meaningful = directElementOpenings(html, container)
    .filter((entry) => !isIgnoredGenericOpening(html, entry));
  if (depth >= 8) return meaningful;

  return meaningful.flatMap((entry) => {
    if (!isTransparentGenericWrapper(html, entry)) return [entry];
    const nested = expandGenericSectionOpenings(html, entry, depth + 1);
    return nested.length > 0 ? nested : [entry];
  });
}

function genericSectionOpenings(html) {
  const containerMatch = /<(main)\b[^>]*>/i.exec(html) || /<(body)\b[^>]*>/i.exec(html);
  if (!containerMatch) return [];
  const container = {
    index: containerMatch.index,
    tag: containerMatch[1].toLowerCase(),
    opening: containerMatch[0],
  };
  return expandGenericSectionOpenings(html, container)
    .map((entry, index) => {
      const type = genericSectionType(entry.opening, entry.tag, index);
      const widgetId = entry.opening.match(/\bdata-widget-id\s*=\s*(["'])([^"']+)\1/i)?.[2];
      const sourceSectionId = widgetId
        ? `widget-${widgetId}__${type}`
        : `generic-${index + 1}__${type}`;
      return { ...entry, sourceSectionId };
    });
}

function sectionOpenings(html) {
  const pattern = /<([a-zA-Z][\w:-]*)\b[^>]*\bid\s*=\s*(["'])shopify-section-([^"']+)\2[^>]*>/gi;
  const shopify = [...html.matchAll(pattern)].map((match) => {
    const entry = { index: match.index, tag: match[1].toLowerCase(), sourceSectionId: match[3], opening: match[0] };
    return { ...entry, endIndex: elementEndIndex(html, entry) };
  });
  return shopify.length ? shopify : genericSectionOpenings(html);
}

export function extractComponentOpeningRecords(html) {
  return sectionOpenings(String(html || '')).map((entry) => ({
    index: entry.index,
    opening: entry.opening,
    sourceSectionId: entry.sourceSectionId,
    tag: entry.tag,
  }));
}

function blockIds(markup) {
  return unique([
    ...[...markup.matchAll(/\bdata-block-id\s*=\s*(["'])([^"']+)\1/gi)].map((match) => match[2]),
    ...[...markup.matchAll(/\bid\s*=\s*(["'])shopify-block-([^"']+)\1/gi)].map((match) => match[2]),
  ]);
}

function responsiveLayoutRules(markup) {
  const openings = markup.match(/<[a-z][^>]*\bdata-matbox-responsive-width=["'](?:fluid|constrained)["'][^>]*>/gi) || [];
  return openings.map((opening) => {
    const value = (name) => opening.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1];
    return {
      mode: value('data-matbox-responsive-width'),
      capturedWidth: Number(value('data-matbox-captured-width')),
      capturedParentWidth: Number(value('data-matbox-captured-parent-width')),
      widthRatio: Number(value('data-matbox-width-ratio')),
    };
  }).filter((rule) => (
    (rule.mode === 'fluid' || rule.mode === 'constrained')
    && Number.isFinite(rule.capturedWidth)
    && Number.isFinite(rule.capturedParentWidth)
    && Number.isFinite(rule.widthRatio)
  ));
}

function openingAttribute(opening, name, fallback = '') {
  return opening.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? fallback;
}

function openingNumber(opening, name) {
  const value = Number(openingAttribute(opening, name));
  return Number.isFinite(value) ? value : 0;
}

function componentSourceGeometry(opening) {
  const visibilityEvidence = openingAttribute(opening, 'data-matbox-component-visible');
  const visible = visibilityEvidence === '' ? true : visibilityEvidence !== 'false';
  const geometry = {
    x: openingNumber(opening, 'data-matbox-component-x'),
    y: openingNumber(opening, 'data-matbox-component-y'),
    width: openingNumber(opening, 'data-matbox-component-width'),
    height: openingNumber(opening, 'data-matbox-component-height'),
    parentWidth: openingNumber(opening, 'data-matbox-component-parent-width'),
    parentHeight: openingNumber(opening, 'data-matbox-component-parent-height'),
    display: openingAttribute(opening, 'data-matbox-component-display'),
    flexDirection: openingAttribute(opening, 'data-matbox-component-flex-direction', 'row'),
    gridTemplateColumns: openingAttribute(opening, 'data-matbox-component-grid-columns', 'none'),
    gap: openingAttribute(opening, 'data-matbox-component-gap', 'normal'),
    justifyContent: openingAttribute(opening, 'data-matbox-component-justify-content', 'normal'),
    alignItems: openingAttribute(opening, 'data-matbox-component-align-items', 'normal'),
    viewport: openingAttribute(opening, 'data-matbox-component-viewport'),
    viewportWidth: openingNumber(opening, 'data-matbox-component-viewport-width'),
    viewportHeight: openingNumber(opening, 'data-matbox-component-viewport-height'),
    visible,
  };
  const measuredVisible = visible && geometry.width > 0 && geometry.height > 0;
  const measuredHidden = !visible && visibilityEvidence === 'false';
  return geometry.viewport && (measuredVisible || measuredHidden) ? geometry : null;
}

export function extractPageComponents(html, route = '/', { includeEditableInstances = true } = {}) {
  const source = String(html || '');
  const openings = sectionOpenings(source);
  const components = openings.map((entry, index) => {
    const end = elementEndIndex(source, entry) ?? openings[index + 1]?.index ?? source.length;
    const markup = source.slice(entry.index, end);
    const type = sourceType(entry.sourceSectionId);
    const signature = structuralSignature(markup, type);
    const sourceBlockIds = blockIds(markup);
    const sourceGeometry = componentSourceGeometry(entry.opening);
    const matboxComponentId = `matbox.section.${type}.v1.${hash(signature)}`;
    const editable = convertMarkupToEditableSection({
      sectionId: entry.sourceSectionId,
      sectionType: type,
      markup,
    });
    const editableFields = includeEditableInstances ? {
      settings: editable.instance.settings,
      blocks: editable.instance.blocks,
      blockOrder: editable.instance.block_order,
      editableContract: {
        themeBlocks: editable.themeBlocks,
        renderedManifest: editable.renderedManifest,
      },
    } : {};
    return {
      schemaVersion: 1,
      sourceSectionId: entry.sourceSectionId,
      sourceSectionType: type,
      sourceBlockIds,
      sourceFingerprint: hash(markup.replace(entry.sourceSectionId, '{section-id}'), 24),
      structuralFingerprint: hash(signature, 24),
      matboxComponentId,
      matboxInstanceId: `matbox.instance.${hash(`${route}\n${entry.sourceSectionId}`, 16)}`,
      variantId: `variant.${hash(markup, 12)}`,
      sourceGeometry,
      sourceMarkup: markup,
      schema: { status: 'candidate', ...editable.sectionSchema },
      ...editableFields,
      contract: {
        props: [],
        slots: sourceBlockIds.map((id) => ({ sourceBlockId: id })),
        tokens: [],
        assets: unique([...markup.replace(/<!--[\s\S]*?-->/g, '').matchAll(/(?:^|\s)(?:src|poster)\s*=\s*(["'])([^"']+)\1/gi)].map((match) => match[2])),
        responsiveRules: unique([...markup.matchAll(/\b(?:data-[\w-]*(?:mobile|desktop|columns|slides)[\w-]*)\s*=\s*(["'])([^"']*)\1/gi)].map((match) => `${match[0]}`)),
        responsiveLayout: responsiveLayoutRules(markup),
        interactionStates: unique([...markup.matchAll(/\b(?:aria-expanded|aria-selected|aria-hidden|open|hidden)\b/gi)].map((match) => match[0].toLowerCase())).sort(),
        localeKeys: unique([...markup.matchAll(/\bdata-(?:i18n|translation-key)\s*=\s*(["'])([^"']+)\1/gi)].map((match) => match[2])),
      },
    };
  });
  return {
    route,
    components,
    composition: {
      schemaVersion: 1,
      route,
      prefix: openings.length > 0 ? source.slice(0, openings[0].index) : source,
      suffixes: components.map((component, index) => {
        const componentEnd = elementEndIndex(source, openings[index]) ?? openings[index + 1]?.index ?? source.length;
        const nextStart = openings[index + 1]?.index ?? source.length;
        return source.slice(componentEnd, nextStart);
      }),
      instances: components.map((component, order) => ({
        order,
        sourceSectionId: component.sourceSectionId,
        matboxComponentId: component.matboxComponentId,
        matboxInstanceId: component.matboxInstanceId,
        variantId: component.variantId,
        sourceGeometry: component.sourceGeometry,
      })),
    },
    coverage: openings.length === 0 ? 1 : components.length / openings.length,
  };
}

export function buildImportFoundationRecords(pages, options = {}) {
  return buildSharedImportFoundationRecords(pages, options, extractPageComponents);
}

export function createImportFoundationAccumulator(options = {}) {
  return createSharedImportFoundationAccumulator(options, extractPageComponents);
}

export function buildComponentRegistry(pages, options = {}) {
  const assetBundle = externalizePageAssetBundle(pages);
  const normalizedPages = assetBundle.pages.map(({ route, html }) => ({ route, html }));
  const extractedPages = normalizedPages.map(({ route, html }) => extractPageComponents(html, route, { includeEditableInstances: false }));
  if (options.requireGeometryEvidence === true) {
    const missing = extractedPages.flatMap((page) => page.components
      .filter((component) => !component.sourceGeometry)
      .map((component) => `${page.route}:${component.sourceSectionId}`));
    if (missing.length > 0) {
      throw new Error(`COMPONENT_GEOMETRY_EVIDENCE_FAILED ${missing.slice(0, 20).join(', ')}`);
    }
  }
  const byId = new Map();
  const collisions = [];
  for (const page of extractedPages) {
    for (const component of page.components) {
      const existing = byId.get(component.matboxComponentId);
      const sourceMapping = {
        route: page.route,
        sourceSectionId: component.sourceSectionId,
        sourceBlockIds: component.sourceBlockIds,
        sourceFingerprint: component.sourceFingerprint,
        matboxInstanceId: component.matboxInstanceId,
        variantId: component.variantId,
        sourceGeometry: component.sourceGeometry,
      };
      if (!existing) {
        byId.set(component.matboxComponentId, {
          ...component,
          sourceMappings: [sourceMapping],
          variants: [{ variantId: component.variantId, sourceFingerprint: component.sourceFingerprint, markup: component.sourceMarkup }],
        });
        continue;
      }
      if (existing.structuralFingerprint !== component.structuralFingerprint) {
        collisions.push({ matboxComponentId: component.matboxComponentId, existing: existing.structuralFingerprint, incoming: component.structuralFingerprint });
        continue;
      }
      existing.sourceMappings.push(sourceMapping);
      if (!existing.variants.some((variant) => variant.variantId === component.variantId)) {
        existing.variants.push({ variantId: component.variantId, sourceFingerprint: component.sourceFingerprint, markup: component.sourceMarkup });
      }
    }
  }
  const components = [...byId.values()].sort((a, b) => a.matboxComponentId.localeCompare(b.matboxComponentId));
  const responsiveComponents = components.filter((component) => component.contract.responsiveLayout.length > 0);
  const responsiveLayoutRules = responsiveComponents.flatMap((component) => component.contract.responsiveLayout);
  const sourceSectionCount = extractedPages.reduce((sum, page) => sum + page.components.length, 0);
  const mappedSectionCount = extractedPages.reduce((sum, page) => sum + page.composition.instances.length, 0);
  const unmappedSectionCount = Math.max(0, sourceSectionCount - mappedSectionCount);
  const registry = { schemaVersion: 1, components };
  const compositions = extractedPages.map((page) => page.composition);
  const reassemblyFailures = normalizedPages.flatMap((page) => {
    const composition = compositions.find((item) => item.route === page.route);
    const actual = reassemblePage(composition, registry);
    return actual === page.html ? [] : [{ route: page.route, expectedLength: page.html.length, actualLength: actual.length }];
  });
  return {
    registry,
    compositions,
    assets: assetBundle.assets,
    report: {
      routeCount: extractedPages.length,
      sourceSectionCount,
      mappedSectionCount,
      unmappedSectionCount,
      componentCount: components.length,
      responsiveComponentCount: responsiveComponents.length,
      fluidLayoutRuleCount: responsiveLayoutRules.filter((rule) => rule.mode === 'fluid').length,
      constrainedLayoutRuleCount: responsiveLayoutRules.filter((rule) => rule.mode === 'constrained').length,
      componentInstanceCount: mappedSectionCount,
      reusedInstanceCount: Math.max(0, mappedSectionCount - components.length),
      componentIdCollisionCount: collisions.length,
      collisions,
      reassemblyFailureCount: reassemblyFailures.length,
      reassemblyFailures,
      assetCount: assetBundle.assets.length,
      assetBytes: assetBundle.assets.reduce((sum, asset) => sum + asset.byteLength, 0),
      coverage: sourceSectionCount === 0 ? 1 : mappedSectionCount / sourceSectionCount,
    },
  };
}

export function createComponentRegistryAccumulator(options = {}) {
  const componentsById = new Map();
  const compositions = [];
  const assetsByHref = new Map();
  const collisions = [];
  const reassemblyFailures = [];
  let routeCount = 0;
  let sourceSectionCount = 0;
  let mappedSectionCount = 0;

  return {
    addPages(pages) {
      if (!Array.isArray(pages) || pages.length === 0) return;
      const artifact = buildComponentRegistry(pages, options);
      routeCount += artifact.report.routeCount;
      sourceSectionCount += artifact.report.sourceSectionCount;
      mappedSectionCount += artifact.report.mappedSectionCount;
      collisions.push(...artifact.report.collisions);
      reassemblyFailures.push(...artifact.report.reassemblyFailures);
      compositions.push(...artifact.compositions);
      for (const asset of artifact.assets) {
        if (!assetsByHref.has(asset.href)) assetsByHref.set(asset.href, asset);
      }
      for (const incoming of artifact.registry.components) {
        const existing = componentsById.get(incoming.matboxComponentId);
        if (!existing) {
          componentsById.set(incoming.matboxComponentId, incoming);
          continue;
        }
        if (existing.structuralFingerprint !== incoming.structuralFingerprint) {
          collisions.push({
            matboxComponentId: incoming.matboxComponentId,
            existing: existing.structuralFingerprint,
            incoming: incoming.structuralFingerprint,
          });
          continue;
        }
        existing.sourceMappings.push(...incoming.sourceMappings);
        for (const variant of incoming.variants) {
          if (!existing.variants.some((candidate) => candidate.variantId === variant.variantId)) {
            existing.variants.push(variant);
          }
        }
      }
    },
    finish() {
      const components = [...componentsById.values()].sort((left, right) => (
        left.matboxComponentId.localeCompare(right.matboxComponentId)
      ));
      const responsiveComponents = components.filter((component) => component.contract.responsiveLayout.length > 0);
      const responsiveLayoutRules = responsiveComponents.flatMap((component) => component.contract.responsiveLayout);
      const assets = [...assetsByHref.values()].sort((left, right) => left.href.localeCompare(right.href));
      const unmappedSectionCount = Math.max(0, sourceSectionCount - mappedSectionCount);
      return {
        registry: { schemaVersion: 1, components },
        compositions,
        assets,
        report: {
          routeCount,
          sourceSectionCount,
          mappedSectionCount,
          unmappedSectionCount,
          componentCount: components.length,
          responsiveComponentCount: responsiveComponents.length,
          fluidLayoutRuleCount: responsiveLayoutRules.filter((rule) => rule.mode === 'fluid').length,
          constrainedLayoutRuleCount: responsiveLayoutRules.filter((rule) => rule.mode === 'constrained').length,
          componentInstanceCount: mappedSectionCount,
          reusedInstanceCount: Math.max(0, mappedSectionCount - components.length),
          componentIdCollisionCount: collisions.length,
          collisions,
          reassemblyFailureCount: reassemblyFailures.length,
          reassemblyFailures,
          assetCount: assets.length,
          assetBytes: assets.reduce((sum, asset) => sum + asset.byteLength, 0),
          coverage: sourceSectionCount === 0 ? 1 : mappedSectionCount / sourceSectionCount,
        },
      };
    },
  };
}

export function externalizeComponentVariantMarkup(registry) {
  const variantsByHref = new Map();
  const components = (registry?.components || []).map((component) => {
    // Instance values are published through page/import-foundation records.
    // A component type registry must not embed the first page's content.
    const {
      sourceMarkup: _sourceMarkup,
      settings: _settings,
      blocks: _blocks,
      blockOrder: _blockOrder,
      variants = [],
      ...metadata
    } = component;
    return {
      ...metadata,
      variants: variants.map((variant) => {
        const { markup = '', ...variantMetadata } = variant;
        const editableMarkup = convertMarkupToEditableSection({
          sectionId: component.sourceSectionId,
          sectionType: component.sourceSectionType,
          markup,
        }).annotatedMarkup;
        const variantMarkupId = hash(`text/html\n${editableMarkup}`, 24);
        const href = `/component-library/variants/${variantMarkupId}.html`;
        if (!variantsByHref.has(href)) {
          variantsByHref.set(href, {
            variantMarkupId,
            href,
            filename: `${variantMarkupId}.html`,
            mimeType: 'text/html',
            byteLength: Buffer.byteLength(editableMarkup, 'utf8'),
            content: editableMarkup,
          });
        }
        return {
          ...variantMetadata,
          variantMarkupId,
          markupHref: href,
          byteLength: Buffer.byteLength(editableMarkup, 'utf8'),
        };
      }),
    };
  });
  return {
    registry: { ...registry, components },
    variants: [...variantsByHref.values()].sort((left, right) => left.href.localeCompare(right.href)),
  };
}

export async function publishComponentVariantMarkup(registry, outputDir) {
  if (!outputDir) throw new TypeError('outputDir is required');
  await fs.mkdir(outputDir, { recursive: true });
  const variantsByHref = new Map();
  const components = [];

  for (const component of registry?.components || []) {
    const {
      sourceMarkup: _sourceMarkup,
      settings: _settings,
      blocks: _blocks,
      blockOrder: _blockOrder,
      variants = [],
      ...metadata
    } = component;
    const publishedVariants = [];
    for (const variant of variants) {
      const { markup = '', ...variantMetadata } = variant;
      const editableMarkup = convertMarkupToEditableSection({
        sectionId: component.sourceSectionId,
        sectionType: component.sourceSectionType,
        markup,
      }).annotatedMarkup;
      const variantMarkupId = hash(`text/html\n${editableMarkup}`, 24);
      const filename = `${variantMarkupId}.html`;
      const href = `/component-library/variants/${filename}`;
      const byteLength = Buffer.byteLength(editableMarkup, 'utf8');
      if (!variantsByHref.has(href)) {
        await fs.writeFile(path.join(outputDir, filename), editableMarkup, 'utf8');
        variantsByHref.set(href, { variantMarkupId, href, filename, mimeType: 'text/html', byteLength });
      }
      publishedVariants.push({ ...variantMetadata, variantMarkupId, markupHref: href, byteLength });
    }
    components.push({ ...metadata, variants: publishedVariants });
  }

  return {
    registry: { ...registry, components },
    variants: [...variantsByHref.values()].sort((left, right) => left.href.localeCompare(right.href)),
  };
}

export function externalizePageCompositionMarkup(compositions) {
  const fragmentsByHref = new Map();
  const publishedCompositions = (compositions || []).map((composition) => {
    const { composition: published, fragments } = externalizePageComposition(composition);
    for (const fragment of fragments) {
      if (!fragmentsByHref.has(fragment.href)) fragmentsByHref.set(fragment.href, fragment);
    }
    return published;
  });
  return {
    compositions: publishedCompositions,
    fragments: [...fragmentsByHref.values()].sort((left, right) => left.href.localeCompare(right.href)),
  };
}

function externalizePageComposition(composition) {
  const { prefix = '', suffixes = [], ...metadata } = composition || {};
  const externalize = (content) => {
    const markupId = hash(`text/html\n${content}`, 24);
    const href = `/component-library/compositions/${markupId}.html`;
    return {
      markupId,
      href,
      filename: `${markupId}.html`,
      mimeType: 'text/html',
      byteLength: Buffer.byteLength(content, 'utf8'),
      content,
    };
  };
  const prefixFragment = externalize(prefix);
  const suffixFragments = suffixes.map(externalize);
  return {
    composition: {
      ...metadata,
      prefixMarkupId: prefixFragment.markupId,
      prefixHref: prefixFragment.href,
      prefixByteLength: prefixFragment.byteLength,
      suffixMarkupIds: suffixFragments.map((fragment) => fragment.markupId),
      suffixHrefs: suffixFragments.map((fragment) => fragment.href),
      suffixByteLengths: suffixFragments.map((fragment) => fragment.byteLength),
    },
    fragments: [prefixFragment, ...suffixFragments].map(({ markupId, ...fragment }) => ({
      ...fragment,
      compositionMarkupId: markupId,
    })),
  };
}

export function compactImportFoundationRecords(importFoundation, publishedCompositions) {
  const compositionByRoute = new Map((publishedCompositions || []).map((composition) => [composition.route, composition]));
  return {
    ...importFoundation,
    pages: (importFoundation?.pages || []).map((page) => {
      const composition = compositionByRoute.get(page.route)
        ?? externalizePageComposition(page.composition).composition;
      if (!composition) throw new Error(`Published composition missing for import foundation route ${page.route}`);
      const { components = [], ...pageMetadata } = page;
      return {
        ...pageMetadata,
        composition,
        componentInstanceIds: components.map((component) => component.componentInstanceId),
      };
    }),
  };
}

export function reassemblePage(composition, registry) {
  const byId = new Map((registry?.components || []).map((component) => [component.matboxComponentId, component]));
  let html = composition?.prefix || '';
  for (const [index, instance] of (composition?.instances || []).entries()) {
    const component = byId.get(instance.matboxComponentId);
    const variant = component?.variants?.find((item) => item.variantId === instance.variantId);
    if (!component || !variant) {
      throw new Error(`Missing component variant for ${instance.matboxComponentId} ${instance.variantId}`);
    }
    html += variant.markup;
    html += composition?.suffixes?.[index] || '';
  }
  return html;
}
