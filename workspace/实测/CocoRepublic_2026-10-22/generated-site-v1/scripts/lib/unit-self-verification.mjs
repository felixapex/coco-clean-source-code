function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function imageTags(markup = '') {
  return [...String(markup).matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? match[2] : null;
}

function hasImageGeometry(tag) {
  const intrinsicWidth = finite(attribute(tag, 'data-matbox-image-intrinsic-width'));
  const intrinsicHeight = finite(attribute(tag, 'data-matbox-image-intrinsic-height'));
  const renderedWidth = finite(attribute(tag, 'data-matbox-image-rendered-width'));
  const renderedHeight = finite(attribute(tag, 'data-matbox-image-rendered-height'));
  const containerWidth = finite(attribute(tag, 'data-matbox-image-container-width'));
  const containerHeight = finite(attribute(tag, 'data-matbox-image-container-height'));
  return intrinsicWidth > 0
    && intrinsicHeight > 0
    && renderedWidth !== null
    && renderedWidth >= 0
    && renderedHeight !== null
    && renderedHeight >= 0
    && containerWidth !== null
    && containerWidth >= 0
    && containerHeight !== null
    && containerHeight >= 0
    && Boolean(attribute(tag, 'data-matbox-image-object-fit'))
    && Boolean(attribute(tag, 'data-matbox-image-object-position'))
    && Boolean(attribute(tag, 'data-matbox-image-viewport'));
}

function validGeometry(geometry) {
  if (!geometry) return false;
  const visible = geometry.visible !== false;
  const measuredBox = visible
    ? finite(geometry.width) > 0 && finite(geometry.height) > 0
    : finite(geometry.width) !== null && finite(geometry.height) !== null;
  return measuredBox
    && finite(geometry.parentWidth) > 0
    && finite(geometry.viewportWidth) > 0
    && finite(geometry.viewportHeight) > 0
    && ['desktop', 'mobile'].includes(String(geometry.viewport || ''));
}

function componentAssetHrefs(markup = '') {
  return [...new Set(
    [...String(markup).matchAll(/\/component-library\/assets\/[^\s"'()<>]+/gi)]
      .map((match) => match[0]),
  )];
}

export function evaluateComponentCandidate(component = {}, { availableAssetHrefs = [] } = {}) {
  const failures = [];
  if (!component || typeof component !== 'object' || !component.matboxComponentId) {
    return { pass: false, failures: [{ gate: 'candidate', type: 'missing-component-candidate' }] };
  }
  if (!String(component.sourceMarkup || '').trim()) {
    failures.push({ gate: 'candidate', type: 'missing-component-markup' });
  }
  if (!validGeometry(component.sourceGeometry)) {
    failures.push({ gate: 'candidate', type: 'missing-component-geometry' });
  }
  if (!component.contract || typeof component.contract !== 'object') {
    failures.push({ gate: 'candidate', type: 'missing-component-contract' });
  }

  imageTags(component.sourceMarkup).forEach((tag, imageIndex) => {
    if (!hasImageGeometry(tag)) {
      failures.push({ gate: 'candidate', type: 'missing-candidate-image-geometry', imageIndex });
    }
  });

  const available = new Set(Array.isArray(availableAssetHrefs) ? availableAssetHrefs : []);
  for (const href of componentAssetHrefs(component.sourceMarkup)) {
    if (!available.has(href)) failures.push({ gate: 'candidate', type: 'unresolved-component-asset', href });
  }
  return { pass: failures.length === 0, failures };
}

