const REQUIRED_FIELDS = [
  'componentTypeId',
  'componentInstanceId',
  'sourceComponentName',
  'actualFunctionName',
  'nameMatchStatus',
  'schema',
  'functionFingerprint',
  'structureInteractionFingerprint',
  'responsiveFingerprint',
  'classification',
  'sourceEvidence',
  'version',
];

const NAME_STATUSES = new Set(['matched', 'missing', 'generic', 'mismatched', 'review-required']);
const CLASSIFICATIONS = new Set(['duplicate', 'variant', 'new', 'review-required']);

export function createComponentDossier(input) {
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(input ?? {}, field)) throw new TypeError(`${field} is required`);
  }
  if (!/^\d{16}$/.test(String(input.platformPageId ?? ''))) {
    throw new TypeError('platformPageId must contain exactly 16 digits');
  }
  if (!NAME_STATUSES.has(input.nameMatchStatus)) {
    throw new TypeError('nameMatchStatus is invalid');
  }
  if (!CLASSIFICATIONS.has(input.classification)) {
    throw new TypeError('classification is invalid');
  }
  if (!Array.isArray(input.sourceEvidence) || input.sourceEvidence.length === 0) {
    throw new TypeError('sourceEvidence must contain at least one evidence record');
  }
  if (!input.schema || typeof input.schema !== 'object') {
    throw new TypeError('schema must be an object');
  }

  return {
    ...input,
    platformComponentId: input.platformComponentId ?? null,
    sourceComponentName: input.sourceComponentName ?? null,
    parentInstanceId: input.parentInstanceId ?? null,
    order: Number(input.order ?? 0),
    settings: input.settings ?? {},
  };
}

