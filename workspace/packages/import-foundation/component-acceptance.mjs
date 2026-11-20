export const DEFAULT_ACCEPTANCE_TOLERANCES = Object.freeze({
  dimensionPx: 1,
  positionPx: 1,
  aspectRatio: 0.01,
});

function appendGeometryFailures(failures, viewport, measurement, tolerances) {
  const target = measurement?.target ?? null;
  for (const property of ['x', 'y', 'width', 'height', 'aspectRatio']) {
    const source = Number(measurement?.source?.[property]);
    const rendered = Number(measurement?.rendered?.[property]);
    if (!Number.isFinite(source) || !Number.isFinite(rendered)) {
      failures.push({ type: 'missing-geometry', viewport, target, property });
      continue;
    }
    const tolerance = property === 'aspectRatio'
      ? tolerances.aspectRatio
      : ['x', 'y'].includes(property) ? tolerances.positionPx : tolerances.dimensionPx;
    const difference = Math.abs(source - rendered);
    if (difference > tolerance) {
      failures.push({ type: 'geometry-mismatch', viewport, target, property, source, rendered, difference, tolerance });
    }
  }
}

function appendImageFailures(failures, viewport, images) {
  const expected = Number(images?.expected);
  const results = Array.isArray(images?.results) ? images.results : [];
  if (!Number.isInteger(expected) || expected < 0 || results.length !== expected) {
    failures.push({ type: 'image-coverage-mismatch', viewport, expected: Number.isFinite(expected) ? expected : null, actual: results.length });
  }
  for (const image of results) {
    if (image.loaded !== true) failures.push({ type: 'image-not-loaded', viewport, target: image.target ?? null });
    if (image.croppingMatch !== true) failures.push({ type: 'image-crop-mismatch', viewport, target: image.target ?? null });
  }
}

export function evaluateComponentAcceptance(evidence = {}, options = {}) {
  const tolerances = Object.hasOwn(options, 'dimensionPx')
    ? { ...DEFAULT_ACCEPTANCE_TOLERANCES, ...options }
    : { ...DEFAULT_ACCEPTANCE_TOLERANCES, ...(options.tolerances || {}) };
  const expectedTargets = Array.isArray(options.expectedTargets) ? options.expectedTargets : [];
  const expectedImageCount = Number.isInteger(options.expectedImageCount) ? options.expectedImageCount : null;
  const failures = [];
  if (evidence.editorFieldsComplete !== true) failures.push({ type: 'editor-fields-incomplete' });

  for (const viewport of ['desktop', 'mobile']) {
    const result = evidence.viewports?.[viewport];
    if (!result) {
      failures.push({ type: 'missing-viewport', viewport });
      continue;
    }
    const measurements = Array.isArray(result.measurements) ? result.measurements : [];
    if (measurements.length === 0) failures.push({ type: 'missing-measurements', viewport });
    const measuredTargets = new Set(measurements.map((measurement) => measurement?.target).filter(Boolean));
    for (const target of expectedTargets) {
      if (!measuredTargets.has(target)) failures.push({ type: 'missing-measurement-target', viewport, target });
    }
    for (const measurement of measurements) appendGeometryFailures(failures, viewport, measurement, tolerances);
    appendImageFailures(failures, viewport, result.images);
    if (expectedImageCount !== null && result.images?.expected !== expectedImageCount) {
      failures.push({ type: 'captured-image-count-mismatch', viewport, expected: expectedImageCount, actual: result.images?.expected ?? null });
    }
    if (result.typographyMatch !== true) failures.push({ type: 'typography-mismatch', viewport });
    if (result.layoutMatch !== true) failures.push({ type: 'layout-mismatch', viewport });
    if (result.adaptive !== true) failures.push({ type: 'responsive-mismatch', viewport });
  }

  return {
    pass: failures.length === 0,
    status: failures.length === 0 ? 'passed' : 'failed',
    failures,
  };
}

