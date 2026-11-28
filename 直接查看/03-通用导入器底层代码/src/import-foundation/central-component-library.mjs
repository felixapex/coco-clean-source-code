import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { classifyComponent } from './component-classifier.mjs';

const REQUIRED_CANDIDATE_FIELDS = [
  'componentTypeId',
  'componentInstanceId',
  'platformPageId',
  'schema',
  'version',
];

function defaultComponentIdFactory() {
  const random = BigInt(`0x${randomBytes(8).toString('hex')}`);
  return String(1_000_000_000_000_000n + (random % 9_000_000_000_000_000n));
}

function exactFingerprintKey(candidate) {
  return [
    candidate.functionFingerprint,
    candidate.structureInteractionFingerprint,
    candidate.responsiveFingerprint,
    candidate.schemaFingerprint,
  ].join('\u0000');
}

function coreFingerprintKey(candidate) {
  return [candidate.functionFingerprint, candidate.structureInteractionFingerprint].join('\u0000');
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined && String(value).trim()).map(String))];
}

function mergeEvidence(existing = [], incoming = []) {
  const byId = new Map();
  for (const evidence of [...existing, ...incoming]) {
    const key = evidence?.id ?? JSON.stringify(evidence);
    if (!byId.has(key)) byId.set(key, evidence);
  }
  return [...byId.values()];
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function contentFingerprint(value) {
  return `instance:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function reviewCandidateSummary(candidate) {
  return {
    componentTypeId: candidate.componentTypeId,
    componentInstanceId: String(candidate.componentInstanceId),
    platformPageId: String(candidate.platformPageId),
    sourceComponentName: candidate.sourceComponentName ?? null,
    actualFunctionName: candidate.actualFunctionName ?? null,
    nameMatchStatus: candidate.nameMatchStatus ?? null,
    nameAmbiguityReason: candidate.nameAmbiguityReason ?? null,
    functionFingerprint: candidate.functionFingerprint ?? null,
    structureInteractionFingerprint: candidate.structureInteractionFingerprint ?? null,
    responsiveFingerprint: candidate.responsiveFingerprint ?? null,
    schemaFingerprint: candidate.schemaFingerprint ?? null,
    sourceEvidence: candidate.sourceEvidence ?? [],
    sourceArtifactRef: candidate.sourceArtifactRef ?? null,
    version: candidate.version,
  };
}

function validateCandidate(candidate) {
  for (const field of REQUIRED_CANDIDATE_FIELDS) {
    if (!Object.hasOwn(candidate ?? {}, field) || candidate[field] === null || candidate[field] === '') {
      throw new TypeError(`${field} is required`);
    }
  }
  if (!/^\d{16}$/.test(String(candidate.platformPageId))) {
    throw new TypeError('platformPageId must contain exactly 16 digits');
  }
}

function nextPermanentId(library, idFactory) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = String(idFactory());
    if (!/^\d{16}$/.test(id)) throw new TypeError('platformComponentId must contain exactly 16 digits');
    if (!Object.hasOwn(library.components, id)) return id;
  }
  throw new Error('Unable to allocate a unique platformComponentId');
}

function variantRecord(candidate) {
  return {
    responsiveFingerprint: candidate.responsiveFingerprint,
    schemaFingerprint: candidate.schemaFingerprint,
    version: candidate.version,
    implementationRef: candidate.implementationRef ?? null,
  };
}

function usageRecord(candidate, platformComponentId, classification) {
  const firstEvidence = candidate.sourceEvidence?.[0] ?? {};
  return {
    platformComponentId,
    platformPageId: String(candidate.platformPageId),
    componentInstanceId: String(candidate.componentInstanceId),
    siteId: candidate.siteId ?? firstEvidence.siteId ?? null,
    route: candidate.sourceRoute ?? firstEvidence.route ?? null,
    sourceUrl: candidate.sourceUrl ?? firstEvidence.sourceUrl ?? null,
    sourceArtifactRef: candidate.sourceArtifactRef ?? null,
    parentInstanceId: candidate.parentInstanceId ?? null,
    order: Number(candidate.order ?? 0),
    instanceDataFingerprint: contentFingerprint({
      settings: candidate.settings ?? {},
      blocks: candidate.blocks ?? {},
      blockOrder: candidate.blockOrder ?? [],
    }),
    sourceEvidence: candidate.sourceEvidence ?? [],
    classification,
  };
}

export function createEmptyComponentLibrary() {
  return {
    schemaVersion: 1,
    components: {},
    exactFingerprintIndex: {},
    coreFingerprintIndex: {},
    usages: {},
    reviewQueue: {},
  };
}

function assertLegacyMigrationMode(legacyMigrationMode) {
  if (legacyMigrationMode !== true) {
    throw new Error('COMPONENT_LIBRARY_ALLOCATION_BLOCKED: coco-v1-pending');
  }
}

export function registerCandidateComponent(candidate, currentLibrary, {
  idFactory = defaultComponentIdFactory,
  legacyMigrationMode = false,
} = {}) {
  assertLegacyMigrationMode(legacyMigrationMode);
  validateCandidate(candidate);
  const base = currentLibrary ?? createEmptyComponentLibrary();
  const library = {
    ...base,
    components: { ...(base.components ?? {}) },
    exactFingerprintIndex: { ...(base.exactFingerprintIndex ?? {}) },
    coreFingerprintIndex: { ...(base.coreFingerprintIndex ?? {}) },
    usages: { ...(base.usages ?? {}) },
    reviewQueue: { ...(base.reviewQueue ?? {}) },
  };
  const usageKey = `${candidate.platformPageId}:${candidate.componentInstanceId}`;
  const existingComponents = Object.values(library.components);
  const classified = candidate.nameMatchStatus === 'review-required'
    ? { classification: 'review-required', reason: 'Component name and observed function have not been verified.' }
    : classifyComponent(candidate, existingComponents);

  if (classified.classification === 'review-required') {
    library.reviewQueue[usageKey] = {
      candidateSummary: reviewCandidateSummary(candidate),
      reason: classified.reason,
    };
    return { library, classification: 'review-required', platformComponentId: null, usageKey };
  }

  const exactKey = exactFingerprintKey(candidate);
  const coreKey = coreFingerprintKey(candidate);
  let platformComponentId = library.exactFingerprintIndex[exactKey] ?? null;
  let classification = platformComponentId ? 'duplicate' : classified.classification;
  if (!platformComponentId && classification === 'variant') {
    platformComponentId = library.coreFingerprintIndex[coreKey]
      ?? existingComponents.find((component) => component.componentTypeId === classified.matchedComponentTypeId)?.platformComponentId
      ?? null;
  }

  if (!platformComponentId) {
    classification = 'new';
    platformComponentId = nextPermanentId(library, idFactory);
    library.components[platformComponentId] = {
      platformComponentId,
      componentTypeId: candidate.componentTypeId,
      actualFunctionName: candidate.actualFunctionName ?? candidate.componentTypeId,
      sourceAliases: uniqueStrings([candidate.sourceComponentName]),
      schema: candidate.schema,
      functionFingerprint: candidate.functionFingerprint,
      structureInteractionFingerprint: candidate.structureInteractionFingerprint,
      responsiveFingerprint: candidate.responsiveFingerprint,
      schemaFingerprint: candidate.schemaFingerprint,
      variants: [variantRecord(candidate)],
      sourceEvidence: mergeEvidence([], candidate.sourceEvidence),
      version: candidate.version,
    };
    library.coreFingerprintIndex[coreKey] = platformComponentId;
  } else {
    const existing = library.components[platformComponentId];
    const variants = [...(existing.variants ?? [])];
    if (!variants.some((variant) => (
      variant.responsiveFingerprint === candidate.responsiveFingerprint
      && variant.schemaFingerprint === candidate.schemaFingerprint
    ))) {
      variants.push(variantRecord(candidate));
    }
    library.components[platformComponentId] = {
      ...existing,
      sourceAliases: uniqueStrings([...(existing.sourceAliases ?? []), candidate.sourceComponentName]),
      variants,
      sourceEvidence: mergeEvidence(existing.sourceEvidence, candidate.sourceEvidence),
    };
  }

  library.exactFingerprintIndex[exactKey] = platformComponentId;
  if (!library.coreFingerprintIndex[coreKey]) library.coreFingerprintIndex[coreKey] = platformComponentId;
  library.usages[usageKey] = usageRecord(candidate, platformComponentId, classification);
  delete library.reviewQueue[usageKey];
  return { library, classification, platformComponentId, usageKey };
}

export function registerImportFoundationCandidates(importFoundation, currentLibrary, {
  siteId,
  sourceArtifactRef = null,
  idFactory = defaultComponentIdFactory,
  legacyMigrationMode = false,
} = {}) {
  assertLegacyMigrationMode(legacyMigrationMode);
  const normalizedSiteId = String(siteId ?? '').trim();
  if (!normalizedSiteId) throw new TypeError('siteId is required');
  if (!Array.isArray(importFoundation?.pages)) throw new TypeError('importFoundation.pages must be an array');

  const normalizedComponents = Array.isArray(importFoundation.componentLibrary)
    ? importFoundation.componentLibrary
    : [];
  const normalizedComponentsByInstanceId = new Map();
  for (const component of normalizedComponents) {
    const componentInstanceId = String(component?.componentInstanceId ?? '').trim();
    if (!componentInstanceId) throw new TypeError('top-level componentLibrary entry is missing componentInstanceId');
    if (normalizedComponentsByInstanceId.has(componentInstanceId)) {
      throw new TypeError(`duplicate top-level componentInstanceId: ${componentInstanceId}`);
    }
    normalizedComponentsByInstanceId.set(componentInstanceId, component);
  }

  let library = currentLibrary ?? createEmptyComponentLibrary();
  const assignments = [];
  const summary = {
    candidateCount: 0,
    newCount: 0,
    duplicateCount: 0,
    variantCount: 0,
    reviewRequiredCount: 0,
  };

  for (const page of importFoundation.pages) {
    const platformPageId = String(page?.pageIdentity?.platformPageId ?? '');
    if (!/^\d{16}$/.test(platformPageId)) {
      throw new TypeError(`page ${page?.route ?? '(unknown)'} is missing a permanent platformPageId`);
    }
    const embeddedComponents = Array.isArray(page.components) ? page.components : [];
    const referencedComponentIds = Array.isArray(page.componentInstanceIds) ? page.componentInstanceIds : [];
    const pageComponents = embeddedComponents.length > 0
      ? embeddedComponents
      : referencedComponentIds.map((componentInstanceId) => {
        const normalizedComponent = normalizedComponentsByInstanceId.get(String(componentInstanceId));
        if (!normalizedComponent) {
          throw new TypeError(`page ${page?.route ?? '(unknown)'} references missing component instance ${componentInstanceId}`);
        }
        return normalizedComponent;
      });

    for (const component of pageComponents) {
      const sourceEvidence = mergeEvidence(component.sourceEvidence, [{
        id: `site:${normalizedSiteId}:page:${platformPageId}:instance:${component.componentInstanceId}`,
        kind: 'site-component-usage',
        siteId: normalizedSiteId,
        route: page.route ?? null,
        sourceUrl: page.pageIdentity?.sourceUrl ?? null,
        platform: importFoundation.platform ?? null,
        importRunId: importFoundation.importRunId ?? null,
      }]);
      const registered = registerCandidateComponent({
        ...component,
        platformPageId,
        siteId: normalizedSiteId,
        sourceRoute: page.route ?? null,
        sourceUrl: page.pageIdentity?.sourceUrl ?? null,
        sourceArtifactRef,
        sourceEvidence,
      }, library, { idFactory, legacyMigrationMode });
      library = registered.library;
      summary.candidateCount += 1;
      if (registered.classification === 'new') summary.newCount += 1;
      else if (registered.classification === 'duplicate') summary.duplicateCount += 1;
      else if (registered.classification === 'variant') summary.variantCount += 1;
      else summary.reviewRequiredCount += 1;
      assignments.push({
        siteId: normalizedSiteId,
        route: page.route ?? null,
        platformPageId,
        componentInstanceId: component.componentInstanceId,
        platformComponentId: registered.platformComponentId,
        classification: registered.classification,
      });
    }
  }

  if (normalizedComponents.length > 0 && summary.candidateCount === 0) {
    throw new Error(`import foundation contains ${normalizedComponents.length} top-level components but registered zero candidates`);
  }

  return { library, assignments, summary };
}

export async function loadComponentLibrary(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (parsed?.schemaVersion !== 1) throw new Error('Unsupported component library schemaVersion');
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return createEmptyComponentLibrary();
    throw error;
  }
}

export async function saveComponentLibrary(filePath, library) {
  if (library?.schemaVersion !== 1) throw new TypeError('component library schemaVersion must be 1');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    const handle = await fs.open(temporaryPath, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(library, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
  return { filePath, componentCount: Object.keys(library.components).length, usageCount: Object.keys(library.usages).length };
}
