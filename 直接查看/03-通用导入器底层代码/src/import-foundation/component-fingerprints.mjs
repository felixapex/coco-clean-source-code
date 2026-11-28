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

const PRESENTATION_ONLY_SCHEMA_KEYS = new Set(['default', 'info', 'label', 'name', 'placeholder', 'presets']);

function editableSchemaContract(value, parentKey = '') {
  if (Array.isArray(value)) {
    return value.map((item) => editableSchemaContract(item, parentKey));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !PRESENTATION_ONLY_SCHEMA_KEYS.has(key))
    .map(([key, child]) => {
      if (parentKey === 'options' && key === 'label') return null;
      return [key, editableSchemaContract(child, key)];
    })
    .filter(Boolean));
}

export function createEditableSchemaFingerprint(schema) {
  if (!schema || typeof schema !== 'object') throw new TypeError('schema is required');
  return fingerprint('schema', editableSchemaContract(schema));
}

export function createComponentFingerprints(input) {
  if (!input?.schema || typeof input.schema !== 'object') throw new TypeError('schema is required');
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
    schemaFingerprint: createEditableSchemaFingerprint(input.schema),
  };
}

