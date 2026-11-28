import fs from 'node:fs/promises';
import path from 'node:path';

import { convertMarkupToEditableSection } from './lib/editable-component-contract.mjs';
import { deactivateInactiveRemoteMedia } from './lib/replay-state-sanitizer.mjs';
import { collectVerifiedPublicAssets } from './lib/public-asset-manifest.mjs';
import { loadVerifiedRemoteAssetManifest, localizeRemoteAssets } from './lib/remote-asset-freezer.mjs';
import { loadVerifiedRecoveredImages } from './lib/recovered-image-publisher.mjs';
import { localizeRecoveredImages } from './lib/image-recovery-patch.mjs';
import {
  auditPortableComponentPackage,
  createPortableComponentPackage,
} from '../src/import-foundation/component-package.mjs';

const root = process.cwd();
const stageArgument = process.argv.find((value) => value.startsWith('--stage='))?.slice('--stage='.length);
if (!stageArgument) throw new Error('Missing --stage=...');
const stage = path.resolve(root, stageArgument);
const componentLibrary = path.join(stage, 'component-library');
const verificationRoot = path.join(root, 'artifacts', 'unit-verification');
const [registry, assetManifest] = await Promise.all([
  fs.readFile(path.join(componentLibrary, 'component-registry.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(componentLibrary, 'asset-manifest.json'), 'utf8').then(JSON.parse),
]);
const verifiedPublicAssets = await collectVerifiedPublicAssets(stage, { publicDirectories: ['frozen-assets'] });
const verifiedFrozenRemoteAssets = await loadVerifiedRemoteAssetManifest(
  path.join(root, 'artifacts', 'frozen-remote-assets', 'external-v4'),
);
const verifiedRecoveredImages = await loadVerifiedRecoveredImages(
  path.join(root, 'artifacts', 'component-geometry-migration'),
);
const packageAssetManifest = [...assetManifest, ...verifiedPublicAssets, ...verifiedFrozenRemoteAssets.assets];

const failures = [];
for (const component of registry.components || []) {
  const variants = [];
  for (const variant of component.variants || []) {
    const markupFile = path.join(stage, String(variant.markupHref || '').replace(/^\//, ''));
    const markup = await fs.readFile(markupFile, 'utf8');
    const sanitizedMarkup = localizeRecoveredImages(
      localizeRemoteAssets(
        deactivateInactiveRemoteMedia(markup),
        verifiedFrozenRemoteAssets.resourceMap,
      ),
      verifiedRecoveredImages,
    ).html;
    const editable = convertMarkupToEditableSection({
      sectionId: component.sourceSectionId,
      sectionType: component.sourceSectionType,
      markup: sanitizedMarkup,
    });
    variants.push({ ...variant, markup: editable.annotatedMarkup });
  }
  const unitFolder = encodeURIComponent(component.matboxComponentId);
  const evidence = await fs.readFile(path.join(verificationRoot, `${unitFolder}.json`), 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error?.code === 'ENOENT') return {};
      throw error;
    });
  // Recompute active assets from current markup. A stage produced by an older
  // extractor can contain stale contract.assets entries from provenance-only
  // attributes; they must not contaminate the current-code preflight.
  const packageRecord = createPortableComponentPackage({
    ...component,
    contract: { ...(component.contract || {}), assets: [] },
    variants,
  }, {
    assetManifest: packageAssetManifest,
    verification: evidence,
  });
  const audit = auditPortableComponentPackage(packageRecord);
  if (!audit.pass) failures.push({ componentId: component.matboxComponentId, failures: audit.failures });
}

const report = {
  generatedAt: new Date().toISOString(),
  stage,
  componentCount: registry.components?.length || 0,
  failedComponentCount: failures.length,
  pass: failures.length === 0,
  failures,
};
const output = path.join(root, 'artifacts', 'full-site-audit', 'stage-component-package-audit.json');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  pass: report.pass,
  componentCount: report.componentCount,
  failedComponentCount: report.failedComponentCount,
  output,
}, null, 2));
if (!report.pass) process.exitCode = 1;
