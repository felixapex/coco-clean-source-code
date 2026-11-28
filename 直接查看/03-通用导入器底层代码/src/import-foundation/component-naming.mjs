const GENERIC_NAME = /^(section|block|container|wrapper|module|component)(?:[-_].*)?$/i;

function normalizeTypeId(value) {
  return String(value ?? '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function evaluateComponentName(input) {
  const sourceComponentName = String(input?.sourceComponentName ?? '').trim() || null;
  const actualFunctionName = String(input?.actualFunctionName ?? '').trim();
  const actualFunctionTypeId = normalizeTypeId(input?.actualFunctionTypeId);
  const evidenceConfidence = Number(input?.evidenceConfidence ?? 0);
  const aliases = new Set([
    actualFunctionTypeId,
    ...(input?.acceptedAliases ?? []).map(normalizeTypeId),
  ]);

  if (!actualFunctionName) throw new TypeError('actualFunctionName is required');
  if (!actualFunctionTypeId) throw new TypeError('actualFunctionTypeId is required');
  if (!Number.isFinite(evidenceConfidence) || evidenceConfidence < 0 || evidenceConfidence > 1) {
    throw new TypeError('evidenceConfidence must be between 0 and 1');
  }
  if (evidenceConfidence < 0.7) {
    return {
      sourceComponentName,
      actualFunctionName,
      normalizedComponentType: null,
      nameMatchStatus: 'review-required',
      evidenceConfidence,
      decisionReason: 'Functional evidence is below the automatic naming threshold.',
    };
  }

  if (!sourceComponentName) {
    return {
      sourceComponentName,
      actualFunctionName,
      normalizedComponentType: actualFunctionTypeId,
      nameMatchStatus: 'missing',
      evidenceConfidence,
      decisionReason: 'The source exposes no component name; the observed function is used.',
    };
  }

  const normalizedSourceName = normalizeTypeId(sourceComponentName);
  if (aliases.has(normalizedSourceName)) {
    return {
      sourceComponentName,
      actualFunctionName,
      normalizedComponentType: actualFunctionTypeId,
      nameMatchStatus: 'matched',
      evidenceConfidence,
      decisionReason: 'The source component name matches the observed function.',
    };
  }

  if (GENERIC_NAME.test(sourceComponentName)) {
    return {
      sourceComponentName,
      actualFunctionName,
      normalizedComponentType: actualFunctionTypeId,
      nameMatchStatus: 'generic',
      evidenceConfidence,
      decisionReason: 'The source name is structural or instance-only and has no reusable function meaning.',
    };
  }

  return {
    sourceComponentName,
    actualFunctionName,
    normalizedComponentType: actualFunctionTypeId,
    nameMatchStatus: 'mismatched',
    evidenceConfidence,
    decisionReason: 'The source component name does not match the observed function.',
  };
}

