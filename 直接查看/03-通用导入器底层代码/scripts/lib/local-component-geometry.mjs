import { extractComponentOpeningRecords } from './component-registry.mjs';

export const COMPONENT_GEOMETRY_ATTRIBUTE_NAMES = Object.freeze([
  'data-matbox-component-x',
  'data-matbox-component-y',
  'data-matbox-component-width',
  'data-matbox-component-height',
  'data-matbox-component-parent-width',
  'data-matbox-component-parent-height',
  'data-matbox-component-display',
  'data-matbox-component-flex-direction',
  'data-matbox-component-grid-columns',
  'data-matbox-component-gap',
  'data-matbox-component-justify-content',
  'data-matbox-component-align-items',
  'data-matbox-component-viewport',
  'data-matbox-component-viewport-width',
  'data-matbox-component-viewport-height',
  'data-matbox-component-visible',
]);

export const IMAGE_GEOMETRY_ATTRIBUTE_NAMES = Object.freeze([
  'data-matbox-image-intrinsic-width',
  'data-matbox-image-intrinsic-height',
  'data-matbox-image-rendered-width',
  'data-matbox-image-rendered-height',
  'data-matbox-image-container-width',
  'data-matbox-image-container-height',
  'data-matbox-image-visible',
  'data-matbox-image-object-fit',
  'data-matbox-image-object-position',
  'data-matbox-image-viewport',
  'data-matbox-image-viewport-width',
  'data-matbox-image-viewport-height',
  'data-matbox-image-overflow-px',
  'data-matbox-image-overflow-x-px',
  'data-matbox-image-overflow-y-px',
  'data-matbox-image-container-overflow-x',
  'data-matbox-image-container-overflow-y',
  'data-matbox-image-container-ancestor-depth',
  'data-matbox-image-clipped-x',
  'data-matbox-image-clipped-y',
  'data-matbox-image-clip-ancestor-depth-x',
  'data-matbox-image-clip-ancestor-depth-y',
]);

export const markedComponentGeometryMeasurementExpression = `(() => {
  const precision = (value) => String(Number(Number(value || 0).toFixed(3)));
  const clipsAxis = (value) => ['hidden', 'clip', 'auto', 'scroll'].includes(String(value || '').trim().toLowerCase());
  const elementHasVisiblePaint = (element, rect) => {
    if (!element || rect.width <= 0 || rect.height <= 0) return false;
    let visibleLeft = rect.left;
    let visibleRight = rect.right;
    let visibleTop = rect.top;
    let visibleBottom = rect.bottom;
    let current = element;
    while (current && current !== document.documentElement) {
      const currentStyle = getComputedStyle(current);
      if (current.hidden
        || current.hasAttribute('inert')
        || String(current.getAttribute('aria-hidden') || '').toLowerCase() === 'true'
        || currentStyle.display === 'none'
        || currentStyle.visibility === 'hidden'
        || currentStyle.visibility === 'collapse'
        || Number(currentStyle.opacity || 1) <= 0) return false;
      if (current !== element) {
        const currentRect = current.getBoundingClientRect();
        if (clipsAxis(currentStyle.overflowX)) {
          visibleLeft = Math.max(visibleLeft, currentRect.left);
          visibleRight = Math.min(visibleRight, currentRect.right);
        }
        if (clipsAxis(currentStyle.overflowY)) {
          visibleTop = Math.max(visibleTop, currentRect.top);
          visibleBottom = Math.min(visibleBottom, currentRect.bottom);
        }
        const visibleWidth = visibleRight - visibleLeft;
        const visibleHeight = visibleBottom - visibleTop;
        if (visibleWidth <= 0 || visibleHeight <= 0) return false;
      }
      current = current.parentElement;
    }
    return true;
  };
  for (const image of Array.from(document.images)) {
    const rect = image.getBoundingClientRect();
    let container = image.parentElement;
    let containerAncestorDepth = 1;
    let fallbackContainer = null;
    let fallbackContainerAncestorDepth = 0;
    while (container && container !== document.documentElement) {
      const candidateRect = container.getBoundingClientRect();
      const candidateStyle = getComputedStyle(container);
      const candidateDisplay = candidateStyle.display;
      const inlineOnly = candidateDisplay === 'inline' || candidateDisplay === 'contents';
      const hasUsableBox = candidateRect.width > 0 && candidateRect.height > 0;
      if (!inlineOnly && hasUsableBox) {
        if (!fallbackContainer) {
          fallbackContainer = container;
          fallbackContainerAncestorDepth = containerAncestorDepth;
        }
        const overflowsX = rect.left < candidateRect.left - 0.5 || rect.right > candidateRect.right + 0.5;
        const overflowsY = rect.top < candidateRect.top - 0.5 || rect.bottom > candidateRect.bottom + 0.5;
        const resolvesX = !overflowsX || clipsAxis(candidateStyle.overflowX);
        const resolvesY = !overflowsY || clipsAxis(candidateStyle.overflowY);
        if (resolvesX && resolvesY) break;
      }
      container = container.parentElement;
      containerAncestorDepth += 1;
    }
    if (!container || container === document.documentElement) {
      container = fallbackContainer;
      containerAncestorDepth = fallbackContainerAncestorDepth;
    }
    const containerRect = container?.getBoundingClientRect();
    const style = getComputedStyle(image);
    const containerStyle = container ? getComputedStyle(container) : null;
    const visible = elementHasVisiblePaint(image, rect);
    const intrinsicWidth = Number(image.getAttribute('data-matbox-original-natural-width')) || image.naturalWidth || Number(image.getAttribute('width')) || 0;
    const intrinsicHeight = Number(image.getAttribute('data-matbox-original-natural-height')) || image.naturalHeight || Number(image.getAttribute('height')) || 0;
    const overflowXPx = containerRect
      ? Math.max(0, containerRect.left - rect.left, rect.right - containerRect.right)
      : 0;
    const overflowYPx = containerRect
      ? Math.max(0, containerRect.top - rect.top, rect.bottom - containerRect.bottom)
      : 0;
    let clippedX = false;
    let clippedY = false;
    let clipAncestorDepthX = 0;
    let clipAncestorDepthY = 0;
    let ancestor = image.parentElement;
    let ancestorDepth = 0;
    while (ancestor && ancestor !== document.documentElement) {
      ancestorDepth += 1;
      const ancestorRect = ancestor.getBoundingClientRect();
      const ancestorStyle = getComputedStyle(ancestor);
      if (!clippedX && clipsAxis(ancestorStyle.overflowX)
        && (rect.left < ancestorRect.left || rect.right > ancestorRect.right)) {
        clippedX = true;
        clipAncestorDepthX = ancestorDepth;
      }
      if (!clippedY && clipsAxis(ancestorStyle.overflowY)
        && (rect.top < ancestorRect.top || rect.bottom > ancestorRect.bottom)) {
        clippedY = true;
        clipAncestorDepthY = ancestorDepth;
      }
      ancestor = ancestor.parentElement;
    }
    image.setAttribute('data-matbox-image-intrinsic-width', precision(intrinsicWidth));
    image.setAttribute('data-matbox-image-intrinsic-height', precision(intrinsicHeight));
    image.setAttribute('data-matbox-image-rendered-width', precision(rect.width));
    image.setAttribute('data-matbox-image-rendered-height', precision(rect.height));
    image.setAttribute('data-matbox-image-container-width', precision(containerRect?.width || 0));
    image.setAttribute('data-matbox-image-container-height', precision(containerRect?.height || 0));
    image.setAttribute('data-matbox-image-visible', visible ? 'true' : 'false');
    image.setAttribute('data-matbox-image-object-fit', style.objectFit || 'fill');
    image.setAttribute('data-matbox-image-object-position', style.objectPosition || '50% 50%');
    image.setAttribute('data-matbox-image-viewport', innerWidth <= 767 ? 'mobile' : 'desktop');
    image.setAttribute('data-matbox-image-viewport-width', precision(innerWidth));
    image.setAttribute('data-matbox-image-viewport-height', precision(innerHeight));
    image.setAttribute('data-matbox-image-overflow-px', precision(Math.max(overflowXPx, overflowYPx)));
    image.setAttribute('data-matbox-image-overflow-x-px', precision(overflowXPx));
    image.setAttribute('data-matbox-image-overflow-y-px', precision(overflowYPx));
    image.setAttribute('data-matbox-image-container-overflow-x', containerStyle?.overflowX || 'visible');
    image.setAttribute('data-matbox-image-container-overflow-y', containerStyle?.overflowY || 'visible');
    image.setAttribute('data-matbox-image-container-ancestor-depth', precision(containerAncestorDepth));
    image.setAttribute('data-matbox-image-clipped-x', clippedX ? 'true' : 'false');
    image.setAttribute('data-matbox-image-clipped-y', clippedY ? 'true' : 'false');
    image.setAttribute('data-matbox-image-clip-ancestor-depth-x', precision(clipAncestorDepthX));
    image.setAttribute('data-matbox-image-clip-ancestor-depth-y', precision(clipAncestorDepthY));
  }
  const nodes = Array.from(document.querySelectorAll('[data-matbox-geometry-key]'));
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const parentRect = node.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(node);
    const visible = elementHasVisiblePaint(node, rect);
    node.setAttribute('data-matbox-component-x', precision(rect.left + scrollX));
    node.setAttribute('data-matbox-component-y', precision(rect.top + scrollY));
    node.setAttribute('data-matbox-component-width', precision(rect.width));
    node.setAttribute('data-matbox-component-height', precision(rect.height));
    node.setAttribute('data-matbox-component-parent-width', precision(parentRect?.width || 0));
    node.setAttribute('data-matbox-component-parent-height', precision(parentRect?.height || 0));
    node.setAttribute('data-matbox-component-display', style.display || 'block');
    node.setAttribute('data-matbox-component-flex-direction', style.flexDirection || 'row');
    node.setAttribute('data-matbox-component-grid-columns', style.gridTemplateColumns || 'none');
    node.setAttribute('data-matbox-component-gap', style.gap || 'normal');
    node.setAttribute('data-matbox-component-justify-content', style.justifyContent || 'normal');
    node.setAttribute('data-matbox-component-align-items', style.alignItems || 'normal');
    node.setAttribute('data-matbox-component-viewport', innerWidth <= 767 ? 'mobile' : 'desktop');
    node.setAttribute('data-matbox-component-viewport-width', precision(innerWidth));
    node.setAttribute('data-matbox-component-viewport-height', precision(innerHeight));
    node.setAttribute('data-matbox-component-visible', visible ? 'true' : 'false');
  }
  return { measured: nodes.length };
})()`;

export const compactComponentGeometryMeasurementExpression = `(() => {
  ${markedComponentGeometryMeasurementExpression};
  const components = Array.from(document.querySelectorAll('[data-matbox-geometry-key]'), (node) => {
    const measured = document.createElement('div');
    measured.setAttribute('data-matbox-geometry-key', node.getAttribute('data-matbox-geometry-key'));
    for (const name of ${JSON.stringify(COMPONENT_GEOMETRY_ATTRIBUTE_NAMES)}) {
      if (node.hasAttribute(name)) measured.setAttribute(name, node.getAttribute(name));
    }
    return measured.outerHTML;
  });
  const images = Array.from(document.querySelectorAll('[data-matbox-image-geometry-key]'), (node) => {
    const measured = document.createElement('img');
    measured.setAttribute('data-matbox-image-geometry-key', node.getAttribute('data-matbox-image-geometry-key'));
    for (const name of ${JSON.stringify(IMAGE_GEOMETRY_ATTRIBUTE_NAMES)}) {
      if (node.hasAttribute(name)) measured.setAttribute(name, node.getAttribute(name));
    }
    return measured.outerHTML;
  });
  return [...components, ...images].join('');
})()`;

const ATTRIBUTE_NAME_PATTERN = COMPONENT_GEOMETRY_ATTRIBUTE_NAMES
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const GEOMETRY_ATTRIBUTE_PATTERN = new RegExp(`\\s+(?:${ATTRIBUTE_NAME_PATTERN})\\s*=\\s*(["'])[^"']*\\1`, 'gi');
const TEMPORARY_KEY_PATTERN = /\s+data-matbox-geometry-key\s*=\s*(["'])[^"']*\1/gi;
const IMAGE_ATTRIBUTE_NAME_PATTERN = IMAGE_GEOMETRY_ATTRIBUTE_NAMES
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const IMAGE_GEOMETRY_ATTRIBUTE_PATTERN = new RegExp(`\\s+(?:${IMAGE_ATTRIBUTE_NAME_PATTERN})\\s*=\\s*(["'])[^"']*\\1`, 'gi');
const TEMPORARY_IMAGE_KEY_PATTERN = /\s+data-matbox-image-geometry-key\s*=\s*(["'])[^"']*\1/gi;

function injectAttributes(opening, attributes) {
  const selfClosing = /\/\s*>$/.test(opening);
  const terminatorLength = selfClosing ? opening.match(/\/\s*>$/)[0].length : 1;
  const body = opening.slice(0, -terminatorLength)
    .replace(GEOMETRY_ATTRIBUTE_PATTERN, '')
    .replace(TEMPORARY_KEY_PATTERN, '')
    .trimEnd();
  return `${body}${attributes ? ` ${attributes}` : ''}${selfClosing ? '/>' : '>'}`;
}

function applyOpeningReplacements(source, replacements) {
  let output = source;
  for (const replacement of [...replacements].sort((left, right) => right.index - left.index)) {
    const current = output.slice(replacement.index, replacement.index + replacement.opening.length);
    if (current !== replacement.opening) {
      throw new Error(`Component opening changed before geometry patch at byte ${replacement.index}`);
    }
    output = `${output.slice(0, replacement.index)}${replacement.value}${output.slice(replacement.index + replacement.opening.length)}`;
  }
  return output;
}

export function markComponentGeometryTargets(html) {
  const source = String(html || '');
  const targets = extractComponentOpeningRecords(source).map((entry, index) => ({
    ...entry,
    key: `geometry-${index + 1}`,
  }));
  const marked = applyOpeningReplacements(source, targets.map((target) => ({
    ...target,
    value: injectAttributes(target.opening, `data-matbox-geometry-key="${target.key}"`),
  })));
  return { html: marked, targets };
}

function imageOpeningRecords(html) {
  const source = String(html || '');
  const inertRanges = [
    ...source.matchAll(/<!--[\s\S]*?-->/g),
    ...source.matchAll(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi),
  ].map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const inertAt = (index) => inertRanges.some((range) => index >= range.start && index < range.end);
  return [...source.matchAll(/<img\b[^>]*>/gi)]
    .filter((match) => !inertAt(match.index))
    .map((match) => ({
      index: match.index,
      opening: match[0],
    }));
}

export function hasCompleteImageGeometryEvidence(html) {
  return imageOpeningRecords(html).every(({ opening }) => IMAGE_GEOMETRY_ATTRIBUTE_NAMES.every((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\s*=\\s*(["'])[^"']*\\1`, 'i').test(opening);
  }));
}

export function shouldSkipGeometryEnrichment(html, { force = false } = {}) {
  if (force) return false;
  const source = String(html || '');
  return source.includes('data-matbox-component-width=') && hasCompleteImageGeometryEvidence(source);
}

function injectImageAttributes(opening, attributes) {
  const selfClosing = /\/\s*>$/.test(opening);
  const terminatorLength = selfClosing ? opening.match(/\/\s*>$/)[0].length : 1;
  const body = opening.slice(0, -terminatorLength)
    .replace(IMAGE_GEOMETRY_ATTRIBUTE_PATTERN, '')
    .replace(TEMPORARY_IMAGE_KEY_PATTERN, '')
    .trimEnd();
  return `${body}${attributes ? ` ${attributes}` : ''}${selfClosing ? '/>' : '>'}`;
}

export function markImageGeometryTargets(html) {
  const source = String(html || '');
  const targets = imageOpeningRecords(source).map((entry, index) => ({
    ...entry,
    key: `image-geometry-${index + 1}`,
  }));
  const marked = applyOpeningReplacements(source, targets.map((target) => ({
    ...target,
    value: injectImageAttributes(target.opening, `data-matbox-image-geometry-key="${target.key}"`),
  })));
  return { html: marked, targets };
}

function measuredOpeningForKey(measuredHtml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<([a-zA-Z][\\w:-]*)\\b[^>]*\\bdata-matbox-geometry-key\\s*=\\s*(["'])${escaped}\\2[^>]*>`, 'i');
  return String(measuredHtml || '').match(pattern)?.[0] || null;
}

function measuredAttributes(opening, key) {
  if (!opening) throw new Error(`Missing measured geometry for ${key}`);
  const values = COMPONENT_GEOMETRY_ATTRIBUTE_NAMES.map((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const value = opening.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([^"']*)\\1`, 'i'))?.[2];
    if (value === undefined) throw new Error(`Missing measured geometry attribute ${name} for ${key}`);
    return `${name}="${value.replaceAll('"', '&quot;')}"`;
  });
  return values.join(' ');
}

function measuredImageOpeningForKey(measuredHtml, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<img\\b[^>]*\\bdata-matbox-image-geometry-key\\s*=\\s*(["'])${escaped}\\1[^>]*>`, 'i');
  return String(measuredHtml || '').match(pattern)?.[0] || null;
}

function measuredImageAttributes(opening, key) {
  if (!opening) throw new Error(`Missing measured image geometry for ${key}`);
  return IMAGE_GEOMETRY_ATTRIBUTE_NAMES.map((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const value = opening.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([^"']*)\\1`, 'i'))?.[2];
    if (value === undefined) throw new Error(`Missing measured image geometry attribute ${name} for ${key}`);
    return `${name}="${value.replaceAll('"', '&quot;')}"`;
  }).join(' ');
}

export function applyMeasuredComponentGeometry(sourceHtml, measuredHtml, targets = null) {
  const source = String(sourceHtml || '');
  const records = targets || markComponentGeometryTargets(source).targets;
  return applyOpeningReplacements(source, records.map((target) => ({
    ...target,
    value: injectAttributes(target.opening, measuredAttributes(measuredOpeningForKey(measuredHtml, target.key), target.key)),
  })));
}

export function applyMeasuredImageGeometry(sourceHtml, measuredHtml, targets = null) {
  const source = String(sourceHtml || '');
  const records = targets || markImageGeometryTargets(source).targets;
  return applyOpeningReplacements(source, records.map((target) => ({
    ...target,
    value: injectImageAttributes(
      target.opening,
      measuredImageAttributes(measuredImageOpeningForKey(measuredHtml, target.key), target.key),
    ),
  })));
}

export function stripComponentGeometryEvidence(html) {
  return String(html || '')
    .replace(GEOMETRY_ATTRIBUTE_PATTERN, '')
    .replace(TEMPORARY_KEY_PATTERN, '');
}

export function stripImageGeometryEvidence(html) {
  return String(html || '')
    .replace(IMAGE_GEOMETRY_ATTRIBUTE_PATTERN, '')
    .replace(TEMPORARY_IMAGE_KEY_PATTERN, '');
}
