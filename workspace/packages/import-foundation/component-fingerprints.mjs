import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort();
}

function fingerprint(prefix, value) {
  return `${prefix}:${createHash('sha256').update(stableJson(value)).digest('hex')}`;
}

export function createComponentFingerprints(input) {
  if (!input?.function?.purpose) throw new TypeError('function.purpose is required');
  if (!input?.structureInteraction?.tree) throw new TypeError('structureInteraction.tree is required');
  if (!input?.responsive) throw new TypeError('responsive is required');

  const functionModel = {
    ...input.function,
    purpose: String(input.function.purpose).trim().toLowerCase(),
    capabilities: uniqueSorted(input.function.capabilities),
  };
  const structureInteractionModel = {
    ...input.structureInteraction,
    interactions: [...(input.structureInteraction.interactions ?? [])]
      .map(canonicalize)
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  };
  const responsiveModel = {
    ...input.responsive,
    aspectRatios: uniqueSorted(input.responsive.aspectRatios),
    breakpoints: [...(input.responsive.breakpoints ?? [])]
      .map(canonicalize)
      .sort((left, right) => Number(left.min ?? 0) - Number(right.min ?? 0)),
  };

  return {
    functionFingerprint: fingerprint('fn', functionModel),
    structureInteractionFingerprint: fingerprint('si', structureInteractionModel),
    responsiveFingerprint: fingerprint('rsp', responsiveModel),
  };
}

