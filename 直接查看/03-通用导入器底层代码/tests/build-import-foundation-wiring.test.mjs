import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Web build writes the shared page identity and component dossier artifacts', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const stageAuditSource = await fs.readFile(new URL('../scripts/audit-stage-component-packages.mjs', import.meta.url), 'utf8');
  const diskBackedSource = await fs.readFile(new URL('../scripts/lib/disk-backed-import-foundation.mjs', import.meta.url), 'utf8');
  assert.match(source, /createDiskBackedImportFoundation/);
  assert.match(source, /await importFoundationAccumulator\.addPages/);
  assert.match(source, /retainedFullComponentCount/);
  assert.match(source, /platform:\s*'web'/);
  assert.match(source, /import-foundation\.json/);
  assert.match(source, /page-identity-registry\.json/);
  assert.match(source, /pageIdentityByRoute/);
  assert.match(diskBackedSource, /auditEditableImportFoundation/);
  assert.match(source, /editable-contract-audit\.json/);
  assert.match(source, /Editable component contract gate failed/);
  assert.match(source, /loadVerifiedRecoveredImages/);
  assert.match(source, /localizeRecoveredImages/);
  assert.match(source, /remainingActiveReferences/);
  assert.match(source, /deactivateInactiveRemoteMedia/);
  assert.ok(
    source.lastIndexOf('localizeRecoveredImages(') < source.lastIndexOf('createDiskBackedImportFoundation({'),
    'recovered images must be localized before component and editable-contract analysis',
  );
  assert.ok(
    source.indexOf('deactivateInactiveRemoteMedia(localizedDocument)') < source.indexOf('externalizePageAssetBundle('),
    'inactive remote media must be deactivated before page assets and components are analyzed',
  );
  assert.match(source, /platformPageId/);
  assert.doesNotMatch(source, /const pageId = composition\.route/);
  assert.match(source, /const stagingRoot = path\.join\(root, '\.dist-staging'\)/);
  assert.match(source, /process\.pid/);
  assert.match(source, /component-package-report\.json/);
  assert.match(source, /component-package-registry\.json/);
  assert.match(stageAuditSource, /deactivateInactiveRemoteMedia\(markup\)/);
  assert.match(source, /collectVerifiedPublicAssets\(dist/);
  assert.match(stageAuditSource, /collectVerifiedPublicAssets\(stage/);
  assert.match(stageAuditSource, /loadVerifiedRemoteAssetManifest/);
  assert.match(stageAuditSource, /localizeRemoteAssets/);
  assert.match(source, /freezeRemoteAssets/);
  assert.match(source, /Remote asset preflight gate failed/);
  assert.match(source, /source-remote-asset-preflight\.json/);
  assert.match(source, /cachedRemoteAssetPreflight\?\.cacheKey === resourcePreflightCacheKey/);
  assert.match(source, /localizeRemoteAssets/);
  assert.match(source, /recoveredImagesBySource\.size > 0\s*\? localizeRecoveredImages/);
  assert.match(source, /writeBuildPageCheckpoint/);
  assert.match(source, /prepareBuildResume/);
  assert.match(source, /--resume-from=/);
  assert.match(source, /--continue-existing-stage=/);
  assert.match(source, /continueExistingStage/);
  assert.match(source, /reusedReplayFiles:\s*new Set\(sourceReplayFiles\)/);
  assert.match(source, /sourceReplayDir/);
  assert.match(source, /if \(!continueExistingStage\) \{\s*await fs\.rm\(dist/);
  assert.match(source, /if \(continueExistingStage\) \{\s*remoteAssetPreflight = await loadVerifiedRemoteAssetManifest/);
  assert.ok(
    source.indexOf("build-checkpoint-integrity-existing-stage.json") < source.indexOf('freezeRemoteAssets(activeRemoteAssetHtml()'),
    'existing-stage source and output hashes must be verified before deciding to reuse its remote-asset evidence',
  );
  assert.match(source, /reusedReplayFiles\.has\(replayFile\)/);
  assert.match(source, /await writeBuildPageCheckpoint\(\{/);
  assert.match(source, /auditBuildCheckpointIntegrity/);
  assert.match(source, /build-checkpoint-integrity-after-pages\.json/);
  assert.match(source, /build-checkpoint-integrity-final\.json/);
  assert.ok(
    source.indexOf("build-checkpoint-integrity-after-pages.json") < source.indexOf("await recordGenerationPhase('page-analysis')"),
    'all page checkpoints must be audited before component analysis',
  );
  assert.ok(
    source.indexOf("build-checkpoint-integrity-final.json") < source.indexOf('if (stageOnly) {'),
    'page checkpoint hashes must be audited again before staging completion or promotion',
  );
  assert.ok(
    source.indexOf('await writeBuildPageCheckpoint({') < source.indexOf("await recordGenerationPhase('page-analysis')"),
    'each generated page and its assets must be durably checkpointed before page analysis',
  );
  assert.doesNotMatch(source, /recoveredImageTargetFiles\.has\(replayFile\)/);
  assert.ok(
    source.indexOf('localizeRemoteAssets(') < source.indexOf('externalizePageAssetBundle('),
    'active remote assets must be localized before page assets and components are analyzed',
  );
});
