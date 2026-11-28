import { assignPageIdentity, createEmptyPageIdentityRegistry } from './page-identity.mjs';
import { evaluateComponentName } from './component-naming.mjs';
import { inferComponentFunctionEvidence } from './component-function-evidence.mjs';
import { createComponentFingerprints } from './component-fingerprints.mjs';
import { classifyComponent } from './component-classifier.mjs';
import { createComponentDossier } from './component-dossier.mjs';
import { evaluateSiteVerification } from './verification-gates.mjs';

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function markupSemantics(markup) {
  const tags = [...String(markup).matchAll(/<([a-zA-Z][\w:-]*)\b/g)].map((match) => match[1].toLowerCase());
  const controls = [...String(markup).matchAll(/<(a|button|summary|form|input|select|textarea)\b/gi)]
    .map((match) => match[1].toLowerCase());
  return {
    tags,
    controls,
    states: unique([...String(markup).matchAll(/\b(?:aria-expanded|aria-selected|aria-hidden|open|hidden)\b/gi)]
      .map((match) => match[0].toLowerCase())).sort(),
  };
}

function sourceUrlFor(page, sourceOrigin) {
  if (page.sourceUrl) return page.sourceUrl;
  if (!sourceOrigin) throw new TypeError(`sourceOrigin is required for route ${page.route}`);
  return new URL(page.route || '/', sourceOrigin).toString();
}

function defaultVerificationInput(knownComponents, outputPages) {
  return {
    publicResources: { pass: false, failures: [{ type: 'public-resource-verification-missing' }] },
    components: knownComponents.map((component) => ({ id: component.componentInstanceId, status: 'pending' })),
    pages: outputPages.map((page) => ({ platformPageId: page.pageIdentity.platformPageId, status: 'pending' })),
    site: {
      status: 'blocked',
      routeCoverage: 0,
      interactionCoverage: 0,
      escapedSourceLinks: 0,
    },
  };
}

export function buildImportFoundationRecords(pages, options, extractPageComponents) {
  if (typeof extractPageComponents !== 'function') throw new TypeError('extractPageComponents is required');
  const platform = String(options?.platform ?? '').trim();
  const importRunId = String(options?.importRunId ?? '').trim();
  if (!platform) throw new TypeError('platform is required');
  if (!importRunId) throw new TypeError('importRunId is required');

  let pageIdentityRegistry = options.pageIdentityRegistry ?? createEmptyPageIdentityRegistry();
  let themeBlockCatalog = options.themeBlockCatalog ?? null;
  const knownComponents = [...(options.existingComponents ?? [])];
  const outputPages = [];

  for (const page of pages) {
    const assigned = assignPageIdentity({
      platform,
      sourcePageId: page.sourcePageId ?? null,
      sourceUrl: sourceUrlFor(page, options.sourceOrigin),
      sourcePageName: page.sourcePageName ?? null,
      canonicalRoute: page.route,
      importRunId,
    }, pageIdentityRegistry);
    pageIdentityRegistry = assigned.registry;

    const extracted = extractPageComponents(page.html, page.route);
    const dossiers = extracted.components.map((component, order) => {
      if (!themeBlockCatalog && component.editableContract?.themeBlocks) {
        themeBlockCatalog = component.editableContract.themeBlocks;
      }
      const editableContract = component.editableContract ? {
        ...component.editableContract,
        themeBlockTypes: Object.keys(component.editableContract.themeBlocks || {}).sort(),
      } : null;
      if (editableContract) delete editableContract.themeBlocks;
      const inferredFunctionEvidence = inferComponentFunctionEvidence({
        sourceComponentName: component.sourceSectionType,
        sourceMarkup: component.sourceMarkup,
      });
      const explicitFunctionEvidence = options.functionEvidenceBySourceSectionId?.[component.sourceSectionId] ?? {};
      const functionEvidence = {
        ...inferredFunctionEvidence,
        ...explicitFunctionEvidence,
        acceptedAliases: explicitFunctionEvidence.acceptedAliases ?? inferredFunctionEvidence.acceptedAliases,
        nameDecisionEvidence: explicitFunctionEvidence.nameDecisionEvidence ?? inferredFunctionEvidence.nameDecisionEvidence,
      };
      const naming = evaluateComponentName({
        sourceComponentName: component.sourceSectionType,
        actualFunctionName: functionEvidence.actualFunctionName ?? component.sourceSectionType,
        actualFunctionTypeId: functionEvidence.actualFunctionTypeId ?? component.sourceSectionType,
        acceptedAliases: functionEvidence.acceptedAliases ?? [],
        evidenceConfidence: functionEvidence.evidenceConfidence ?? 0,
      });
      const semantics = markupSemantics(component.sourceMarkup);
      const fingerprints = createComponentFingerprints({
        schema: component.schema ?? {
          status: 'candidate',
          settings: [],
          blocks: [],
          presets: [],
        },
        function: {
          purpose: naming.normalizedComponentType ?? component.sourceSectionType,
          capabilities: semantics.controls,
        },
        structureInteraction: {
          tree: { tags: semantics.tags },
          interactions: (options.interactionEvidenceBySourceSectionId?.[component.sourceSectionId] ?? [])
            .map((interaction) => ({
              control: interaction.control ?? interaction.controlType ?? null,
              resultType: interaction.resultType ?? null,
              target: interaction.target ?? null,
            })),
          states: semantics.states,
        },
        responsive: {
          aspectRatios: functionEvidence.aspectRatios ?? [],
          breakpoints: functionEvidence.breakpoints ?? [],
          rules: component.contract?.responsiveRules ?? [],
          layout: component.contract?.responsiveLayout ?? [],
        },
      });
      const classified = naming.nameMatchStatus === 'review-required'
        ? { classification: 'review-required', matchedComponentTypeId: null }
        : classifyComponent(fingerprints, knownComponents);
      const dossier = createComponentDossier({
        componentTypeId: naming.normalizedComponentType ?? component.sourceSectionType,
        componentInstanceId: component.matboxInstanceId,
        sourceComponentName: naming.sourceComponentName,
        actualFunctionName: naming.actualFunctionName,
        nameMatchStatus: naming.nameMatchStatus,
        nameDecisionEvidence: functionEvidence.nameDecisionEvidence ?? [],
        nameAmbiguityReason: functionEvidence.ambiguityReason ?? null,
        schema: component.schema ?? {
          status: 'candidate',
          settings: [],
          blocks: [],
          presets: [],
        },
        ...fingerprints,
        classification: classified.classification,
        sourceEvidence: [{
          id: `source-section:${component.sourceSectionId}`,
          kind: 'dom-section',
          sourceSectionId: component.sourceSectionId,
          route: page.route,
        }],
        version: '1.0.0',
        platformPageId: assigned.record.platformPageId,
        parentInstanceId: null,
        order,
        settings: component.settings ?? {},
        blocks: component.blocks ?? {},
        blockOrder: component.blockOrder ?? [],
        editableContract,
        sourceFingerprint: component.sourceFingerprint,
        originalRegistryComponentId: component.matboxComponentId,
        matchedComponentTypeId: classified.matchedComponentTypeId ?? null,
      });
      knownComponents.push(dossier);
      return dossier;
    });

    outputPages.push({
      route: page.route,
      pageIdentity: assigned.record,
      composition: extracted.composition,
      components: dossiers,
    });
  }

  const verificationInput = options.verificationEvidence ?? defaultVerificationInput(knownComponents, outputPages);
  const verification = evaluateSiteVerification(verificationInput);

  return {
    schemaVersion: 1,
    platform,
    importRunId,
    themeBlockCatalog: themeBlockCatalog ?? {},
    pageIdentityRegistry,
    pages: outputPages,
    componentLibrary: knownComponents,
    verification,
  };
}

export function createImportFoundationAccumulator(options, extractPageComponents) {
  if (typeof extractPageComponents !== 'function') throw new TypeError('extractPageComponents is required');
  const pages = [];
  let pageIdentityRegistry = options?.pageIdentityRegistry ?? createEmptyPageIdentityRegistry();
  let themeBlockCatalog = options?.themeBlockCatalog ?? null;
  let componentLibrary = [...(options?.existingComponents ?? [])];

  return {
    addPages(batch) {
      if (!Array.isArray(batch) || batch.length === 0) return;
      const result = buildImportFoundationRecords(batch, {
        ...options,
        pageIdentityRegistry,
        themeBlockCatalog,
        existingComponents: componentLibrary,
      }, extractPageComponents);
      pages.push(...result.pages);
      pageIdentityRegistry = result.pageIdentityRegistry;
      themeBlockCatalog = result.themeBlockCatalog;
      componentLibrary = result.componentLibrary;
    },
    finish() {
      return {
        schemaVersion: 1,
        platform: String(options?.platform ?? '').trim(),
        importRunId: String(options?.importRunId ?? '').trim(),
        themeBlockCatalog: themeBlockCatalog ?? {},
        pageIdentityRegistry,
        pages,
        componentLibrary,
        verification: evaluateSiteVerification(
          options?.verificationEvidence ?? defaultVerificationInput(componentLibrary, pages),
        ),
      };
    },
  };
}

