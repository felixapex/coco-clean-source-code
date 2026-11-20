const FINGERPRINT_FIELDS = [
  'functionFingerprint',
  'structureInteractionFingerprint',
  'responsiveFingerprint',
];

export function classifyComponent(candidate, existingComponents = []) {
  if (FINGERPRINT_FIELDS.some((field) => !candidate?.[field])) {
    return {
      classification: 'review-required',
      matchedComponentTypeId: null,
      reason: 'One or more required fingerprints are missing.',
    };
  }

  const duplicate = existingComponents.find((existing) => (
    FINGERPRINT_FIELDS.every((field) => existing?.[field] === candidate[field])
  ));
  if (duplicate) {
    return {
      classification: 'duplicate',
      matchedComponentTypeId: duplicate.componentTypeId,
      matchedVersion: duplicate.version ?? null,
      reason: 'Function, structure-interaction, and responsive fingerprints all match.',
    };
  }

  const variant = existingComponents.find((existing) => (
    existing?.functionFingerprint === candidate.functionFingerprint
    && existing?.structureInteractionFingerprint === candidate.structureInteractionFingerprint
  ));
  if (variant) {
    return {
      classification: 'variant',
      matchedComponentTypeId: variant.componentTypeId,
      matchedVersion: variant.version ?? null,
      reason: 'Function and interaction match while responsive behavior differs.',
    };
  }

  return {
    classification: 'new',
    matchedComponentTypeId: null,
    matchedVersion: null,
    reason: 'No existing component has the same core function and interaction contract.',
  };
}

