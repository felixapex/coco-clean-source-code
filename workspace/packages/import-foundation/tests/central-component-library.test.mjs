import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createEmptyComponentLibrary,
  loadComponentLibrary,
  registerCandidateComponent as registerCandidateComponentBlocked,
  registerImportFoundationCandidates as registerImportFoundationCandidatesBlocked,
  saveComponentLibrary,
} from '../central-component-library.mjs';

// Historical schema-v1 behavior stays covered for one future migration tool only.
// Production callers do not receive this explicit bypass and therefore fail closed.
function registerCandidateComponent(candidateValue, library, options = {}) {
  return registerCandidateComponentBlocked(candidateValue, library, {
    ...options,
    legacyMigrationMode: true,
  });
}

function registerImportFoundationCandidates(foundation, library, options = {}) {
  return registerImportFoundationCandidatesBlocked(foundation, library, {
    ...options,
    legacyMigrationMode: true,
  });
}

function candidate(overrides = {}) {
  return {
    componentTypeId: 'hero-banner',
    componentInstanceId: 'instance-home-hero',
    platformPageId: '1111111111111111',
    sourceComponentName: 'hero_banner',
    actualFunctionName: '首屏横幅',
    nameMatchStatus: 'matched',
    schema: { name: '首屏横幅', settings: [], blocks: [{ type: '@theme' }], presets: [{ name: '首屏横幅' }] },
    functionFingerprint: 'fn:hero',
    structureInteractionFingerprint: 'si:hero-buttons',
    responsiveFingerprint: 'rsp:wide',
    sourceEvidence: [{ id: 'source:coco:/', route: '/', siteId: 'coco' }],
    version: '1.0.0',
    order: 0,
    settings: { heading: 'New collection' },
    blocks: {},
    blockOrder: [],
    implementationRef: 'component-library/variants/hero.html',
    ...overrides,
  };
}

test('whole-site formal registration fails closed while Coco V1 allocation is pending', () => {
  const foundation = {
    platform: 'web',
    importRunId: 'coco-pending-run',
    pages: [{
      route: '/',
      pageIdentity: { platformPageId: '1111111111111111', sourceUrl: 'https://coco.test/' },
      components: [candidate()],
    }],
  };

  assert.throws(
    () => registerImportFoundationCandidatesBlocked(foundation, createEmptyComponentLibrary(), { siteId: 'site-coco' }),
    /COMPONENT_LIBRARY_ALLOCATION_BLOCKED: coco-v1-pending/,
  );
});

test('a new candidate receives one permanent numeric component id and one usage record', () => {
  const result = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });

  assert.equal(result.classification, 'new');
  assert.equal(result.platformComponentId, '7000000000000001');
  assert.deepEqual(Object.keys(result.library.components), ['7000000000000001']);
  assert.equal(Object.keys(result.library.usages).length, 1);
  assert.equal(result.library.usages['1111111111111111:instance-home-hero'].platformComponentId, '7000000000000001');
});

test('an exact component from another website reuses the permanent id and stores only a new usage', () => {
  const first = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });
  const second = registerCandidateComponent(candidate({
    componentInstanceId: 'instance-majestic-hero',
    platformPageId: '2222222222222222',
    sourceComponentName: 'slideshow',
    sourceEvidence: [{ id: 'source:majestic:/', route: '/', siteId: 'majestic' }],
  }), first.library, { idFactory: () => '7000000000000002' });

  assert.equal(second.classification, 'duplicate');
  assert.equal(second.platformComponentId, '7000000000000001');
  assert.equal(Object.keys(second.library.components).length, 1);
  assert.equal(Object.keys(second.library.usages).length, 2);
  assert.deepEqual(second.library.components['7000000000000001'].sourceAliases.sort(), ['hero_banner', 'slideshow']);
});

test('same function and interaction with another responsive rule becomes a variant of the same component', () => {
  const first = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });
  const second = registerCandidateComponent(candidate({
    componentInstanceId: 'instance-mobile-hero',
    platformPageId: '2222222222222222',
    responsiveFingerprint: 'rsp:stacked',
  }), first.library, { idFactory: () => '7000000000000002' });

  assert.equal(second.classification, 'variant');
  assert.equal(second.platformComponentId, '7000000000000001');
  assert.equal(second.library.components['7000000000000001'].variants.length, 2);
});

test('a different interaction contract creates a different permanent component', () => {
  const ids = ['7000000000000001', '7000000000000002'];
  const first = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), { idFactory: () => ids.shift() });
  const second = registerCandidateComponent(candidate({
    componentInstanceId: 'instance-video-hero',
    platformPageId: '2222222222222222',
    structureInteractionFingerprint: 'si:autoplay-video',
  }), first.library, { idFactory: () => ids.shift() });

  assert.equal(second.classification, 'new');
  assert.equal(second.platformComponentId, '7000000000000002');
  assert.equal(Object.keys(second.library.components).length, 2);
});

test('reimporting the same page instance updates its content digest without embedding instance payloads', () => {
  const first = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });
  const second = registerCandidateComponent(candidate({ settings: { heading: 'Updated heading' } }), first.library, {
    idFactory: () => '7000000000000002',
  });

  assert.equal(second.classification, 'duplicate');
  assert.equal(Object.keys(second.library.usages).length, 1);
  const firstUsage = first.library.usages['1111111111111111:instance-home-hero'];
  const secondUsage = second.library.usages['1111111111111111:instance-home-hero'];
  assert.notEqual(secondUsage.instanceDataFingerprint, firstUsage.instanceDataFingerprint);
  assert.equal(Object.hasOwn(secondUsage, 'settings'), false);
  assert.equal(Object.hasOwn(secondUsage, 'blocks'), false);
});

test('missing fingerprints go to the review queue and never receive a formal id', () => {
  const result = registerCandidateComponent(candidate({ responsiveFingerprint: null }), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });

  assert.equal(result.classification, 'review-required');
  assert.equal(result.platformComponentId, null);
  assert.equal(Object.keys(result.library.components).length, 0);
  assert.equal(Object.keys(result.library.reviewQueue).length, 1);
});

test('a candidate whose source name still needs review cannot enter the formal library', () => {
  const result = registerCandidateComponent(candidate({ nameMatchStatus: 'review-required' }), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });

  assert.equal(result.classification, 'review-required');
  assert.equal(result.platformComponentId, null);
  assert.equal(Object.keys(result.library.components).length, 0);
  assert.equal(Object.keys(result.library.reviewQueue).length, 1);
  const queued = result.library.reviewQueue['1111111111111111:instance-home-hero'];
  assert.equal(queued.candidateSummary.componentTypeId, 'hero-banner');
  assert.equal(Object.hasOwn(queued.candidateSummary, 'settings'), false);
  assert.equal(Object.hasOwn(queued.candidateSummary, 'blocks'), false);
});

test('the central library survives an atomic disk round trip', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-central-components-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'component-library.json');
  const registered = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });

  await saveComponentLibrary(filePath, registered.library);
  const loaded = await loadComponentLibrary(filePath);
  assert.deepEqual(loaded, registered.library);
  assert.equal((await fs.readdir(directory)).some((name) => name.includes('.tmp-')), false);
});

test('registers one whole imported site while preserving reuse, review, and site usage records', () => {
  const foundation = {
    platform: 'web',
    importRunId: 'coco-run-1',
    pages: [
      {
        route: '/',
        pageIdentity: { platformPageId: '1111111111111111', sourceUrl: 'https://coco.test/' },
        components: [candidate({ platformPageId: '1111111111111111', componentInstanceId: 'home-hero' })],
      },
      {
        route: '/living',
        pageIdentity: { platformPageId: '2222222222222222', sourceUrl: 'https://coco.test/living' },
        components: [
          candidate({ platformPageId: '2222222222222222', componentInstanceId: 'living-hero' }),
          candidate({
            platformPageId: '2222222222222222',
            componentInstanceId: 'living-unknown',
            nameMatchStatus: 'review-required',
          }),
        ],
      },
    ],
  };
  const ids = ['7000000000000001'];

  const result = registerImportFoundationCandidates(foundation, createEmptyComponentLibrary(), {
    siteId: 'site-coco',
    sourceArtifactRef: 'imports/site-coco/import-foundation.json',
    idFactory: () => ids.shift(),
  });

  assert.deepEqual(result.summary, {
    candidateCount: 3,
    newCount: 1,
    duplicateCount: 1,
    variantCount: 0,
    reviewRequiredCount: 1,
  });
  assert.equal(Object.keys(result.library.components).length, 1);
  assert.equal(Object.keys(result.library.usages).length, 2);
  assert.equal(Object.keys(result.library.reviewQueue).length, 1);
  assert.equal(result.library.usages['1111111111111111:home-hero'].siteId, 'site-coco');
  assert.equal(result.library.usages['2222222222222222:living-hero'].route, '/living');
  assert.equal(
    result.library.usages['1111111111111111:home-hero'].sourceArtifactRef,
    'imports/site-coco/import-foundation.json',
  );
  assert.equal(result.assignments[1].platformComponentId, '7000000000000001');
  assert.equal(result.assignments[2].platformComponentId, null);
});

test('registers a normalized imported site whose pages reference the top-level component library', () => {
  const normalizedCandidate = candidate({
    platformPageId: '1111111111111111',
    componentInstanceId: 'normalized-home-hero',
  });
  const foundation = {
    platform: 'web',
    importRunId: 'coco-normalized-run-1',
    pages: [
      {
        route: '/',
        pageIdentity: { platformPageId: '1111111111111111', sourceUrl: 'https://coco.test/' },
        componentInstanceIds: ['normalized-home-hero'],
      },
    ],
    componentLibrary: [normalizedCandidate],
  };

  const result = registerImportFoundationCandidates(foundation, createEmptyComponentLibrary(), {
    siteId: 'site-coco-normalized',
    idFactory: () => '7000000000000001',
  });

  assert.deepEqual(result.summary, {
    candidateCount: 1,
    newCount: 1,
    duplicateCount: 0,
    variantCount: 0,
    reviewRequiredCount: 0,
  });
  assert.equal(result.assignments[0].route, '/');
  assert.equal(result.assignments[0].componentInstanceId, 'normalized-home-hero');
  assert.equal(result.library.usages['1111111111111111:normalized-home-hero'].sourceUrl, 'https://coco.test/');
});

test('normalized foundations fail closed when a page references a missing component instance', () => {
  const foundation = {
    platform: 'web',
    pages: [
      {
        route: '/',
        pageIdentity: { platformPageId: '1111111111111111', sourceUrl: 'https://coco.test/' },
        componentInstanceIds: ['missing-instance'],
      },
    ],
    componentLibrary: [],
  };

  assert.throws(
    () => registerImportFoundationCandidates(foundation, createEmptyComponentLibrary(), { siteId: 'site-coco' }),
    /missing-instance/,
  );
});

test('non-empty normalized component libraries cannot silently register zero candidates', () => {
  const foundation = {
    platform: 'web',
    pages: [
      {
        route: '/',
        pageIdentity: { platformPageId: '1111111111111111', sourceUrl: 'https://coco.test/' },
        componentInstanceIds: [],
      },
    ],
    componentLibrary: [candidate({ componentInstanceId: 'orphan-instance' })],
  };

  assert.throws(
    () => registerImportFoundationCandidates(foundation, createEmptyComponentLibrary(), { siteId: 'site-coco' }),
    /registered zero candidates/,
  );
});

test('atomically replaces an existing central library file on a later save', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-central-components-update-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'component-library.json');
  const first = registerCandidateComponent(candidate(), createEmptyComponentLibrary(), {
    idFactory: () => '7000000000000001',
  });
  const second = registerCandidateComponent(candidate({
    platformPageId: '2222222222222222',
    componentInstanceId: 'second-hero',
  }), first.library);

  await saveComponentLibrary(filePath, first.library);
  await saveComponentLibrary(filePath, second.library);

  const loaded = await loadComponentLibrary(filePath);
  assert.equal(Object.keys(loaded.usages).length, 2);
});
