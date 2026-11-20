import { capturePage as defaultCapturePage } from '../capture/chromium-capture.mjs';
import { EvidenceStore } from '../evidence/evidence-store.mjs';
import { clusterCandidates } from '../component/cluster.mjs';
import { inferFamilyDefinition } from '../component/family-inference.mjs';
import { createEmptyIr, validateComponentIr } from '../ir/component-ir.mjs';
import { crawlSite } from '../site/site-crawler.mjs';

function safeId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

function uniqueForInstance(values = []) {
  return [...new Set(['default', ...values])];
}

function routeIdFor(url, index) {
  const parsed = new URL(url);
  if (parsed.pathname === '/' || parsed.pathname === '') return 'route-home';
  return `route-${safeId(parsed.pathname)}-${index + 1}`;
}

function siteIdFor(url) {
  const parsed = new URL(url);
  return safeId(parsed.hostname);
}

function evidenceRecord(entry, type, routeId, source = 'chromium-cdp') {
  return {
    id: entry.id,
    type,
    source,
    routeId,
    artifactRef: entry.filename,
    hash: entry.sha256,
  };
}

export async function runSiteComponentPipeline({
  startUrl,
  outputRoot,
  captureFn,
  resolver,
  maxPages = 20,
  clusterThreshold = 0.80,
  chromiumPath = '/usr/bin/chromium',
}) {
  if (!outputRoot) throw new Error('outputRoot is required');
  const effectiveCapture = captureFn ?? ((url) => defaultCapturePage(url, { chromiumPath, timeoutMs: 20000 }));
  const crawl = await crawlSite({ startUrl, captureFn: effectiveCapture, resolver, maxPages });
  if (!crawl.pages.length) throw new Error('No pages were captured');

  const siteId = siteIdFor(crawl.startUrl);
  const store = new EvidenceStore(outputRoot);
  const ir = createEmptyIr({
    id: siteId,
    sourceUrl: crawl.startUrl,
    capturedAt: new Date().toISOString(),
    title: crawl.pages[0].capture.metadata?.title ?? siteId,
  });

  const candidates = [];
  const routeManifests = [];
  const routeEvidence = new Map();

  for (let index = 0; index < crawl.pages.length; index++) {
    const page = crawl.pages[index];
    const routeId = routeIdFor(page.url, index);
    const writer = await store.createCapture(siteId, {
      routeId,
      sourceUrl: page.url,
      captureMode: captureFn ? 'injected-capture' : 'url-navigation',
    });

    const metadataEntry = await writer.putJson('metadata', page.capture.metadata ?? {});
    const domEntry = await writer.putJson('dom-snapshot', page.capture.domSnapshot ?? {});
    const axEntry = await writer.putJson('accessibility-tree', page.capture.axTree ?? {});
    const interactiveEntry = await writer.putJson('interactions', page.capture.interactiveElements ?? []);
    const candidatesEntry = await writer.putJson('component-candidates', page.capture.componentCandidates ?? page.capture.componentHints ?? []);
    const linksEntry = await writer.putJson('links', page.capture.links ?? []);
    const renderedDocumentEntry = page.capture.renderedDocument
      ? await writer.putJson('rendered-document', page.capture.renderedDocument)
      : null;
    const screenshotEntry = page.capture.screenshot
      ? await writer.putBuffer('screenshot', page.capture.screenshot, 'png')
      : null;

    const changedStates = (page.capture.stateCaptures ?? []).filter((state) => state.changed);
    const stateSummaryEntry = changedStates.length
      ? await writer.putJson('state-exploration', changedStates.map((state) => ({
          state: state.state,
          event: state.event ?? state.state,
          action: state.action,
          targetId: state.targetId,
          ownerCandidateId: state.ownerCandidateId,
          before: state.before,
          after: state.after,
          revealedCandidateIds: state.revealedCandidateIds ?? [],
          discoveredInState: state.state,
        })))
      : null;
    const stateScreenshotEntries = [];
    for (const state of changedStates) {
      if (state.capture?.screenshot) {
        stateScreenshotEntries.push(await writer.putBuffer(`state-${state.state}-screenshot`, state.capture.screenshot, 'png'));
      }
    }

    const entries = [metadataEntry, domEntry, axEntry, interactiveEntry, candidatesEntry, linksEntry, renderedDocumentEntry, screenshotEntry, stateSummaryEntry, ...stateScreenshotEntries].filter(Boolean);
    const evidenceIds = entries.map((entry) => entry.id);
    routeEvidence.set(routeId, evidenceIds);

    ir.evidence.push(
      evidenceRecord(metadataEntry, 'provider', routeId),
      evidenceRecord(domEntry, 'dom', routeId),
      evidenceRecord(axEntry, 'a11y', routeId),
      evidenceRecord(interactiveEntry, 'interaction', routeId),
      evidenceRecord(candidatesEntry, 'dom', routeId),
      evidenceRecord(linksEntry, 'dom', routeId),
      ...(renderedDocumentEntry ? [evidenceRecord(renderedDocumentEntry, 'dom', routeId)] : []),
      ...(screenshotEntry ? [evidenceRecord(screenshotEntry, 'screenshot', routeId)] : []),
      ...(stateSummaryEntry ? [evidenceRecord(stateSummaryEntry, 'interaction', routeId)] : []),
      ...stateScreenshotEntries.map((entry) => evidenceRecord(entry, 'screenshot', routeId)),
    );

    const stateNamesByOwner = new Map();
    for (const state of changedStates) {
      if (!state.ownerCandidateId) continue;
      if (!stateNamesByOwner.has(state.ownerCandidateId)) stateNamesByOwner.set(state.ownerCandidateId, new Set());
      stateNamesByOwner.get(state.ownerCandidateId).add(state.state);
    }

    const pathname = new URL(page.url).pathname || '/';
    ir.routes.push({
      id: routeId,
      path: pathname,
      title: page.capture.metadata?.title ?? pathname,
      sections: ['main'],
      viewport: page.capture.metadata?.viewport ?? null,
      documentStyle: page.capture.metadata?.documentStyle ?? null,
      renderedDocument: page.capture.renderedDocument ?? null,
      evidenceIds,
    });

    const basePageCandidates = page.capture.componentCandidates ?? page.capture.componentHints ?? [];
    const localCandidates = new Map(basePageCandidates.map((candidate) => [candidate.id, { ...candidate }]));
    for (const state of changedStates) {
      for (const revealedId of state.revealedCandidateIds ?? []) {
        const revealed = state.capture?.componentCandidates?.find((candidate) => candidate.id === revealedId);
        if (!revealed) continue;
        const existing = localCandidates.get(revealed.id);
        if (existing) {
          existing.discoveredInState ??= state.state;
          continue;
        }
        localCandidates.set(revealed.id, {
          ...revealed,
          discoveredInState: state.state,
          discoveredByTargetId: state.targetId,
        });
      }
    }

    for (const candidate of localCandidates.values()) {
      const discoveredStates = candidate.discoveredInState ? [candidate.discoveredInState] : [];
      candidates.push({
        ...candidate,
        id: `${routeId}:${candidate.id}`,
        sourceCandidateId: candidate.id,
        parentCandidateId: candidate.parentCandidateId ? `${routeId}:${candidate.parentCandidateId}` : null,
        childCandidateIds: (candidate.childCandidateIds ?? []).map((id) => `${routeId}:${id}`),
        routeId,
        sourceUrl: page.url,
        stateNames: [...new Set([...(candidate.detectedStates ?? []), ...(stateNamesByOwner.get(candidate.id) ?? []), ...discoveredStates])],
        evidenceIds,
      });
    }

    routeManifests.push(await writer.finalize());
  }

  const clusters = clusterCandidates(candidates, { threshold: clusterThreshold });
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));

  for (const cluster of clusters) {
    const members = cluster.memberIds.map((id) => byId.get(id)).filter(Boolean);
    const family = inferFamilyDefinition(members, cluster);
    ir.componentFamilies.push(family);
    if (family.states.length > 1) {
      const eventForState = (state) => {
        if (state === 'selected') return family.semanticRole === 'data-table' ? 'toggle-selection' : 'toggle-selected';
        if (state === 'expanded') return 'toggle-expanded';
        if (state === 'sorted') return 'sort';
        if (state === 'paginated') return 'paginate';
        return state;
      };
      ir.interactions.push({
        id: `interaction-${family.id}`,
        componentFamilyId: family.id,
        states: family.states,
        transitions: family.states.filter((state) => state !== 'default').map((state) => ({
          from: 'default',
          event: eventForState(state),
          to: state,
          sideEffectClass: 'none',
        })),
      });
    }
    for (const member of members) {
      ir.componentInstances.push({
        id: `inst-${safeId(member.id)}`,
        familyId: family.id,
        routeId: member.routeId,
        bbox: member.bbox,
        styleSnapshot: member.style ?? {},
        slotStyleSnapshot: member.slotStyles ?? {},
        contentBindings: member.content ?? {},
        variant: member.variant ?? 'default',
        state: member.detectedStates?.[0] ?? member.discoveredInState ?? 'default',
        availableStates: uniqueForInstance(member.stateNames),
        discoveredInState: member.discoveredInState ?? null,
        sourceCandidateId: member.id,
        parentInstanceId: null,
        childInstanceIds: [],
        evidenceIds: member.evidenceIds ?? routeEvidence.get(member.routeId) ?? [],
      });
    }
  }

  const instanceByCandidateId = new Map(ir.componentInstances.map((instance) => [instance.sourceCandidateId, instance]));
  for (const candidate of candidates) {
    const instance = instanceByCandidateId.get(candidate.id);
    if (!instance) continue;
    const parent = candidate.parentCandidateId ? instanceByCandidateId.get(candidate.parentCandidateId) : null;
    instance.parentInstanceId = parent?.id ?? null;
    instance.childInstanceIds = (candidate.childCandidateIds ?? []).map((id) => instanceByCandidateId.get(id)?.id).filter(Boolean);
  }

  const familyById = new Map(ir.componentFamilies.map((family) => [family.id, family]));
  for (const family of ir.componentFamilies) {
    family.parentFamilyIds = [];
    family.childFamilyIds = [];
  }
  const instanceById = new Map(ir.componentInstances.map((instance) => [instance.id, instance]));
  for (const instance of ir.componentInstances) {
    const family = familyById.get(instance.familyId);
    if (!family) continue;
    if (instance.parentInstanceId) {
      const parentFamilyId = instanceById.get(instance.parentInstanceId)?.familyId;
      if (parentFamilyId && !family.parentFamilyIds.includes(parentFamilyId)) family.parentFamilyIds.push(parentFamilyId);
    }
    for (const childInstanceId of instance.childInstanceIds ?? []) {
      const childFamilyId = instanceById.get(childInstanceId)?.familyId;
      if (childFamilyId && !family.childFamilyIds.includes(childFamilyId)) family.childFamilyIds.push(childFamilyId);
    }
  }

  const validation = validateComponentIr(ir);
  if (!validation.ok) throw new Error(`Invalid site Component IR: ${validation.errors.join('; ')}`);

  const componentLibrary = {
    version: '0.1',
    siteId,
    sourceUrl: crawl.startUrl,
    generatedAt: new Date().toISOString(),
    stats: {
      routes: ir.routes.length,
      componentFamilies: ir.componentFamilies.length,
      componentInstances: ir.componentInstances.length,
      crawlErrors: crawl.errors.length,
    },
    families: ir.componentFamilies.map((family) => ({
      id: family.id,
      name: family.canonicalName,
      semanticRole: family.semanticRole,
      occurrenceCount: family.occurrenceCount,
      routeIds: family.routeIds,
      propsSchema: family.propsSchema,
      slots: family.slots,
      variants: family.variants,
      states: family.states,
      parentFamilyIds: family.parentFamilyIds ?? [],
      childFamilyIds: family.childFamilyIds ?? [],
      confidence: family.confidence,
      styleProfile: family.styleProfile ?? {},
    })),
  };

  const siteWriter = await store.createCapture(`${siteId}-site`, {
    sourceUrl: crawl.startUrl,
    captureMode: 'site-component-pipeline',
  });
  await siteWriter.putJson('crawl-summary', {
    startUrl: crawl.startUrl,
    pages: crawl.pages.map((page) => page.url),
    errors: crawl.errors,
  });
  await siteWriter.putJson('component-ir', ir);
  await siteWriter.putJson('component-library', componentLibrary);
  const siteManifest = await siteWriter.finalize();

  return { ir, componentLibrary, crawl, routeManifests, siteManifest, candidates, clusters };
}
