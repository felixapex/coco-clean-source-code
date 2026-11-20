import { captureHtml } from '../capture/chromium-capture.mjs';
import { EvidenceStore } from '../evidence/evidence-store.mjs';
import { clusterCandidates } from '../component/cluster.mjs';
import { createEmptyIr, validateComponentIr } from '../ir/component-ir.mjs';
import { pairwiseClusteringMetrics } from '../benchmark/clustering-metrics.mjs';

function evidenceRecord(entry, type, source = 'chromium-cdp') {
  return {
    id: entry.id,
    type,
    source,
    artifactRef: entry.filename,
    hash: entry.sha256,
  };
}

export async function runControlledPoc({ html, outputRoot, chromiumPath = '/usr/bin/chromium' }) {
  const capture = await captureHtml(html, { chromiumPath, timeoutMs: 15000 });
  const store = new EvidenceStore(outputRoot);
  const writer = await store.createCapture('controlled-fixture', {
    sourceUrl: 'https://controlled-fixture.invalid/',
    captureMode: 'html-injection',
  });

  const metadataEntry = await writer.putJson('metadata', capture.metadata);
  const domEntry = await writer.putJson('dom-snapshot', capture.domSnapshot);
  const axEntry = await writer.putJson('accessibility-tree', capture.axTree);
  const interactiveEntry = await writer.putJson('interactions', capture.interactiveElements);
  const hintsEntry = await writer.putJson('component-hints', capture.componentHints);
  const screenshotEntry = await writer.putBuffer('screenshot', capture.screenshot, 'png');

  const families = clusterCandidates(capture.componentHints, { threshold: 0.75 });
  const ir = createEmptyIr({
    id: 'controlled-fixture',
    sourceUrl: 'https://controlled-fixture.invalid/',
    capturedAt: new Date().toISOString(),
    title: capture.metadata.title,
  });

  const coreEvidenceIds = [domEntry.id, axEntry.id, interactiveEntry.id, hintsEntry.id, screenshotEntry.id];
  ir.evidence = [
    evidenceRecord(metadataEntry, 'provider'),
    evidenceRecord(domEntry, 'dom'),
    evidenceRecord(axEntry, 'a11y'),
    evidenceRecord(interactiveEntry, 'interaction'),
    evidenceRecord(hintsEntry, 'dom'),
    evidenceRecord(screenshotEntry, 'screenshot'),
  ];
  ir.routes.push({
    id: 'route-home',
    path: '/',
    title: capture.metadata.title,
    sections: ['main'],
    evidenceIds: coreEvidenceIds,
  });

  const hintById = new Map(capture.componentHints.map((hint) => [hint.id, hint]));
  for (const family of families) {
    const members = family.memberIds.map((id) => hintById.get(id)).filter(Boolean);
    const first = members[0];
    const slots = [...new Set(members.flatMap((member) => member.structure?.slots ?? []))];
    const variants = [...new Set(members.map((member) => member.variant ?? 'default'))];
    const familyId = `fam-${family.id}`;

    ir.componentFamilies.push({
      id: familyId,
      canonicalName: first?.componentName ?? first?.semanticRole ?? family.id,
      semanticRole: first?.semanticRole ?? family.semanticRole,
      confidence: Math.max(0, Math.min(1, family.confidence)),
      occurrenceCount: members.length,
      routeIds: ['route-home'],
      propsSchema: {},
      slots,
      variants,
      states: ['default'],
      fingerprints: { memberHashes: family.fingerprints },
      evidenceIds: coreEvidenceIds,
    });

    for (const member of members) {
      ir.componentInstances.push({
        id: `inst-${member.id}`,
        familyId,
        routeId: 'route-home',
        bbox: member.bbox,
        contentBindings: {},
        variant: member.variant ?? 'default',
        state: 'default',
        evidenceIds: coreEvidenceIds,
      });
    }
  }

  const validation = validateComponentIr(ir);
  if (!validation.ok) throw new Error(`PoC produced invalid Component IR: ${validation.errors.join('; ')}`);

  const predictedByMember = new Map();
  for (const family of families) for (const id of family.memberIds) predictedByMember.set(id, family.id);
  const orderedHints = capture.componentHints;
  const goldLabels = orderedHints.map((hint) => hint.componentName ?? hint.semanticRole);
  const predictedLabels = orderedHints.map((hint) => predictedByMember.get(hint.id));
  const benchmark = pairwiseClusteringMetrics(goldLabels, predictedLabels);

  await writer.putJson('component-ir', ir);
  await writer.putJson('benchmark', benchmark);
  const manifest = await writer.finalize();

  return {
    ir,
    benchmark,
    manifest,
    captureDir: writer.dir,
    captureSummary: {
      title: capture.metadata.title,
      interactiveCount: capture.interactiveElements.length,
      componentHintCount: capture.componentHints.length,
      screenshotBytes: capture.screenshot.length,
    },
  };
}
