import { createHash } from 'node:crypto';

import { inferComponentFunctionEvidence } from '../../../../../packages/import-foundation/component-function-evidence.mjs';
import {
  createPortableComponentPackage,
  REQUIRED_COMPONENT_VERIFICATION_GATES,
} from '../../../../../packages/import-foundation/component-package.mjs';
import { buildComponentRegistry, localizeCapturedRouteLinks } from './component-registry.mjs';
import { buildThemeBlockCatalog, convertMarkupToEditableSection } from './editable-component-contract.mjs';

const COCO_SOURCE_ORIGIN = 'https://www.cocorepublic.com.au/';

function localizeHomepageMarkup(markup) {
  return localizeCapturedRouteLinks(markup, {
    sourceOrigin: COCO_SOURCE_ORIGIN,
    localizeAllSourceLinks: true,
  }).replace(/<source\b[^>]*\bsrc\s*=\s*(["'])https?:\/\/store-[^"']+\.mybigcommerce\.com[^>]*>/gi, '');
}

function componentId(typeId, sourceId) {
  const suffix = createHash('sha256')
    .update(`${typeId}\0${sourceId}`)
    .digest('hex')
    .slice(0, 12);
  return `matbox.section.${typeId}.v1.${suffix}`;
}

function namedSchema(schema, name) {
  return {
    ...schema,
    name,
    presets: (schema?.presets || []).map((preset) => ({ ...preset, name })),
  };
}

export function buildHomepageFormalComponents(html) {
  const artifacts = buildComponentRegistry([{ route: '/', html }], { requireGeometryEvidence: true });
  const components = artifacts.registry.components.map((candidate) => {
    const localizedSourceMarkup = localizeHomepageMarkup(candidate.sourceMarkup);
    const evidence = inferComponentFunctionEvidence({
      sourceComponentName: candidate.sourceSectionType,
      sourceMarkup: localizedSourceMarkup,
    });
    if (!evidence.actualFunctionTypeId || evidence.ambiguityReason) {
      throw new Error(`Homepage component function is unresolved: ${candidate.sourceSectionId}`);
    }
    const formalId = componentId(evidence.actualFunctionTypeId, candidate.sourceSectionId);
    const editableVariants = candidate.variants.map((variant) => {
      const localizedMarkup = localizeHomepageMarkup(variant.markup);
      const editable = convertMarkupToEditableSection({
        sectionId: formalId,
        sectionType: evidence.actualFunctionTypeId,
        markup: localizedMarkup,
      });
      return { ...variant, markup: editable.annotatedMarkup };
    });
    const editable = convertMarkupToEditableSection({
      sectionId: formalId,
      sectionType: evidence.actualFunctionTypeId,
      markup: localizedSourceMarkup,
    });
    return {
      ...candidate,
      sourceCandidateId: candidate.matboxComponentId,
      matboxComponentId: formalId,
      sourceSectionType: evidence.actualFunctionTypeId,
      actualFunctionName: evidence.actualFunctionName,
      actualFunctionTypeId: evidence.actualFunctionTypeId,
      nameDecisionEvidence: evidence.nameDecisionEvidence,
      schema: namedSchema(editable.sectionSchema, evidence.actualFunctionName),
      editableContract: editable.renderedManifest,
      editableInstance: editable.instance,
      sourceMarkup: localizedSourceMarkup,
      contract: {
        ...candidate.contract,
        assets: (candidate.contract?.assets || []).filter((asset) => localizedSourceMarkup.includes(asset)),
      },
      variants: editableVariants,
    };
  });
  return {
    components,
    themeBlockCatalog: buildThemeBlockCatalog(),
    sourceArtifacts: artifacts,
  };
}

export function buildHomepagePackageRecords({ components = [], assetManifest = [], verificationById = {} } = {}) {
  return components.map((component) => {
    const verification = verificationById[component.matboxComponentId];
    const missing = REQUIRED_COMPONENT_VERIFICATION_GATES.filter((gate) => !verification?.[gate]);
    if (missing.length > 0) {
      throw new Error(`Missing homepage component verification for ${component.matboxComponentId}: ${missing.join(', ')}`);
    }
    return createPortableComponentPackage(component, { assetManifest, verification });
  });
}

