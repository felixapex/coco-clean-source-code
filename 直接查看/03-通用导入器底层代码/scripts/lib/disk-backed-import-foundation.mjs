import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateSiteVerification } from '../../src/import-foundation/verification-gates.mjs';
import {
  buildImportFoundationRecords,
  compactImportFoundationRecords,
} from './component-registry.mjs';
import { auditEditableImportFoundation } from './editable-import-audit.mjs';
import { writeJsonObjectFromJsonLineArrays } from './stream-json-file.mjs';

const INTERNAL_VERIFICATION_EVIDENCE = Object.freeze({
  publicResources: { pass: true },
  components: [{ id: 'batch', status: 'passed' }],
  pages: [{ platformPageId: 'batch', status: 'passed' }],
  site: { status: 'passed', routeCoverage: 1, interactionCoverage: 1, escapedSourceLinks: 0 },
});

function classificationSummary(component) {
  return {
    componentTypeId: component.componentTypeId,
    version: component.version,
    functionFingerprint: component.functionFingerprint,
    structureInteractionFingerprint: component.structureInteractionFingerprint,
    responsiveFingerprint: component.responsiveFingerprint,
    schemaFingerprint: component.schemaFingerprint,
  };
}

function mergeCoverage(target, incoming = {}) {
  for (const key of ['components', 'blocks', 'leafBlocks', 'blockContainers', 'pageReferences']) {
    target[key] += Number(incoming[key] || 0);
  }
  target.maxBlocksPerContainer = Math.max(
    target.maxBlocksPerContainer,
    Number(incoming.maxBlocksPerContainer || 0),
  );
}

function defaultVerification(componentIds, platformPageIds) {
  return evaluateSiteVerification({
    publicResources: { pass: false, failures: [{ type: 'public-resource-verification-missing' }] },
    components: componentIds.map((id) => ({ id, status: 'pending' })),
    pages: platformPageIds.map((platformPageId) => ({ platformPageId, status: 'pending' })),
    site: { status: 'blocked', routeCoverage: 0, interactionCoverage: 0, escapedSourceLinks: 0 },
  });
}

export async function createDiskBackedImportFoundation(options = {}) {
  const workDir = path.resolve(String(options.workDir || ''));
  const outputPath = path.resolve(String(options.outputPath || ''));
  if (!options.workDir) throw new TypeError('workDir is required');
  if (!options.outputPath) throw new TypeError('outputPath is required');
  await fs.mkdir(workDir, { recursive: true });
  const pagesJsonlPath = path.join(workDir, 'pages.jsonl');
  const componentsJsonlPath = path.join(workDir, 'components.jsonl');
  await fs.writeFile(pagesJsonlPath, '', 'utf8');
  await fs.writeFile(componentsJsonlPath, '', 'utf8');

  let pageIdentityRegistry = options.pageIdentityRegistry;
  let themeBlockCatalog = options.themeBlockCatalog ?? null;
  const knownComponentSummaries = [...(options.existingComponents || [])].map(classificationSummary);
  const componentIds = [];
  const platformPageIds = [];
  const pageIdentityByRoute = new Map();
  const auditFailures = new Map();
  const auditCoverage = {
    components: 0,
    blocks: 0,
    leafBlocks: 0,
    blockContainers: 0,
    maxBlocksPerContainer: 0,
    pageReferences: 0,
  };
  let finished = false;

  return {
    async addPages(batch) {
      if (finished) throw new Error('disk-backed import foundation is already finished');
      if (!Array.isArray(batch) || batch.length === 0) return;
      const existingCount = knownComponentSummaries.length;
      const result = buildImportFoundationRecords(batch, {
        ...options,
        pageIdentityRegistry,
        themeBlockCatalog,
        existingComponents: knownComponentSummaries,
        verificationEvidence: INTERNAL_VERIFICATION_EVIDENCE,
      });
      const newComponents = result.componentLibrary.slice(existingCount);
      const compacted = compactImportFoundationRecords({
        ...result,
        pages: result.pages,
        componentLibrary: newComponents,
      });
      const editableAudit = auditEditableImportFoundation(compacted);
      mergeCoverage(auditCoverage, editableAudit.coverage);
      for (const failure of editableAudit.failures) {
        auditFailures.set(JSON.stringify(failure), failure);
      }

      await fs.appendFile(
        pagesJsonlPath,
        compacted.pages.map((page) => `${JSON.stringify(page)}\n`).join(''),
        'utf8',
      );
      await fs.appendFile(
        componentsJsonlPath,
        newComponents.map((component) => `${JSON.stringify(component)}\n`).join(''),
        'utf8',
      );
      for (const page of result.pages) {
        pageIdentityByRoute.set(page.route, page.pageIdentity);
        platformPageIds.push(page.pageIdentity.platformPageId);
      }
      for (const component of newComponents) {
        componentIds.push(component.componentInstanceId);
        knownComponentSummaries.push(classificationSummary(component));
      }
      pageIdentityRegistry = result.pageIdentityRegistry;
      themeBlockCatalog = result.themeBlockCatalog;
    },

    async finish() {
      if (finished) throw new Error('disk-backed import foundation is already finished');
      finished = true;
      const verification = options.verificationEvidence
        ? evaluateSiteVerification(options.verificationEvidence)
        : defaultVerification(componentIds, platformPageIds);
      const write = await writeJsonObjectFromJsonLineArrays(outputPath, {
        schemaVersion: 1,
        platform: String(options.platform || '').trim(),
        importRunId: String(options.importRunId || '').trim(),
        themeBlockCatalog: themeBlockCatalog ?? {},
        pageIdentityRegistry,
        pages: { jsonlPath: pagesJsonlPath },
        componentLibrary: { jsonlPath: componentsJsonlPath },
        verification,
      }, { jsonLineArrayKeys: ['pages', 'componentLibrary'] });
      return {
        write,
        pageIdentityRegistry,
        pageIdentityByRoute,
        editableContractAudit: {
          pass: auditFailures.size === 0,
          failures: [...auditFailures.values()],
          coverage: auditCoverage,
        },
        retainedFullComponentCount: 0,
        componentCount: componentIds.length,
        pageCount: platformPageIds.length,
      };
    },
  };
}
