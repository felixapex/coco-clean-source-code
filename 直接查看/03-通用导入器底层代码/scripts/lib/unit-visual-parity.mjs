function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function missingKeys(required = [], actual = []) {
  const available = new Set(actual);
  return required.filter((key) => !available.has(key));
}

function rectMatches(source = {}, local = {}, tolerance) {
  return ['x', 'y', 'width', 'height'].every((key) => (
    Math.abs(finite(source[key]) - finite(local[key])) <= tolerance
  ));
}

export function validateCriticalImageEvidence({ context = '', provenance = '', containsPageChrome = false } = {}) {
  const failures = [];
  if (context !== 'navigation') return { pass: true, failures };
  if (provenance === 'page-rectangle' || containsPageChrome) {
    failures.push({ type: 'page-screenshot-used-as-navigation-image' });
  } else if (!['direct-image-response', 'verified-restored-asset'].includes(provenance)) {
    failures.push({ type: 'unverified-critical-image-provenance' });
  }
  return { pass: failures.length === 0, failures };
}

export function evaluateUnitVisualParity({
  source = {},
  local = {},
  threshold = 0.95,
  geometryTolerance = 4,
} = {}) {
  const failures = [];
  const sourceBlank = Math.max(0, finite(source.viewportWidth) - finite(source.contentRight));
  const localBlank = Math.max(0, finite(local.viewportWidth) - finite(local.contentRight));
  if (Math.abs(sourceBlank - localBlank) > geometryTolerance) {
    failures.push({ type: 'right-blank-space-mismatch', sourceBlank, localBlank, tolerance: geometryTolerance });
  }

  const sourceOverlapCount = finite(source.overlapCount);
  const localOverlapCount = finite(local.overlapCount);
  if (localOverlapCount > sourceOverlapCount) {
    failures.push({ type: 'text-overlap-mismatch', sourceCount: sourceOverlapCount, localCount: localOverlapCount });
  }

  if (!rectMatches(source.rect, local.rect, geometryTolerance)) {
    failures.push({
      type: 'component-geometry-mismatch',
      source: source.rect,
      local: local.rect,
      tolerance: geometryTolerance,
    });
  }

  const missingText = missingKeys(source.textKeys, local.textKeys);
  if (missingText.length) failures.push({ type: 'missing-component-text', keys: missingText });
  const missingImages = missingKeys(source.imageKeys, local.imageKeys);
  if (missingImages.length) failures.push({ type: 'missing-component-images', keys: missingImages });

  const similarity = finite(local.similarity);
  if (similarity < threshold) {
    failures.push({ type: 'component-similarity-below-threshold', similarity, threshold });
  }

  return {
    pass: failures.length === 0,
    failures,
    evidence: {
      source: source.screenshot || '',
      local: local.screenshot || '',
      diff: local.diff || '',
    },
  };
}
